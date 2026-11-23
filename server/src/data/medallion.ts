/**
 * Circuito medallion LOCAL (modo demostración, sin Azure):
 *
 *   PostgreSQL ──► Bronze (Parquet, datos originales por carga) ──► Silver (limpio y validado) ──► Gold (modelo en estrella)
 *
 * Es la réplica local, con DuckDB, de lo que en Microsoft Fabric hacen los notebooks PySpark
 * (fabric/notebooks/01_bronze_a_silver.py y 02_silver_a_gold.py) y el procedimiento T-SQL de inventario diario.
 * Mismas reglas, mismas tablas y mismas granularidades; cambia el motor, no la lógica.
 */
import type { DuckDBConnection } from '@duckdb/node-api';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { exportarBronze } from './exportBronze.js';
import { conectarDuck, filas, lit, posix, rutas, una } from './lake.js';

interface ReglasTabla { nombre: string; textos: string[]; reglas: Record<string, string>; referencias: Record<string, string> }

/** Cada regla es una expresión SQL que debe ser cierta. El orden importa: solo se referencian tablas ya procesadas. */
export const TABLAS_SILVER: ReglasTabla[] = [
  { nombre: 'proveedores', textos: ['codigo', 'nombre', 'ciudad', 'pais', 'condiciones_pago', 'telefono'],
    reglas: {
      codigo_obligatorio: "codigo IS NOT NULL AND codigo <> ''",
      nombre_obligatorio: "nombre IS NOT NULL AND nombre <> ''",
      cif_formato: "regexp_full_match(cif, '[A-Z0-9]{8,12}')",
      plazo_en_rango: 'plazo_entrega_dias BETWEEN 0 AND 365',
      estado_valido: "estado IN ('activo','en_revision','bloqueado','inactivo')",
    }, referencias: {} },
  { nombre: 'almacenes', textos: ['codigo', 'nombre', 'ciudad'],
    reglas: { codigo_obligatorio: "codigo IS NOT NULL AND codigo <> ''" }, referencias: {} },
  { nombre: 'productos', textos: ['sku', 'nombre', 'categoria', 'unidad'],
    reglas: {
      sku_obligatorio: "sku IS NOT NULL AND sku <> ''",
      categoria_obligatoria: "categoria IS NOT NULL AND categoria <> ''",
      coste_no_negativo: 'coste_estandar >= 0',
      minimo_no_negativo: 'stock_minimo >= 0',
      lote_positivo: 'lote_compra > 0',
    }, referencias: { proveedor_preferente_id: 'proveedores' } },
  { nombre: 'pedidos_compra', textos: ['numero'],
    reglas: {
      estado_valido: "estado IN ('borrador','enviado','parcial','recibido','cancelado')",
      entrega_no_anterior_al_pedido: 'fecha_entrega_prevista >= fecha_pedido',
      pedido_no_futuro: 'fecha_pedido <= current_date',
    }, referencias: { proveedor_id: 'proveedores', almacen_id: 'almacenes' } },
  { nombre: 'lineas_pedido', textos: [],
    reglas: { cantidad_positiva: 'cantidad > 0', precio_no_negativo: 'precio_unitario >= 0' },
    referencias: { pedido_id: 'pedidos_compra', producto_id: 'productos' } },
  { nombre: 'recepciones', textos: ['albaran'],
    reglas: { albaran_obligatorio: "albaran IS NOT NULL AND albaran <> ''", recepcion_no_futura: 'fecha_recepcion <= current_date' },
    referencias: { pedido_id: 'pedidos_compra' } },
  { nombre: 'lineas_recepcion', textos: [],
    reglas: {
      cantidades_no_negativas: 'cantidad_recibida >= 0 AND cantidad_rechazada >= 0',
      alguna_cantidad: 'cantidad_recibida + cantidad_rechazada > 0',
    }, referencias: { recepcion_id: 'recepciones', linea_pedido_id: 'lineas_pedido' } },
  { nombre: 'movimientos_stock', textos: ['referencia'],
    reglas: {
      tipo_valido: "tipo IN ('ENTRADA_COMPRA','SALIDA_CONSUMO','AJUSTE','INICIAL')",
      cantidad_distinta_de_cero: 'cantidad <> 0',
      signo_coherente: "(tipo <> 'ENTRADA_COMPRA' OR cantidad > 0) AND (tipo <> 'SALIDA_CONSUMO' OR cantidad < 0)",
      coste_no_negativo: 'coste_unitario >= 0',
      movimiento_no_futuro: 'fecha <= now()',
    }, referencias: { producto_id: 'productos', almacen_id: 'almacenes', recepcion_id: 'recepciones' } },
];

