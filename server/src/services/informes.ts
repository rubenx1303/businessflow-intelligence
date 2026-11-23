/**
 * Informes analíticos calculados sobre la capa GOLD local (Parquet + DuckDB), no sobre la base operativa.
 *
 * Cada consulta es el equivalente SQL de una medida DAX del modelo semántico de Fabric (fabric/modelo/medidas.py)
 * o de una vista T-SQL del Warehouse (fabric/warehouse). El nombre de la medida equivalente va en `equivalencias`.
 *
 * Como Gold es una foto del último pipeline, estos informes NO cambian al crear una operación hasta que el
 * pipeline se vuelve a ejecutar: `cuadre` lo hace visible comparando Gold con la base operativa en vivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { conectarDuck, filas, lit, posix, rutas, ultimaEjecucion, una } from '../data/lake.js';
import { dashboard } from './panel.js';

export interface FiltrosInforme { desde?: string; hasta?: string; proveedor_id?: number; categoria?: string }

const TABLAS = ['dim_fecha', 'dim_producto', 'dim_proveedor', 'dim_almacen', 'fact_compras', 'fact_recepciones', 'fact_movimientos_inventario', 'inventario_diario'];

export function goldDisponible(): boolean {
  return TABLAS.every((t) => fs.existsSync(path.join(rutas().gold, `${t}.parquet`)));
}

export async function informesGold(empresaId: number, f: FiltrosInforme) {
  if (!goldDisponible()) return { disponible: false as const };
  const con = await conectarDuck();
  try {
    for (const t of TABLAS) await con.run(`CREATE VIEW ${t} AS SELECT * FROM read_parquet('${lit(posix(path.join(rutas().gold, `${t}.parquet`)))}')`);

    const per = await una(con, `SELECT strftime(coalesce(${f.desde ? `DATE '${f.desde}'` : 'NULL'}, current_date - 364), '%Y-%m-%d') AS desde,
                                       strftime(coalesce(${f.hasta ? `DATE '${f.hasta}'` : 'NULL'}, current_date), '%Y-%m-%d') AS hasta`);
    const dias = Math.round((Date.parse(per.hasta) - Date.parse(per.desde)) / 86400000) + 1;
    const prov = f.proveedor_id ? `AND c.proveedor_key = ${Number(f.proveedor_id)}` : '';
    const cat = f.categoria ? `AND p.categoria = '${lit(f.categoria)}'` : '';
    const catInv = f.categoria ? `AND p.categoria = '${lit(f.categoria)}'` : '';
    const provInv = f.proveedor_id ? `AND p.proveedor_preferente_key = ${Number(f.proveedor_id)}` : '';

    // Base de compras del periodo: líneas de pedidos válidos (ni borrador ni cancelado).
    await con.run(`CREATE TEMP VIEW c AS
      SELECT c.*, f.fecha, f.anio, f.mes, f.trimestre, f.anio_mes, p.categoria
      FROM fact_compras c JOIN dim_fecha f ON f.fecha_key = c.fecha_pedido_key JOIN dim_producto p USING (producto_key)
      WHERE c.estado_pedido NOT IN ('borrador','cancelado') AND f.fecha BETWEEN DATE '${per.desde}' AND DATE '${per.hasta}' ${prov} ${cat}`);
    // Reducción de grano línea → pedido (lo que en DAX hace SUMMARIZE antes de AVERAGEX).
    await con.run(`CREATE TEMP VIEW ped AS
      SELECT pedido_id, proveedor_key, any_value(anio) AS anio, any_value(trimestre) AS trimestre,
             bool_or(pedido_completo) AS completo, bool_or(pedido_a_tiempo) AS a_tiempo, max(dias_retraso) AS dias_retraso,
             max(plazo_real_dias) AS plazo_real_dias, sum(importe) AS importe, sum(cantidad_recibida) AS recibida, sum(cantidad_rechazada) AS rechazada
      FROM c GROUP BY 1, 2`);
    // Stock al cierre del periodo: suma acumulada de movimientos hasta `hasta` (medida semiaditiva).
    await con.run(`CREATE TEMP VIEW stock_cierre AS
      SELECT p.producto_key, p.categoria, p.coste_estandar, p.stock_minimo, p.activo, coalesce(sum(m.cantidad), 0) AS stock
      FROM dim_producto p
      LEFT JOIN (SELECT m.* FROM fact_movimientos_inventario m JOIN dim_fecha f USING (fecha_key) WHERE f.fecha <= DATE '${per.hasta}') m USING (producto_key)
      WHERE true ${catInv} ${provInv} GROUP BY ALL`);
    await con.run(`CREATE TEMP VIEW consumo AS
      SELECT m.*, f.fecha, f.anio_mes, p.categoria
      FROM fact_movimientos_inventario m JOIN dim_fecha f USING (fecha_key) JOIN dim_producto p USING (producto_key)
      WHERE m.tipo_movimiento = 'SALIDA_CONSUMO' AND f.fecha BETWEEN DATE '${per.desde}' AND DATE '${per.hasta}' ${catInv} ${provInv}`);

    const k = await una(con, `
      SELECT (SELECT coalesce(sum(importe), 0) FROM c)::DOUBLE AS gasto_compras,
             (SELECT count(DISTINCT pedido_id) FROM c)::INTEGER AS pedidos,
             (SELECT count(*) FROM ped WHERE completo)::INTEGER AS pedidos_completados,
             (SELECT avg(a_tiempo::INTEGER) FROM ped WHERE completo)::DOUBLE AS entregas_puntuales,
             (SELECT avg(dias_retraso) FROM ped WHERE completo)::DOUBLE AS retraso_medio_dias,
             (SELECT avg(plazo_real_dias) FROM ped WHERE completo)::DOUBLE AS plazo_real_medio_dias,
             (SELECT coalesce(sum(stock * coste_estandar), 0) FROM stock_cierre)::DOUBLE AS valor_inventario,
             (SELECT count(*) FROM stock_cierre WHERE activo AND stock < stock_minimo)::INTEGER AS productos_bajo_minimo,
             (SELECT coalesce(-sum(importe), 0) FROM consumo)::DOUBLE AS consumo_valorado,
             (SELECT coalesce(sum(cantidad_salida), 0) FROM consumo)::DOUBLE AS consumo_unidades,
             (SELECT sum(rechazada) / nullif(sum(recibida) + sum(rechazada), 0) FROM ped)::DOUBLE AS tasa_rechazo`);
    const kpis = { ...k, rotacion_inventario: k.valor_inventario > 0 ? (k.consumo_valorado * 365 / dias) / k.valor_inventario : null };

    const gastoMensual = await filas(con, `
      WITH m AS (SELECT anio, mes, anio_mes, sum(importe) AS gasto, count(DISTINCT pedido_id) AS pedidos FROM c GROUP BY 1, 2, 3)
      SELECT anio_mes, gasto::DOUBLE AS gasto, pedidos::INTEGER AS pedidos,
             lag(gasto) OVER w::DOUBLE AS gasto_mes_anterior,
             ((gasto - lag(gasto) OVER w) / nullif(lag(gasto) OVER w, 0))::DOUBLE AS variacion,
             sum(gasto) OVER (PARTITION BY anio ORDER BY mes ROWS UNBOUNDED PRECEDING)::DOUBLE AS acumulado_anio,
             avg(gasto) OVER (ORDER BY anio, mes ROWS BETWEEN 2 PRECEDING AND CURRENT ROW)::DOUBLE AS media_movil_3m
      FROM m WINDOW w AS (ORDER BY anio, mes) ORDER BY anio, mes`);

    const proveedores = await filas(con, `
      WITH a AS (
        SELECT proveedor_key, count(*) AS pedidos, count(*) FILTER (WHERE completo) AS completados, sum(importe) AS gasto,
               avg(a_tiempo::INTEGER) FILTER (WHERE completo) AS otd, avg(dias_retraso) FILTER (WHERE completo) AS retraso,
               avg(plazo_real_dias) FILTER (WHERE completo) AS plazo_real, sum(rechazada) / nullif(sum(recibida) + sum(rechazada), 0) AS rechazo
        FROM ped GROUP BY 1)
      SELECT d.proveedor_key::INTEGER AS proveedor_id, d.codigo, d.nombre, d.estado, d.plazo_acordado_dias::INTEGER AS plazo_acordado_dias,
             a.pedidos::INTEGER AS pedidos, a.completados::INTEGER AS completados, a.gasto::DOUBLE AS gasto,
             (a.gasto / sum(a.gasto) OVER ())::DOUBLE AS cuota_gasto, dense_rank() OVER (ORDER BY a.gasto DESC)::INTEGER AS ranking_gasto,
             a.otd::DOUBLE AS entregas_puntuales, a.retraso::DOUBLE AS retraso_medio_dias, a.plazo_real::DOUBLE AS plazo_real_dias,
             (a.plazo_real - d.plazo_acordado_dias)::DOUBLE AS desviacion_plazo_dias, a.rechazo::DOUBLE AS tasa_rechazo
      FROM a JOIN dim_proveedor d USING (proveedor_key) ORDER BY a.gasto DESC`);

    const puntualidadTrimestral = await filas(con, `
      WITH t AS (
        SELECT proveedor_key, anio, trimestre, count(*) AS pedidos, avg(a_tiempo::INTEGER) AS otd, avg(dias_retraso) AS retraso
        FROM ped WHERE completo GROUP BY 1, 2, 3)
      SELECT d.codigo, d.nombre, (t.anio || '-T' || t.trimestre) AS periodo, t.pedidos::INTEGER AS pedidos, t.otd::DOUBLE AS entregas_puntuales,
             t.retraso::DOUBLE AS retraso_medio_dias,
             (t.otd - lag(t.otd) OVER (PARTITION BY t.proveedor_key ORDER BY t.anio, t.trimestre))::DOUBLE AS variacion
      FROM t JOIN dim_proveedor d USING (proveedor_key) ORDER BY d.codigo, t.anio, t.trimestre`);

    const consumoCategoria = await filas(con, `
      WITH co AS (SELECT categoria, -sum(importe) AS valor, sum(cantidad_salida) AS unidades FROM consumo GROUP BY 1),
           st AS (SELECT categoria, sum(stock * coste_estandar) AS valor_inventario, count(*) FILTER (WHERE activo AND stock < stock_minimo) AS bajo_minimo FROM stock_cierre GROUP BY 1)
      SELECT st.categoria, coalesce(co.valor, 0)::DOUBLE AS consumo_valorado, coalesce(co.unidades, 0)::DOUBLE AS unidades,
             (coalesce(co.valor, 0) / nullif(sum(co.valor) OVER (), 0))::DOUBLE AS cuota,
             st.valor_inventario::DOUBLE AS valor_inventario, st.bajo_minimo::INTEGER AS bajo_minimo,
             (coalesce(co.valor, 0) * 365 / ${dias} / nullif(st.valor_inventario, 0))::DOUBLE AS rotacion
      FROM st LEFT JOIN co USING (categoria) ORDER BY 2 DESC`);

    // Valor del inventario al cierre de cada mes: se toma la ÚLTIMA foto del mes, no la suma (semiaditivo).
    const inventarioMensual = await filas(con, `
      WITH i AS (
        SELECT f.anio_mes, f.fecha, sum(i.valor_stock) AS valor, sum(i.sin_stock) AS combinaciones_sin_stock
        FROM inventario_diario i JOIN dim_fecha f USING (fecha_key) JOIN dim_producto p USING (producto_key)
        WHERE f.fecha BETWEEN DATE '${per.desde}' AND DATE '${per.hasta}' ${catInv} ${provInv} GROUP BY 1, 2)
      SELECT anio_mes, arg_max(valor, fecha)::DOUBLE AS valor_cierre, avg(valor)::DOUBLE AS valor_medio,
             max(combinaciones_sin_stock)::INTEGER AS max_roturas_dia
      FROM i GROUP BY 1 ORDER BY 1`);

    // Cuadre Gold ↔ base operativa, siempre sobre el periodo por defecto y sin filtros.
    const sinFiltro = !f.desde && !f.hasta && !f.proveedor_id && !f.categoria;
    const vivo = (await dashboard(empresaId, {})).kpis;
    let goldBase = kpis;
    if (!sinFiltro) goldBase = ((await informesGold(empresaId, {})) as any).kpis;
    const campos: [string, string, number][] = [
      ['gasto_compras', 'Coste total de compras', 0.005], ['pedidos', 'Pedidos', 0], ['entregas_puntuales', '% Entregas puntuales', 1e-9],
      ['retraso_medio_dias', 'Retraso medio (días)', 1e-9], ['valor_inventario', 'Valor del inventario', 0.005],
      ['productos_bajo_minimo', 'Productos bajo mínimo', 0], ['consumo_valorado', 'Consumo valorado', 0.005], ['rotacion_inventario', 'Rotación de inventario', 1e-6],
    ];
    const lineas = campos.map(([campo, medida, tol]) => {
      const a = (vivo as any)[campo] ?? null, b = (goldBase as any)[campo] ?? null;
      return { campo, medida_dax: medida, operativo: a, gold: b, coincide: a === null || b === null ? a === b : Math.abs(a - b) <= tol };
    });

    return {
      disponible: true as const,
      periodo: { ...per, dias },
      filtros: { proveedor_id: f.proveedor_id ?? null, categoria: f.categoria ?? null },
      ejecucion: (({ id_ejecucion, fin, motor }) => ({ id_ejecucion, fin, motor }))(ultimaEjecucion() ?? {}),
      kpis, gasto_mensual: gastoMensual, proveedores, puntualidad_trimestral: puntualidadTrimestral,
      consumo_categoria: consumoCategoria, inventario_mensual: inventarioMensual,
      cuadre: { al_dia: lineas.every((l) => l.coincide), lineas },
    };
  } finally {
    con.closeSync?.();
  }
}
