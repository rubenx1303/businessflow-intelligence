import { q } from '../db/pool.js';
import { calcularReposicion, puntuarProveedor, PARAMETROS_POR_DEFECTO } from './reposicion.js';

export interface Filtros { desde?: string; hasta?: string; almacen_id?: number; categoria?: string }

/** Periodo por defecto: últimos 12 meses hasta hoy. */
async function periodo(f: Filtros): Promise<{ desde: string; hasta: string; dias: number }> {
  const [r] = await q(
    `SELECT COALESCE($1::date, CURRENT_DATE - 364)::text AS desde, COALESCE($2::date, CURRENT_DATE)::text AS hasta,
            (COALESCE($2::date, CURRENT_DATE) - COALESCE($1::date, CURRENT_DATE - 364) + 1) AS dias`, [f.desde ?? null, f.hasta ?? null]);
  return r;
}

export async function rendimientoProveedores(empresaId: number, f: Filtros) {
  const filas = await q(
    `WITH ped AS (
       SELECT pc.id, pc.proveedor_id, pc.estado, pc.fecha_pedido, pc.fecha_entrega_prevista AS prevista,
              (SELECT max(r.fecha_recepcion) FROM recepciones r WHERE r.pedido_id = pc.id) AS ultima,
              t.importe, t.recibido, t.rechazado
         FROM pedidos_compra pc
         JOIN LATERAL (SELECT sum(v.cantidad * v.precio_unitario) AS importe, sum(v.recibido) AS recibido, sum(v.rechazado) AS rechazado
                         FROM v_lineas_pedido_estado v WHERE v.pedido_id = pc.id) t ON true
        WHERE pc.empresa_id = $1 AND pc.estado NOT IN ('borrador','cancelado')
          AND ($2::date IS NULL OR pc.fecha_pedido >= $2) AND ($3::date IS NULL OR pc.fecha_pedido <= $3)
          AND ($4::int IS NULL OR pc.almacen_id = $4))
     SELECT pr.id AS proveedor_id, pr.codigo, pr.nombre, pr.estado, pr.plazo_entrega_dias AS plazo_acordado,
            count(ped.id)::int AS pedidos,
            count(*) FILTER (WHERE ped.estado = 'recibido')::int AS completados,
            COALESCE(sum(ped.importe), 0) AS gasto,
            avg((ped.ultima <= ped.prevista)::int) FILTER (WHERE ped.estado = 'recibido') AS otd,
            avg(GREATEST(ped.ultima - ped.prevista, 0)) FILTER (WHERE ped.estado = 'recibido') AS retraso_medio,
            avg(ped.ultima - ped.fecha_pedido) FILTER (WHERE ped.estado = 'recibido') AS plazo_real,
            sum(ped.rechazado) / NULLIF(sum(ped.recibido) + sum(ped.rechazado), 0) AS tasa_rechazo
       FROM proveedores pr LEFT JOIN ped ON ped.proveedor_id = pr.id
      WHERE pr.empresa_id = $1
      GROUP BY pr.id ORDER BY gasto DESC`,
    [empresaId, f.desde ?? null, f.hasta ?? null, f.almacen_id ?? null]);
  return filas.map((m) => ({
    ...m,
    puntuacion: puntuarProveedor({ otd: m.otd, tasaRechazo: m.tasa_rechazo, retrasoMedio: m.retraso_medio }),
  }));
}