async function columnas(con: DuckDBConnection, tabla: string): Promise<string[]> {
  return (await filas<{ column_name: string }>(con, `SELECT column_name FROM (DESCRIBE ${tabla})`)).map((c) => c.column_name);
}

/** BRONZE → SILVER: deduplica, normaliza, valida reglas y referencias, y separa lo inválido en cuarentena. */
export async function construirSilver(con: DuckDBConnection, idEjecucion: string) {
  const r = rutas();
  fs.rmSync(r.silver, { recursive: true, force: true });
  fs.mkdirSync(r.silver, { recursive: true });
  await con.run(`CREATE OR REPLACE TEMP TABLE rechazos (id_ejecucion VARCHAR, tabla VARCHAR, id_registro BIGINT, errores VARCHAR, id_carga VARCHAR, registro VARCHAR)`);
  const resultados: any[] = [];

  for (const t of TABLAS_SILVER) {
    const t0 = Date.now();
    await con.run(`CREATE OR REPLACE TEMP TABLE b_${t.nombre} AS SELECT * FROM read_parquet('${lit(posix(path.join(r.bronze, t.nombre)))}/*/*.parquet', union_by_name = true)`);
    const bruto = await una(con, `SELECT count(*)::INTEGER AS leidas, count(DISTINCT _id_carga)::INTEGER AS cargas FROM b_${t.nombre}`);
    const cols = await columnas(con, `b_${t.nombre}`);

    // 1) Deduplicación: una fila por clave, la de la carga más reciente.  2) Normalización de formatos.
    const reemplazos: string[] = [];
    for (const c of t.textos) if (cols.includes(c)) reemplazos.push(`nullif(regexp_replace(trim(${c}), '\\s+', ' ', 'g'), '') AS ${c}`);
    const sobre = (c: string, expr: string) => {
      const i = reemplazos.findIndex((x) => x.endsWith(` AS ${c}`));
      const base = i >= 0 ? reemplazos[i].slice(0, -` AS ${c}`.length) : c;
      const nuevo = `${expr.replace('$', base)} AS ${c}`;
      if (i >= 0) reemplazos[i] = nuevo; else if (cols.includes(c)) reemplazos.push(nuevo);
    };
    sobre('cif', "upper(regexp_replace($, '[\\s\\-.]', '', 'g'))");
    sobre('email', 'lower(trim($))');
    for (const c of ['codigo', 'sku', 'numero']) sobre(c, 'upper($)');
    const extra = cols.includes('fecha') ? ', CAST(fecha AS DATE) AS fecha_dia' : '';
    await con.run(
      `CREATE OR REPLACE TEMP TABLE n_${t.nombre} AS
       SELECT * ${reemplazos.length ? `REPLACE (${reemplazos.join(', ')})` : ''} ${extra}
       FROM (SELECT * FROM b_${t.nombre} QUALIFY row_number() OVER (PARTITION BY id ORDER BY _fecha_carga DESC, _id_carga DESC) = 1)`);

    // 3) Validación. Un NULL en la regla también cuenta como fallo.
    const marcas = [
      ...Object.entries(t.reglas).map(([n, e]) => `CASE WHEN NOT coalesce((${e}), false) THEN '${n}' END`),
      ...Object.entries(t.referencias).map(([c, ref]) =>
        `CASE WHEN x.${c} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM s_${ref} r WHERE r.id = x.${c}) THEN 'referencia_${c}_inexistente' END`),
    ];
    await con.run(`CREATE OR REPLACE TEMP TABLE v_${t.nombre} AS SELECT x.*, concat_ws('; ', ${marcas.join(', ')}) AS _errores FROM n_${t.nombre} x`);
    await con.run(
      `INSERT INTO rechazos SELECT '${idEjecucion}', '${t.nombre}', v.id, v._errores, v._id_carga, CAST(to_json(v) AS VARCHAR)
         FROM v_${t.nombre} v WHERE v._errores <> ''`);
    await con.run(`CREATE OR REPLACE TEMP TABLE s_${t.nombre} AS SELECT * EXCLUDE (_errores), now() AS _procesado_en FROM v_${t.nombre} WHERE _errores = ''`);
    await con.run(`COPY s_${t.nombre} TO '${lit(posix(path.join(r.silver, `${t.nombre}.parquet`)))}' (FORMAT parquet, COMPRESSION zstd)`);

    const c = await una(con, `SELECT (SELECT count(*) FROM n_${t.nombre})::INTEGER AS claves, (SELECT count(*) FROM s_${t.nombre})::INTEGER AS escritas`);
    resultados.push({
      tabla: t.nombre, cargas_leidas: bruto.cargas, filas_leidas: bruto.leidas, duplicadas_eliminadas: bruto.leidas - c.claves,
      rechazadas: c.claves - c.escritas, escritas: c.escritas, ms: Date.now() - t0,
    });
  }

  await con.run(`COPY rechazos TO '${lit(posix(path.join(r.silver, 'calidad_rechazos.parquet')))}' (FORMAT parquet)`);
  const rechazos = await filas(con, `SELECT tabla, id_registro::INTEGER AS id_registro, errores, id_carga FROM rechazos ORDER BY tabla, id_registro LIMIT 200`);

  // Control cruzado: el libro de movimientos no puede dejar stock negativo en ningún producto/almacén.
  const neg = await una(con, `SELECT count(*)::INTEGER AS n FROM (SELECT producto_id, almacen_id FROM s_movimientos_stock GROUP BY 1, 2 HAVING sum(cantidad) < 0)`);
  if (neg.n > 0) throw new Error(`Silver: ${neg.n} combinaciones producto/almacén con stock negativo`);
  return { tablas: resultados, rechazos };
}

