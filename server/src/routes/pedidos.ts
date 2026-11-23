import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db/pool.js';
import { ErrorHttp, auditar, conflicto, idParam, noEncontrado, permitir } from '../http.js';

export const pedidos = Router();

const esquemaPedido = z.object({
  proveedor_id: z.coerce.number().int().positive(),
  almacen_id: z.coerce.number().int().positive(),
  fecha_entrega_prevista: z.iso.date(),
  notas: z.string().trim().max(1000).nullish().transform((v) => v || null),
  lineas: z.array(z.object({
    producto_id: z.coerce.number().int().positive(),
    cantidad: z.coerce.number().positive().max(10_000_000),
    precio_unitario: z.coerce.number().min(0).max(1_000_000),
  })).min(1, 'El pedido necesita al menos una línea'),
}).refine((d) => new Set(d.lineas.map((l) => l.producto_id)).size === d.lineas.length,
  { path: ['lineas'], message: 'Hay productos repetidos: agrupa las cantidades en una sola línea' });

pedidos.get('/', async (req, res) => {
  const f = z.object({
    estado: z.string().optional(), proveedor_id: z.coerce.number().int().optional(), buscar: z.string().trim().optional(),
    desde: z.iso.date().optional(), hasta: z.iso.date().optional(),
    pagina: z.coerce.number().int().min(1).default(1), tamano: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const params = [req.sesion.empresaId, f.estado || null, f.proveedor_id ?? null, f.buscar || null, f.desde ?? null, f.hasta ?? null];
  const donde = `pc.empresa_id = $1 AND ($2::text IS NULL OR pc.estado = $2) AND ($3::int IS NULL OR pc.proveedor_id = $3)
    AND ($4::text IS NULL OR pc.numero ILIKE '%'||$4||'%' OR pr.nombre ILIKE '%'||$4||'%')
    AND ($5::date IS NULL OR pc.fecha_pedido >= $5) AND ($6::date IS NULL OR pc.fecha_pedido <= $6)`;
  const [{ total }] = await q(`SELECT count(*)::int AS total FROM pedidos_compra pc JOIN proveedores pr ON pr.id = pc.proveedor_id WHERE ${donde}`, params);
  const filas = await q(
    `SELECT pc.id, pc.numero, pc.estado, pc.fecha_pedido, pc.fecha_entrega_prevista, pr.nombre AS proveedor, a.nombre AS almacen,
            t.importe, t.lineas, t.pct_recibido,
            (pc.estado IN ('enviado','parcial') AND pc.fecha_entrega_prevista < CURRENT_DATE) AS retrasado
       FROM pedidos_compra pc
       JOIN proveedores pr ON pr.id = pc.proveedor_id
       JOIN almacenes a ON a.id = pc.almacen_id
       JOIN LATERAL (
         SELECT COALESCE(sum(v.cantidad * v.precio_unitario), 0) AS importe, count(*)::int AS lineas,
                CASE WHEN sum(v.cantidad) > 0 THEN round(100 * sum(LEAST(v.recibido, v.cantidad)) / sum(v.cantidad), 1) ELSE 0 END AS pct_recibido
           FROM v_lineas_pedido_estado v WHERE v.pedido_id = pc.id) t ON true
      WHERE ${donde} ORDER BY pc.fecha_pedido DESC, pc.id DESC LIMIT $7 OFFSET $8`,
    [...params, f.tamano, (f.pagina - 1) * f.tamano]);
  res.json({ total, pagina: f.pagina, tamano: f.tamano, filas });
});

async function detalle(empresaId: number, id: number) {
  const [p] = await q(
    `SELECT pc.*, pr.nombre AS proveedor, a.nombre AS almacen FROM pedidos_compra pc
       JOIN proveedores pr ON pr.id = pc.proveedor_id JOIN almacenes a ON a.id = pc.almacen_id
      WHERE pc.id = $1 AND pc.empresa_id = $2`, [id, empresaId]);
  if (!p) throw noEncontrado('Pedido');
  const lineas = await q(
    `SELECT v.linea_pedido_id AS id, v.producto_id, pd.sku, pd.nombre AS producto, pd.unidad, v.cantidad, v.precio_unitario,
            v.recibido, v.rechazado, v.pendiente, v.cantidad * v.precio_unitario AS importe
       FROM v_lineas_pedido_estado v JOIN productos pd ON pd.id = v.producto_id WHERE v.pedido_id = $1 ORDER BY pd.nombre`, [id]);
  const recepciones = await q(
    `SELECT r.id, r.albaran, r.fecha_recepcion, r.notas,
            (SELECT json_agg(json_build_object('linea_pedido_id', lr.linea_pedido_id, 'recibida', lr.cantidad_recibida, 'rechazada', lr.cantidad_rechazada))
               FROM lineas_recepcion lr WHERE lr.recepcion_id = r.id) AS lineas
       FROM recepciones r WHERE r.pedido_id = $1 ORDER BY r.fecha_recepcion, r.id`, [id]);
  return { ...p, importe: lineas.reduce((s, l) => s + l.importe, 0), lineas, recepciones };
}

pedidos.get('/:id', async (req, res) => res.json(await detalle(req.sesion.empresaId, idParam(req))));

pedidos.post('/', permitir('compras'), async (req, res) => {
  const d = esquemaPedido.parse(req.body), e = req.sesion.empresaId;
  const id = await tx(async (c) => {
    const { rows: [pr] } = await c.query('SELECT estado FROM proveedores WHERE id = $1 AND empresa_id = $2', [d.proveedor_id, e]);
    if (!pr) throw noEncontrado('Proveedor');
    if (pr.estado !== 'activo') throw conflicto(`No se puede pedir a un proveedor en estado "${pr.estado}"`);
    const { rows: [al] } = await c.query('SELECT id FROM almacenes WHERE id = $1 AND empresa_id = $2 AND activo', [d.almacen_id, e]);
    if (!al) throw noEncontrado('Almacén');
    const { rows: prods } = await c.query('SELECT id FROM productos WHERE empresa_id = $1 AND activo AND id = ANY($2::int[])', [e, d.lineas.map((l) => l.producto_id)]);
    if (prods.length !== d.lineas.length) throw new ErrorHttp(400, 'Alguna línea usa un producto inexistente o inactivo', 'VALIDACION');
    const { rows: [{ hoy }] } = await c.query(`SELECT CURRENT_DATE::text AS hoy`);
    if (d.fecha_entrega_prevista < hoy) throw new ErrorHttp(400, 'La fecha de entrega prevista no puede ser anterior a hoy', 'VALIDACION');

    // Numeración correlativa por empresa y año, protegida contra concurrencia.
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pedido-numero-${e}`]);
    const anio = hoy.slice(0, 4);
    const { rows: [{ n }] } = await c.query(
      `SELECT COALESCE(max(split_part(numero, '-', 3)::int), 0) + 1 AS n FROM pedidos_compra WHERE empresa_id = $1 AND numero LIKE $2`, [e, `PC-${anio}-%`]);
    const numero = `PC-${anio}-${String(n).padStart(4, '0')}`;
    const { rows: [p] } = await c.query(
      `INSERT INTO pedidos_compra (empresa_id, numero, proveedor_id, almacen_id, fecha_entrega_prevista, notas, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [e, numero, d.proveedor_id, d.almacen_id, d.fecha_entrega_prevista, d.notas, req.sesion.id]);
    for (const l of d.lineas) {
      await c.query('INSERT INTO lineas_pedido (pedido_id, producto_id, cantidad, precio_unitario) VALUES ($1,$2,$3,$4)', [p.id, l.producto_id, l.cantidad, l.precio_unitario]);
    }
    await auditar(req.sesion, 'crear', 'pedido', p.id, { numero, lineas: d.lineas.length }, c);
    return p.id as number;
  });
  res.status(201).json(await detalle(e, id));
});

/** Transiciones de estado manuales: borrador → enviado, y cancelación mientras no haya mercancía recibida. */
const transicion = (accion: 'enviar' | 'cancelar') => async (req: any, res: any) => {
  const id = idParam(req), e = req.sesion.empresaId;
  await tx(async (c) => {
    const { rows: [p] } = await c.query('SELECT estado FROM pedidos_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, e]);
    if (!p) throw noEncontrado('Pedido');
    const validos = accion === 'enviar' ? ['borrador'] : ['borrador', 'enviado'];
    if (!validos.includes(p.estado)) throw conflicto(`Un pedido en estado "${p.estado}" no se puede ${accion}`);
    const nuevo = accion === 'enviar' ? 'enviado' : 'cancelado';
    await c.query('UPDATE pedidos_compra SET estado = $2, actualizado_en = now() WHERE id = $1', [id, nuevo]);
    await auditar(req.sesion, accion, 'pedido', id, { de: p.estado, a: nuevo }, c);
  });
  res.json(await detalle(e, id));
};
pedidos.post('/:id/enviar', permitir('compras'), transicion('enviar'));
pedidos.post('/:id/cancelar', permitir('compras'), transicion('cancelar'));

const esquemaRecepcion = z.object({
  albaran: z.string().trim().min(1).max(40),
  fecha_recepcion: z.iso.date().optional(),
  notas: z.string().trim().max(1000).nullish().transform((v) => v || null),
  lineas: z.array(z.object({
    linea_pedido_id: z.coerce.number().int().positive(),
    cantidad_recibida: z.coerce.number().min(0),
    cantidad_rechazada: z.coerce.number().min(0).default(0),
  })).min(1),
});

/**
 * Recepción (total o parcial). En una sola transacción: registra el albarán, genera las entradas
 * de stock por la cantidad aceptada y recalcula el estado del pedido.
 */
pedidos.post('/:id/recepciones', permitir('almacen', 'compras'), async (req, res) => {
  const id = idParam(req), e = req.sesion.empresaId, d = esquemaRecepcion.parse(req.body);
  const lineas = d.lineas.filter((l) => l.cantidad_recibida + l.cantidad_rechazada > 0);
  if (!lineas.length) throw new ErrorHttp(400, 'Indica al menos una cantidad recibida o rechazada', 'VALIDACION');

  await tx(async (c) => {
    const { rows: [p] } = await c.query('SELECT * FROM pedidos_compra WHERE id = $1 AND empresa_id = $2 FOR UPDATE', [id, e]);
    if (!p) throw noEncontrado('Pedido');
    if (!['enviado', 'parcial'].includes(p.estado)) throw conflicto(`Un pedido en estado "${p.estado}" no admite recepciones`);
    const { rows: [{ hoy }] } = await c.query('SELECT CURRENT_DATE::text AS hoy');
    const fecha = d.fecha_recepcion ?? hoy;
    if (fecha > hoy) throw new ErrorHttp(400, 'La fecha de recepción no puede ser futura', 'VALIDACION');
    if (fecha < p.fecha_pedido) throw new ErrorHttp(400, 'La fecha de recepción no puede ser anterior al pedido', 'VALIDACION');

    const { rows: estado } = await c.query('SELECT * FROM v_lineas_pedido_estado WHERE pedido_id = $1', [id]);
    const porId = new Map(estado.map((l) => [l.linea_pedido_id, l]));
    for (const l of lineas) {
      const lp = porId.get(l.linea_pedido_id);
      if (!lp) throw new ErrorHttp(400, `La línea ${l.linea_pedido_id} no pertenece a este pedido`, 'VALIDACION');
      if (l.cantidad_recibida > lp.pendiente + 1e-9) throw conflicto(`Se intenta recibir ${l.cantidad_recibida} y solo quedan ${lp.pendiente} pendientes`);
    }

    const { rows: [r] } = await c.query(
      'INSERT INTO recepciones (empresa_id, pedido_id, albaran, fecha_recepcion, notas, creado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [e, id, d.albaran, fecha, d.notas, req.sesion.id]);
    for (const l of lineas) {
      const lp = porId.get(l.linea_pedido_id)!;
      await c.query('INSERT INTO lineas_recepcion (recepcion_id, linea_pedido_id, cantidad_recibida, cantidad_rechazada) VALUES ($1,$2,$3,$4)',
        [r.id, l.linea_pedido_id, l.cantidad_recibida, l.cantidad_rechazada]);
      if (l.cantidad_recibida > 0) {
        await c.query(
          `INSERT INTO movimientos_stock (empresa_id, producto_id, almacen_id, tipo, cantidad, coste_unitario, referencia, recepcion_id, fecha, creado_por)
           VALUES ($1,$2,$3,'ENTRADA_COMPRA',$4,$5,$6,$7,$8::date + (now() - CURRENT_DATE),$9)`,
          [e, lp.producto_id, p.almacen_id, l.cantidad_recibida, lp.precio_unitario, `${p.numero} / ${d.albaran}`, r.id, fecha, req.sesion.id]);
      }
    }
    const { rows: [{ pendiente }] } = await c.query('SELECT COALESCE(sum(pendiente), 0) AS pendiente FROM v_lineas_pedido_estado WHERE pedido_id = $1', [id]);
    const nuevo = pendiente <= 1e-9 ? 'recibido' : 'parcial';
    await c.query('UPDATE pedidos_compra SET estado = $2, actualizado_en = now() WHERE id = $1', [id, nuevo]);
    await auditar(req.sesion, 'recepcion', 'pedido', id, { recepcion_id: r.id, albaran: d.albaran, estado: nuevo }, c);
  });
  res.status(201).json(await detalle(e, id));
});