export async function dashboard(empresaId: number, f: Filtros) {
  const p = await periodo(f);
  const base = [empresaId, p.desde, p.hasta, f.almacen_id ?? null, f.categoria ?? null];

  const [compras] = await q(
    `SELECT COALESCE(sum(lp.cantidad * lp.precio_unitario), 0) AS gasto, count(DISTINCT pc.id)::int AS pedidos
       FROM pedidos_compra pc JOIN lineas_pedido lp ON lp.pedido_id = pc.id JOIN productos pd ON pd.id = lp.producto_id
      WHERE pc.empresa_id = $1 AND pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido BETWEEN $2 AND $3
        AND ($4::int IS NULL OR pc.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)`, base);

  const [inv] = await q(
    `SELECT COALESCE(sum(e.stock * pd.coste_estandar), 0) AS valor
       FROM v_existencias e JOIN productos pd ON pd.id = e.producto_id
      WHERE e.empresa_id = $1 AND ($2::int IS NULL OR e.almacen_id = $2) AND ($3::text IS NULL OR pd.categoria = $3)`,
    [empresaId, f.almacen_id ?? null, f.categoria ?? null]);

  // Bajo mínimo: se compara el stock total de la empresa con el mínimo del producto (el mínimo es global, no por almacén).
  const bajoMinimo = await q(
    `SELECT pd.id, pd.sku, pd.nombre, pd.categoria, pd.unidad, pd.stock_minimo, COALESCE(s.stock, 0) AS stock
       FROM productos pd LEFT JOIN (SELECT producto_id, sum(stock) AS stock FROM v_existencias WHERE empresa_id = $1 GROUP BY 1) s ON s.producto_id = pd.id
      WHERE pd.empresa_id = $1 AND pd.activo AND COALESCE(s.stock, 0) < pd.stock_minimo AND ($2::text IS NULL OR pd.categoria = $2)
      ORDER BY COALESCE(s.stock, 0) / NULLIF(pd.stock_minimo, 0)`, [empresaId, f.categoria ?? null]);

  const [entregas] = await q(
    `SELECT avg((u.ultima <= pc.fecha_entrega_prevista)::int) AS otd, avg(GREATEST(u.ultima - pc.fecha_entrega_prevista, 0)) AS retraso_medio,
            count(*)::int AS completados
       FROM pedidos_compra pc JOIN LATERAL (SELECT max(r.fecha_recepcion) AS ultima FROM recepciones r WHERE r.pedido_id = pc.id) u ON true
      WHERE pc.empresa_id = $1 AND pc.estado = 'recibido' AND pc.fecha_pedido BETWEEN $2 AND $3 AND ($4::int IS NULL OR pc.almacen_id = $4)`,
    base.slice(0, 4));

  const [abiertos] = await q(
    `SELECT count(*)::int AS abiertos, count(*) FILTER (WHERE fecha_entrega_prevista < CURRENT_DATE)::int AS retrasados
       FROM pedidos_compra WHERE empresa_id = $1 AND estado IN ('enviado','parcial') AND ($2::int IS NULL OR almacen_id = $2)`,
    [empresaId, f.almacen_id ?? null]);

  const consumoCategoria = await q(
    `SELECT pd.categoria, sum(-m.cantidad * m.coste_unitario) AS valor, sum(-m.cantidad) AS unidades
       FROM movimientos_stock m JOIN productos pd ON pd.id = m.producto_id
      WHERE m.empresa_id = $1 AND m.tipo = 'SALIDA_CONSUMO' AND m.fecha >= $2::date AND m.fecha < $3::date + 1
        AND ($4::int IS NULL OR m.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)
      GROUP BY pd.categoria ORDER BY valor DESC`, base);
  const consumo = consumoCategoria.reduce((s, c) => s + c.valor, 0);

  const gastoMensual = await q(
    `SELECT to_char(date_trunc('month', pc.fecha_pedido), 'YYYY-MM') AS mes, sum(lp.cantidad * lp.precio_unitario) AS gasto, count(DISTINCT pc.id)::int AS pedidos
       FROM pedidos_compra pc JOIN lineas_pedido lp ON lp.pedido_id = pc.id JOIN productos pd ON pd.id = lp.producto_id
      WHERE pc.empresa_id = $1 AND pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido BETWEEN $2 AND $3
        AND ($4::int IS NULL OR pc.almacen_id = $4) AND ($5::text IS NULL OR pd.categoria = $5)
      GROUP BY 1 ORDER BY 1`, base);

  const retrasados = await q(
    `SELECT pc.id, pc.numero, pr.nombre AS proveedor, pc.fecha_entrega_prevista, (CURRENT_DATE - pc.fecha_entrega_prevista) AS dias_retraso
       FROM pedidos_compra pc JOIN proveedores pr ON pr.id = pc.proveedor_id
      WHERE pc.empresa_id = $1 AND pc.estado IN ('enviado','parcial') AND pc.fecha_entrega_prevista < CURRENT_DATE
        AND ($2::int IS NULL OR pc.almacen_id = $2)
      ORDER BY dias_retraso DESC LIMIT 8`, [empresaId, f.almacen_id ?? null]);

  const proveedores = (await rendimientoProveedores(empresaId, { ...f, desde: p.desde, hasta: p.hasta })).filter((x) => x.pedidos > 0);

  return {
    periodo: p,
    kpis: {
      gasto_compras: compras.gasto,
      pedidos: compras.pedidos,
      valor_inventario: inv.valor,
      productos_bajo_minimo: bajoMinimo.length,
      entregas_puntuales: entregas.otd,
      retraso_medio_dias: entregas.retraso_medio,
      consumo_valorado: consumo,
      // Rotación anualizada = coste del consumo del periodo llevado a 365 días / valor actual del inventario.
      rotacion_inventario: inv.valor > 0 ? (consumo * 365 / p.dias) / inv.valor : null,
      pedidos_abiertos: abiertos.abiertos,
      pedidos_retrasados: abiertos.retrasados,
    },
    gasto_mensual: gastoMensual,
    consumo_categoria: consumoCategoria,
    top_proveedores: proveedores.slice(0, 6),
    alertas: { bajo_minimo: bajoMinimo.slice(0, 8), pedidos_retrasados: retrasados },
  };
}