const FECHA_KEY = (c: string) => `CAST(strftime(${c}, '%Y%m%d') AS INTEGER)`;

/** Definición del modelo Gold: tabla → [clave que fija la granularidad, descripción del grano, SQL]. */
export const TABLAS_GOLD: { nombre: string; clave: string; grano: string; sql: string }[] = [
  { nombre: 'dim_fecha', clave: 'fecha_key', grano: 'día natural', sql: `
    WITH lim AS (
      SELECT least((SELECT min(fecha_pedido) FROM s_pedidos_compra), (SELECT min(fecha_dia) FROM s_movimientos_stock)) AS desde,
             greatest((SELECT max(fecha_entrega_prevista) FROM s_pedidos_compra), current_date) AS hasta)
    SELECT ${FECHA_KEY('d')} AS fecha_key, CAST(d AS DATE) AS fecha, year(d)::INTEGER AS anio, quarter(d)::INTEGER AS trimestre, month(d)::INTEGER AS mes,
           ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][month(d)] AS nombre_mes,
           strftime(d, '%Y-%m') AS anio_mes, (year(d) * 100 + month(d))::INTEGER AS anio_mes_orden, weekofyear(d)::INTEGER AS semana_iso,
           isodow(d)::INTEGER AS dia_semana, ['lunes','martes','miércoles','jueves','viernes','sábado','domingo'][isodow(d)] AS nombre_dia,
           isodow(d) >= 6 AS es_fin_de_semana
    FROM lim, generate_series(date_trunc('year', lim.desde), date_trunc('year', lim.hasta) + INTERVAL 1 YEAR - INTERVAL 1 DAY, INTERVAL 1 DAY) AS g(d)` },
  { nombre: 'dim_proveedor', clave: 'proveedor_key', grano: 'proveedor (SCD tipo 1)', sql: `
    SELECT id AS proveedor_key, codigo, nombre, cif, ciudad, pais, estado, plazo_entrega_dias AS plazo_acordado_dias, condiciones_pago FROM s_proveedores` },
  { nombre: 'dim_almacen', clave: 'almacen_key', grano: 'almacén', sql: `SELECT id AS almacen_key, codigo, nombre, ciudad, activo FROM s_almacenes` },
  { nombre: 'dim_producto', clave: 'producto_key', grano: 'producto (SCD tipo 1)', sql: `
    SELECT p.id AS producto_key, p.sku, p.nombre, p.categoria, p.unidad, p.coste_estandar, p.stock_minimo, p.lote_compra,
           p.proveedor_preferente_id AS proveedor_preferente_key, pr.nombre AS proveedor_preferente, p.activo
    FROM s_productos p LEFT JOIN s_proveedores pr ON pr.id = p.proveedor_preferente_id` },
  { nombre: 'fact_compras', clave: 'linea_pedido_id', grano: 'línea de pedido de compra', sql: `
    WITH rec_linea AS (
      SELECT lr.linea_pedido_id, sum(lr.cantidad_recibida) AS recibida, sum(lr.cantidad_rechazada) AS rechazada
      FROM s_lineas_recepcion lr GROUP BY 1),
    rec_pedido AS (SELECT pedido_id, max(fecha_recepcion) AS ultima FROM s_recepciones GROUP BY 1)
    SELECT lp.id AS linea_pedido_id, pc.id AS pedido_id, pc.numero AS numero_pedido,
           ${FECHA_KEY('pc.fecha_pedido')} AS fecha_pedido_key, ${FECHA_KEY('pc.fecha_entrega_prevista')} AS fecha_entrega_prevista_key,
           lp.producto_id AS producto_key, pc.proveedor_id AS proveedor_key, pc.almacen_id AS almacen_key, pc.estado AS estado_pedido,
           lp.cantidad AS cantidad_pedida, lp.precio_unitario, CAST(lp.cantidad * lp.precio_unitario AS DECIMAL(18,4)) AS importe,
           coalesce(rl.recibida, 0) AS cantidad_recibida, coalesce(rl.rechazada, 0) AS cantidad_rechazada,
           greatest(lp.cantidad - coalesce(rl.recibida, 0), 0) AS cantidad_pendiente,
           ${FECHA_KEY('rp.ultima')} AS fecha_ultima_recepcion_pedido_key,
           pc.estado = 'recibido' AS pedido_completo,
           CASE WHEN pc.estado = 'recibido' THEN rp.ultima <= pc.fecha_entrega_prevista END AS pedido_a_tiempo,
           CASE WHEN pc.estado = 'recibido' THEN greatest(rp.ultima - pc.fecha_entrega_prevista, 0)::INTEGER END AS dias_retraso,
           CASE WHEN pc.estado = 'recibido' THEN (rp.ultima - pc.fecha_pedido)::INTEGER END AS plazo_real_dias
    FROM s_lineas_pedido lp
    JOIN s_pedidos_compra pc ON pc.id = lp.pedido_id
    LEFT JOIN rec_linea rl ON rl.linea_pedido_id = lp.id
    LEFT JOIN rec_pedido rp ON rp.pedido_id = pc.id` },
  { nombre: 'fact_recepciones', clave: 'linea_recepcion_id', grano: 'línea de recepción', sql: `
    SELECT lr.id AS linea_recepcion_id, r.id AS recepcion_id, r.albaran, pc.id AS pedido_id, lr.linea_pedido_id,
           ${FECHA_KEY('r.fecha_recepcion')} AS fecha_recepcion_key, lp.producto_id AS producto_key, pc.proveedor_id AS proveedor_key, pc.almacen_id AS almacen_key,
           lr.cantidad_recibida, lr.cantidad_rechazada, CAST(lr.cantidad_recibida * lp.precio_unitario AS DECIMAL(18,4)) AS importe_recibido,
           (r.fecha_recepcion - pc.fecha_pedido)::INTEGER AS dias_desde_pedido, (r.fecha_recepcion - pc.fecha_entrega_prevista)::INTEGER AS dias_respecto_previsto
    FROM s_lineas_recepcion lr
    JOIN s_recepciones r ON r.id = lr.recepcion_id
    JOIN s_lineas_pedido lp ON lp.id = lr.linea_pedido_id
    JOIN s_pedidos_compra pc ON pc.id = r.pedido_id` },
  { nombre: 'fact_movimientos_inventario', clave: 'movimiento_id', grano: 'movimiento de stock', sql: `
    SELECT m.id AS movimiento_id, ${FECHA_KEY('m.fecha_dia')} AS fecha_key, m.producto_id AS producto_key, m.almacen_id AS almacen_key,
           m.tipo AS tipo_movimiento, m.recepcion_id, m.cantidad, m.coste_unitario, CAST(m.cantidad * m.coste_unitario AS DECIMAL(18,4)) AS importe,
           CASE WHEN m.cantidad > 0 THEN m.cantidad ELSE 0 END AS cantidad_entrada,
           CASE WHEN m.cantidad < 0 THEN -m.cantidad ELSE 0 END AS cantidad_salida
    FROM s_movimientos_stock m` },
];

