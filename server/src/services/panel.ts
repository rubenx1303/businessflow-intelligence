import { q } from '../db/pool.js';
import { rendimientoProveedores, type Filtros } from './analitica.js';

/**
 * Panel de dirección calculado EN VIVO sobre la base operativa (PostgreSQL).
 *
 * Filtros: fechas, almacén, categoría, proveedor y producto.
 *  - En compras y entregas, "proveedor" es el del pedido y "producto" el de la línea.
 *  - En inventario y consumo no hay pedido: "proveedor" filtra por el proveedor preferente del producto.
 */
export async function dashboard(empresaId: number, f: Filtros) {
  const [p] = await q(
    `SELECT COALESCE($1::date, CURRENT_DATE - 364)::text AS desde, COALESCE($2::date, CURRENT_DATE)::text AS hasta,
            (COALESCE($2::date, CURRENT_DATE) - COALESCE($1::date, CURRENT_DATE - 364) + 1) AS dias`, [f.desde ?? null, f.hasta ?? null]);
  const alm = f.almacen_id ?? null, cat = f.categoria ?? null, prov = f.proveedor_id ?? null, prod = f.producto_id ?? null;

  // $1 empresa · $2 desde · $3 hasta · $4 almacén · $5 categoría · $6 proveedor · $7 producto
  const compras = [empresaId, p.desde, p.hasta, alm, cat, prov, prod];
  const filtroCompras = `pc.empresa_id = $1 AND pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido BETWEEN $2 AND $3
      AND ($4::int IS NULL OR pc.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)
      AND ($6::int IS NULL OR pc.proveedor_id = $6) AND ($7::int IS NULL OR pd.id = $7)`;

  const [tot] = await q(
    `SELECT COALESCE(sum(lp.cantidad * lp.precio_unitario), 0) AS gasto, count(DISTINCT pc.id)::int AS pedidos
       FROM pedidos_compra pc JOIN lineas_pedido lp ON lp.pedido_id = pc.id JOIN productos pd ON pd.id = lp.producto_id
      WHERE ${filtroCompras}`, compras);

  const gastoMensual = await q(
    `SELECT to_char(date_trunc('month', pc.fecha_pedido), 'YYYY-MM') AS mes, sum(lp.cantidad * lp.precio_unitario) AS gasto, count(DISTINCT pc.id)::int AS pedidos
       FROM pedidos_compra pc JOIN lineas_pedido lp ON lp.pedido_id = pc.id JOIN productos pd ON pd.id = lp.producto_id
      WHERE ${filtroCompras} GROUP BY 1 ORDER BY 1`, compras);

  // Puntualidad por PEDIDO: un pedido entra si cumple los filtros y (si se filtra por producto o categoría) contiene alguna línea que los cumpla.
  const [entregas] = await q(
    `SELECT avg((u.ultima <= pc.fecha_entrega_prevista)::int) AS otd, avg(GREATEST(u.ultima - pc.fecha_entrega_prevista, 0)) AS retraso_medio,
            count(*)::int AS completados, count(*) FILTER (WHERE u.ultima > pc.fecha_entrega_prevista)::int AS con_retraso
       FROM pedidos_compra pc JOIN LATERAL (SELECT max(r.fecha_recepcion) AS ultima FROM recepciones r WHERE r.pedido_id = pc.id) u ON true
      WHERE pc.empresa_id = $1 AND pc.estado = 'recibido' AND pc.fecha_pedido BETWEEN $2 AND $3
        AND ($4::int IS NULL OR pc.almacen_id = $4) AND ($6::int IS NULL OR pc.proveedor_id = $6)
        AND (($5::text IS NULL AND $7::int IS NULL) OR EXISTS (
              SELECT 1 FROM lineas_pedido lp JOIN productos pd ON pd.id = lp.producto_id
               WHERE lp.pedido_id = pc.id AND ($5::text IS NULL OR pd.categoria = $5) AND ($7::int IS NULL OR pd.id = $7)))`, compras);

  // $1 empresa · $2 almacén · $3 categoría · $4 proveedor preferente · $5 producto
  const inventario = [empresaId, alm, cat, prov, prod];
  const filtroProducto = `($3::text IS NULL OR pd.categoria = $3) AND ($4::int IS NULL OR pd.proveedor_preferente_id = $4) AND ($5::int IS NULL OR pd.id = $5)`;
  const [inv] = await q(
    `SELECT COALESCE(sum(e.stock * pd.coste_estandar), 0) AS valor
       FROM v_existencias e JOIN productos pd ON pd.id = e.producto_id
      WHERE e.empresa_id = $1 AND ($2::int IS NULL OR e.almacen_id = $2) AND ${filtroProducto}`, inventario);

  // Bajo mínimo: el mínimo es global del producto, así que se compara con el stock de todos los almacenes (el filtro de almacén no aplica).
  const bajoMinimo = await q(
    `SELECT pd.id, pd.sku, pd.nombre, pd.categoria, pd.unidad, pd.stock_minimo, COALESCE(s.stock, 0) AS stock
       FROM productos pd LEFT JOIN (SELECT producto_id, sum(stock) AS stock FROM v_existencias WHERE empresa_id = $1 GROUP BY 1) s ON s.producto_id = pd.id
      WHERE pd.empresa_id = $1 AND pd.activo AND COALESCE(s.stock, 0) < pd.stock_minimo
        AND ($2::text IS NULL OR pd.categoria = $2) AND ($3::int IS NULL OR pd.proveedor_preferente_id = $3) AND ($4::int IS NULL OR pd.id = $4)
      ORDER BY COALESCE(s.stock, 0) / NULLIF(pd.stock_minimo, 0)`, [empresaId, cat, prov, prod]);

  const consumoCategoria = await q(
    `SELECT pd.categoria, sum(-m.cantidad * m.coste_unitario) AS valor, sum(-m.cantidad) AS unidades
       FROM movimientos_stock m JOIN productos pd ON pd.id = m.producto_id
      WHERE m.empresa_id = $1 AND m.tipo = 'SALIDA_CONSUMO' AND m.fecha >= $2::date AND m.fecha < $3::date + 1
        AND ($4::int IS NULL OR m.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)
        AND ($6::int IS NULL OR pd.proveedor_preferente_id = $6) AND ($7::int IS NULL OR pd.id = $7)
      GROUP BY pd.categoria ORDER BY valor DESC`, compras);
  const consumo = consumoCategoria.reduce((s, c) => s + c.valor, 0);

  const consumoMensual = await q(
    `SELECT to_char(date_trunc('month', m.fecha), 'YYYY-MM') AS mes, sum(-m.cantidad * m.coste_unitario) AS valor
       FROM movimientos_stock m JOIN productos pd ON pd.id = m.producto_id
      WHERE m.empresa_id = $1 AND m.tipo = 'SALIDA_CONSUMO' AND m.fecha >= $2::date AND m.fecha < $3::date + 1
        AND ($4::int IS NULL OR m.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)
        AND ($6::int IS NULL OR pd.proveedor_preferente_id = $6) AND ($7::int IS NULL OR pd.id = $7)
      GROUP BY 1 ORDER BY 1`, compras);

  const [abiertos] = await q(
    `SELECT count(*)::int AS abiertos, count(*) FILTER (WHERE fecha_entrega_prevista < CURRENT_DATE)::int AS retrasados
       FROM pedidos_compra WHERE empresa_id = $1 AND estado IN ('enviado','parcial')
        AND ($2::int IS NULL OR almacen_id = $2) AND ($3::int IS NULL OR proveedor_id = $3)`, [empresaId, alm, prov]);

  const retrasados = await q(
    `SELECT pc.id, pc.numero, pr.nombre AS proveedor, pc.fecha_entrega_prevista, (CURRENT_DATE - pc.fecha_entrega_prevista) AS dias_retraso
       FROM pedidos_compra pc JOIN proveedores pr ON pr.id = pc.proveedor_id
      WHERE pc.empresa_id = $1 AND pc.estado IN ('enviado','parcial') AND pc.fecha_entrega_prevista < CURRENT_DATE
        AND ($2::int IS NULL OR pc.almacen_id = $2) AND ($3::int IS NULL OR pc.proveedor_id = $3)
      ORDER BY dias_retraso DESC LIMIT 8`, [empresaId, alm, prov]);

  // Distribución de retrasos de los pedidos completados (para el histograma de puntualidad).
  const distribucionRetraso = await q(
    `SELECT CASE WHEN d <= 0 THEN 'A tiempo' WHEN d <= 2 THEN '1-2 días' WHEN d <= 5 THEN '3-5 días' ELSE 'Más de 5 días' END AS tramo,
            min(LEAST(GREATEST(d, 0), 6)) AS orden, count(*)::int AS pedidos
       FROM (SELECT (u.ultima - pc.fecha_entrega_prevista) AS d
               FROM pedidos_compra pc JOIN LATERAL (SELECT max(r.fecha_recepcion) AS ultima FROM recepciones r WHERE r.pedido_id = pc.id) u ON true
              WHERE pc.empresa_id = $1 AND pc.estado = 'recibido' AND pc.fecha_pedido BETWEEN $2 AND $3
                AND ($4::int IS NULL OR pc.almacen_id = $4) AND ($6::int IS NULL OR pc.proveedor_id = $6)
                AND (($5::text IS NULL AND $7::int IS NULL) OR EXISTS (
                      SELECT 1 FROM lineas_pedido lp JOIN productos pd ON pd.id = lp.producto_id
                       WHERE lp.pedido_id = pc.id AND ($5::text IS NULL OR pd.categoria = $5) AND ($7::int IS NULL OR pd.id = $7)))) t
      GROUP BY 1 ORDER BY 2`, compras);

  const proveedores = (await rendimientoProveedores(empresaId, { ...f, desde: p.desde, hasta: p.hasta }))
    .filter((x) => x.pedidos > 0 && (prov === null || x.proveedor_id === prov));

  return {
    periodo: p,
    filtros: { almacen_id: alm, categoria: cat, proveedor_id: prov, producto_id: prod },
    kpis: {
      gasto_compras: tot.gasto,
      pedidos: tot.pedidos,
      valor_inventario: inv.valor,
      productos_bajo_minimo: bajoMinimo.length,
      entregas_puntuales: entregas.otd,
      retraso_medio_dias: entregas.retraso_medio,
      pedidos_completados: entregas.completados,
      pedidos_con_retraso: entregas.con_retraso,
      consumo_valorado: consumo,
      // Rotación anualizada = coste del consumo del periodo llevado a 365 días / valor actual del inventario.
      rotacion_inventario: inv.valor > 0 ? (consumo * 365 / p.dias) / inv.valor : null,
      pedidos_abiertos: abiertos.abiertos,
      pedidos_retrasados: abiertos.retrasados,
    },
    gasto_mensual: gastoMensual,
    consumo_mensual: consumoMensual,
    consumo_categoria: consumoCategoria,
    distribucion_retraso: distribucionRetraso,
    top_proveedores: proveedores.slice(0, 8),
    alertas: { bajo_minimo: bajoMinimo.slice(0, 8), pedidos_retrasados: retrasados },
  };
}