export async function reposicion(empresaId: number, params = PARAMETROS_POR_DEFECTO) {
  const filas = await q(
    `WITH dias AS (SELECT generate_series(CURRENT_DATE - 89, CURRENT_DATE, interval '1 day')::date AS d),
     cons AS (
       SELECT producto_id, fecha::date AS d, sum(-cantidad) AS c FROM movimientos_stock
        WHERE empresa_id = $1 AND tipo = 'SALIDA_CONSUMO' AND fecha >= CURRENT_DATE - 89 GROUP BY 1, 2),
     est AS (
       SELECT pd.id, avg(COALESCE(c.c, 0)) AS media, COALESCE(stddev_samp(COALESCE(c.c, 0)), 0) AS sigma
         FROM productos pd CROSS JOIN dias LEFT JOIN cons c ON c.producto_id = pd.id AND c.d = dias.d
        WHERE pd.empresa_id = $1 AND pd.activo GROUP BY pd.id),
     stk AS (SELECT producto_id, sum(stock) AS stock FROM v_existencias WHERE empresa_id = $1 GROUP BY 1),
     camino AS (
       SELECT v.producto_id, sum(v.pendiente) AS en_camino FROM v_lineas_pedido_estado v JOIN pedidos_compra pc ON pc.id = v.pedido_id
        WHERE pc.empresa_id = $1 AND pc.estado IN ('enviado','parcial') GROUP BY 1),
     plazo AS (
       SELECT pc.proveedor_id, avg(u.ultima - pc.fecha_pedido) AS plazo_real
         FROM pedidos_compra pc JOIN LATERAL (SELECT max(r.fecha_recepcion) AS ultima FROM recepciones r WHERE r.pedido_id = pc.id) u ON true
        WHERE pc.empresa_id = $1 AND pc.estado = 'recibido' AND pc.fecha_pedido >= CURRENT_DATE - 365 GROUP BY 1)
     SELECT pd.id AS producto_id, pd.sku, pd.nombre, pd.categoria, pd.unidad, pd.coste_estandar, pd.stock_minimo, pd.lote_compra,
            pd.proveedor_preferente_id AS proveedor_id, pr.nombre AS proveedor, pr.estado AS proveedor_estado,
            COALESCE(stk.stock, 0) AS stock, COALESCE(camino.en_camino, 0) AS en_camino,
            est.media AS consumo_medio_diario, est.sigma AS sigma_diaria,
            COALESCE(plazo.plazo_real, pr.plazo_entrega_dias, 7) AS plazo_dias, (plazo.plazo_real IS NOT NULL) AS plazo_es_real
       FROM productos pd
       JOIN est ON est.id = pd.id
       LEFT JOIN stk ON stk.producto_id = pd.id
       LEFT JOIN camino ON camino.producto_id = pd.id
       LEFT JOIN proveedores pr ON pr.id = pd.proveedor_preferente_id
       LEFT JOIN plazo ON plazo.proveedor_id = pr.id
      WHERE pd.empresa_id = $1 AND pd.activo`, [empresaId]);

  const orden: Record<string, number> = { critica: 0, alta: 1, vigilar: 2, ok: 3, sin_consumo: 4 };
  return {
    parametros: params,
    filas: filas.map((r) => {
      const c = calcularReposicion({
        stock: r.stock, enCamino: r.en_camino, consumoMedioDiario: r.consumo_medio_diario, sigmaDiaria: r.sigma_diaria,
        plazoDias: r.plazo_dias, loteCompra: r.lote_compra, stockMinimo: r.stock_minimo,
      }, params);
      return {
        ...r,
        stock_seguridad: c.stockSeguridad, punto_pedido: c.puntoPedido, posicion_inventario: c.posicionInventario,
        dias_cobertura: c.diasCobertura, cantidad_sugerida: c.cantidadSugerida, urgencia: c.urgencia, motivo: c.motivo,
        importe_sugerido: Math.round(c.cantidadSugerida * r.coste_estandar * 100) / 100,
      };
    }).sort((a, b) => orden[a.urgencia] - orden[b.urgencia] || b.importe_sugerido - a.importe_sugerido),
  };
}