/** Foto periódica diaria. En Fabric la genera el procedimiento T-SQL analitica.sp_cargar_inventario_diario del Warehouse. */
const SQL_INVENTARIO_DIARIO = `
  WITH neto AS (
    SELECT producto_key, almacen_key, fecha_key, sum(cantidad) AS variacion, sum(cantidad_salida) AS salidas
    FROM g_fact_movimientos_inventario GROUP BY 1, 2, 3),
  lim AS (SELECT min(fecha_key) AS desde, max(fecha_key) AS hasta FROM neto),
  malla AS (
    SELECT pa.producto_key, pa.almacen_key, f.fecha_key
    FROM (SELECT DISTINCT producto_key, almacen_key FROM neto) pa CROSS JOIN g_dim_fecha f CROSS JOIN lim
    WHERE f.fecha_key BETWEEN lim.desde AND lim.hasta),
  acumulado AS (
    SELECT m.producto_key, m.almacen_key, m.fecha_key, coalesce(n.salidas, 0) AS salidas_dia,
           sum(coalesce(n.variacion, 0)) OVER (PARTITION BY m.producto_key, m.almacen_key ORDER BY m.fecha_key ROWS UNBOUNDED PRECEDING) AS stock
    FROM malla m LEFT JOIN neto n USING (producto_key, almacen_key, fecha_key))
  SELECT a.producto_key, a.almacen_key, a.fecha_key, CAST(a.stock AS DECIMAL(14,3)) AS stock,
         CAST(a.stock * p.coste_estandar AS DECIMAL(18,4)) AS valor_stock, CAST(a.salidas_dia AS DECIMAL(14,3)) AS salidas_dia,
         (a.stock <= 0)::INTEGER AS sin_stock
  FROM acumulado a JOIN g_dim_producto p USING (producto_key)`;

