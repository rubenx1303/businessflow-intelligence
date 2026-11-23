import { q } from '../db/pool.js';
import { calcularReposicion, puntuarProveedor, PARAMETROS_POR_DEFECTO } from './reposicion.js';

export interface Filtros { desde?: string; hasta?: string; almacen_id?: number; categoria?: string; proveedor_id?: number; producto_id?: number }

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