/** Análisis de costes: gasto por producto y variación del precio medio de compra (últimos 90 días frente a los 90 anteriores). */
export async function costes(empresaId: number) {
  return q(
    `WITH l AS (
       SELECT lp.producto_id, lp.cantidad, lp.precio_unitario, pc.fecha_pedido
         FROM lineas_pedido lp JOIN pedidos_compra pc ON pc.id = lp.pedido_id
        WHERE pc.empresa_id = $1 AND pc.estado NOT IN ('borrador','cancelado') AND pc.fecha_pedido >= CURRENT_DATE - 364)
     SELECT pd.id AS producto_id, pd.sku, pd.nombre, pd.categoria, pd.coste_estandar,
            sum(l.cantidad * l.precio_unitario) AS gasto_12m, sum(l.cantidad) AS unidades_12m,
            sum(l.cantidad * l.precio_unitario) / NULLIF(sum(l.cantidad), 0) AS precio_medio_12m,
            sum(l.cantidad * l.precio_unitario) FILTER (WHERE l.fecha_pedido >= CURRENT_DATE - 89)
              / NULLIF(sum(l.cantidad) FILTER (WHERE l.fecha_pedido >= CURRENT_DATE - 89), 0) AS precio_reciente,
            sum(l.cantidad * l.precio_unitario) FILTER (WHERE l.fecha_pedido BETWEEN CURRENT_DATE - 179 AND CURRENT_DATE - 90)
              / NULLIF(sum(l.cantidad) FILTER (WHERE l.fecha_pedido BETWEEN CURRENT_DATE - 179 AND CURRENT_DATE - 90), 0) AS precio_anterior
       FROM productos pd JOIN l ON l.producto_id = pd.id
      WHERE pd.empresa_id = $1
      GROUP BY pd.id ORDER BY gasto_12m DESC`, [empresaId])
    .then((filas) => filas.map((r) => ({
      ...r,
      variacion_precio: r.precio_reciente && r.precio_anterior ? (r.precio_reciente - r.precio_anterior) / r.precio_anterior : null,
      desviacion_estandar: r.precio_medio_12m && r.coste_estandar ? (r.precio_medio_12m - r.coste_estandar) / r.coste_estandar : null,
    })));
}