/** SILVER → GOLD: modelo en estrella, con comprobación de granularidad, integridad referencial y cuadre con Silver. */
export async function construirGold(con: DuckDBConnection) {
  const r = rutas();
  fs.rmSync(r.gold, { recursive: true, force: true });
  fs.mkdirSync(r.gold, { recursive: true });
  const tablas: any[] = [];

  const guardar = async (nombre: string, clave: string, grano: string, sql: string) => {
    await con.run(`CREATE OR REPLACE TEMP TABLE g_${nombre} AS ${sql}`);
    const c = await una(con, `SELECT count(*)::INTEGER AS filas, count(DISTINCT ${clave})::INTEGER AS claves FROM g_${nombre}`);
    if (c.filas !== c.claves) throw new Error(`Gold ${nombre}: ${c.filas} filas pero ${c.claves} claves distintas (granularidad rota)`);
    await con.run(`COPY g_${nombre} TO '${lit(posix(path.join(r.gold, `${nombre}.parquet`)))}' (FORMAT parquet, COMPRESSION zstd)`);
    tablas.push({ tabla: nombre, grano, filas: c.filas });
  };
  for (const t of TABLAS_GOLD) await guardar(t.nombre, t.clave, t.grano, t.sql);
  await guardar('inventario_diario', "producto_key || '-' || almacen_key || '-' || fecha_key", 'producto, almacén y día (foto periódica)', SQL_INVENTARIO_DIARIO);

  const controles: Record<string, number> = {};
  const relaciones: [string, string, string, string][] = [
    ['fact_compras', 'producto_key', 'dim_producto', 'producto_key'], ['fact_compras', 'proveedor_key', 'dim_proveedor', 'proveedor_key'],
    ['fact_compras', 'almacen_key', 'dim_almacen', 'almacen_key'], ['fact_compras', 'fecha_pedido_key', 'dim_fecha', 'fecha_key'],
    ['fact_recepciones', 'producto_key', 'dim_producto', 'producto_key'], ['fact_recepciones', 'proveedor_key', 'dim_proveedor', 'proveedor_key'],
    ['fact_recepciones', 'fecha_recepcion_key', 'dim_fecha', 'fecha_key'],
    ['fact_movimientos_inventario', 'producto_key', 'dim_producto', 'producto_key'], ['fact_movimientos_inventario', 'almacen_key', 'dim_almacen', 'almacen_key'],
    ['fact_movimientos_inventario', 'fecha_key', 'dim_fecha', 'fecha_key'],
  ];
  for (const [hecho, col, dim, claveDim] of relaciones) {
    const h = await una(con, `SELECT count(*)::INTEGER AS n FROM g_${hecho} h ANTI JOIN g_${dim} d ON h.${col} = d.${claveDim}`);
    controles[`huerfanas_${hecho}.${col}`] = h.n;
    if (h.n > 0) throw new Error(`Gold ${hecho}.${col}: ${h.n} filas sin correspondencia en ${dim}`);
  }
  const cuadre = await una(con, `
    SELECT (SELECT sum(importe) FROM g_fact_compras)::DOUBLE AS gold_importe,
           (SELECT sum(cantidad * precio_unitario) FROM s_lineas_pedido)::DOUBLE AS silver_importe,
           (SELECT sum(cantidad) FROM g_fact_movimientos_inventario)::DOUBLE AS gold_stock,
           (SELECT sum(cantidad) FROM s_movimientos_stock)::DOUBLE AS silver_stock,
           (SELECT sum(cantidad_recibida) FROM g_fact_recepciones)::DOUBLE AS gold_recibido,
           (SELECT sum(cantidad_recibida) FROM g_fact_compras)::DOUBLE AS gold_recibido_en_compras,
           (SELECT sum(stock) FROM g_inventario_diario WHERE fecha_key = (SELECT max(fecha_key) FROM g_inventario_diario))::DOUBLE AS foto_stock_final`);
  const igual = (a: number, b: number) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005;
  if (!igual(cuadre.gold_importe, cuadre.silver_importe)) throw new Error('Gold: el importe de compras no cuadra con Silver');
  if (!igual(cuadre.gold_stock, cuadre.silver_stock)) throw new Error('Gold: el stock total no cuadra con Silver');
  if (!igual(cuadre.gold_recibido, cuadre.gold_recibido_en_compras)) throw new Error('Gold: lo recibido difiere entre hechos');
  if (!igual(cuadre.foto_stock_final, cuadre.gold_stock)) throw new Error('Gold: la foto diaria no cuadra con el libro de movimientos');
  return { tablas, controles: { ...controles, ...cuadre } };
}

/** Ejecuta el circuito completo y deja un registro JSON de la ejecución. */
export async function ejecutarPipeline(opciones: { completa?: boolean } = {}) {
  const r = rutas();
  const inicio = new Date();
  const id = inicio.toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z') + '-' + crypto.randomBytes(2).toString('hex');
  const t0 = Date.now();
  const bronze = await exportarBronze({ completa: opciones.completa, destino: r.raiz });
  const t1 = Date.now();
  const con = await conectarDuck();
  try {
    const silver = await construirSilver(con, id);
    const t2 = Date.now();
    const gold = await construirGold(con);
    const registro = {
      id_ejecucion: id, motor: 'duckdb (local)', inicio: inicio.toISOString(), fin: new Date().toISOString(), estado: 'correcta',
      duracion_ms: { bronze: t1 - t0, silver: t2 - t1, gold: Date.now() - t2, total: Date.now() - t0 },
      bronze: { id_carga: bronze.id_carga, total_filas: bronze.total_filas, tablas: bronze.tablas.map((t: any) => ({ tabla: t.tabla, modo: t.modo, filas: t.filas, marca_agua: t.marca_agua ?? null })) },
      silver: {
        tablas: silver.tablas, rechazos: silver.rechazos,
        totales: silver.tablas.reduce((s: any, t: any) => ({
          filas_leidas: s.filas_leidas + t.filas_leidas, duplicadas_eliminadas: s.duplicadas_eliminadas + t.duplicadas_eliminadas,
          rechazadas: s.rechazadas + t.rechazadas, escritas: s.escritas + t.escritas,
        }), { filas_leidas: 0, duplicadas_eliminadas: 0, rechazadas: 0, escritas: 0 }),
      },
      gold,
    };
    fs.mkdirSync(r.ejecuciones, { recursive: true });
    fs.writeFileSync(path.join(r.ejecuciones, `${id}.json`), JSON.stringify(registro, null, 2));
    return registro;
  } finally {
    con.closeSync?.();
  }
}

if (process.argv[1]?.endsWith('medallion.ts')) {
  ejecutarPipeline({ completa: process.argv.includes('--completa') })
    .then((e) => {
      console.log(`Ejecución ${e.id_ejecucion} · ${e.duracion_ms.total} ms (bronze ${e.duracion_ms.bronze}, silver ${e.duracion_ms.silver}, gold ${e.duracion_ms.gold})`);
      console.table(e.silver.tablas.map((t: any) => ({ silver: t.tabla, cargas: t.cargas_leidas, leídas: t.filas_leidas, duplicadas: t.duplicadas_eliminadas, rechazadas: t.rechazadas, escritas: t.escritas })));
      console.table(e.gold.tablas.map((t: any) => ({ gold: t.tabla, grano: t.grano, filas: t.filas })));
      process.exit(0);
    })
    .catch((e) => { console.error('Pipeline fallido:', e.message); process.exit(1); });
}
