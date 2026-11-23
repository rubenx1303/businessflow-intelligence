import { Router } from 'express';
import { z } from 'zod';
import { q, tx } from '../db/pool.js';
import { auditar, conflicto, idParam, noEncontrado, permitir } from '../http.js';

export const inventario = Router();

// ---------- Almacenes ----------
const esquemaAlmacen = z.object({
  codigo: z.string().trim().min(1).max(20).regex(/^[A-Z0-9-]+$/, 'Solo mayúsculas, números y guiones'),
  nombre: z.string().trim().min(1).max(120),
  ciudad: z.string().trim().max(80).nullish().transform((v) => v || null),
  activo: z.boolean().default(true),
});

inventario.get('/almacenes', async (req, res) => {
  res.json(await q(
    `SELECT a.*, COALESCE((SELECT sum(e.stock * p.coste_estandar) FROM v_existencias e JOIN productos p ON p.id = e.producto_id WHERE e.almacen_id = a.id), 0) AS valor_stock
       FROM almacenes a WHERE a.empresa_id = $1 ORDER BY a.nombre`, [req.sesion.empresaId]));
});

inventario.post('/almacenes', permitir(), async (req, res) => {
  const d = esquemaAlmacen.parse(req.body);
  const [a] = await q('INSERT INTO almacenes (empresa_id, codigo, nombre, ciudad, activo) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [req.sesion.empresaId, d.codigo, d.nombre, d.ciudad, d.activo]);
  await auditar(req.sesion, 'crear', 'almacen', a.id, { codigo: a.codigo });
  res.status(201).json(a);
});

// ---------- Productos ----------
const esquemaProducto = z.object({
  sku: z.string().trim().min(1).max(30).regex(/^[A-Z0-9-]+$/, 'Solo mayúsculas, números y guiones'),
  nombre: z.string().trim().min(1).max(160),
  categoria: z.string().trim().min(1).max(60),
  unidad: z.string().trim().min(1).max(10).default('ud'),
  coste_estandar: z.coerce.number().min(0).max(1_000_000),
  stock_minimo: z.coerce.number().min(0).max(10_000_000),
  lote_compra: z.coerce.number().positive().max(1_000_000).default(1),
  proveedor_preferente_id: z.coerce.number().int().positive().nullish().transform((v) => v ?? null),
  activo: z.boolean().default(true),
});
const PCOLS = ['sku', 'nombre', 'categoria', 'unidad', 'coste_estandar', 'stock_minimo', 'lote_compra', 'proveedor_preferente_id', 'activo'] as const;

/** Productos con stock total (o de un almacén), valor y situación respecto al mínimo. */
inventario.get('/productos', async (req, res) => {
  const f = z.object({
    buscar: z.string().trim().optional(), categoria: z.string().optional(),
    almacen_id: z.coerce.number().int().optional(), solo_bajo_minimo: z.enum(['true', 'false']).optional(),
  }).parse(req.query);
  const filas = await q(
    `WITH s AS (
       SELECT producto_id, sum(stock) AS stock FROM v_existencias
        WHERE empresa_id = $1 AND ($4::int IS NULL OR almacen_id = $4) GROUP BY producto_id)
     SELECT p.*, pr.nombre AS proveedor_nombre, COALESCE(s.stock, 0) AS stock,
            COALESCE(s.stock, 0) * p.coste_estandar AS valor_stock,
            CASE WHEN COALESCE(s.stock,0) <= 0 THEN 'sin_stock'
                 WHEN COALESCE(s.stock,0) < p.stock_minimo THEN 'bajo_minimo' ELSE 'ok' END AS situacion
       FROM productos p
       LEFT JOIN s ON s.producto_id = p.id
       LEFT JOIN proveedores pr ON pr.id = p.proveedor_preferente_id
      WHERE p.empresa_id = $1
        AND ($2::text IS NULL OR p.nombre ILIKE '%'||$2||'%' OR p.sku ILIKE '%'||$2||'%')
        AND ($3::text IS NULL OR p.categoria = $3)
        AND ($5::boolean IS NOT TRUE OR COALESCE(s.stock,0) < p.stock_minimo)
      ORDER BY p.nombre`,
    [req.sesion.empresaId, f.buscar || null, f.categoria || null, f.almacen_id ?? null, f.solo_bajo_minimo === 'true'],
  );
  res.json(filas);
});

inventario.get('/categorias', async (req, res) => {
  res.json((await q('SELECT DISTINCT categoria FROM productos WHERE empresa_id = $1 ORDER BY 1', [req.sesion.empresaId])).map((r) => r.categoria));
});

inventario.get('/productos/:id/existencias', async (req, res) => {
  res.json(await q(
    `SELECT a.id AS almacen_id, a.nombre AS almacen, COALESCE(e.stock, 0) AS stock
       FROM almacenes a LEFT JOIN v_existencias e ON e.almacen_id = a.id AND e.producto_id = $2
      WHERE a.empresa_id = $1 ORDER BY a.nombre`, [req.sesion.empresaId, idParam(req)]));
});

inventario.post('/productos', permitir('compras'), async (req, res) => {
  const d = esquemaProducto.parse(req.body);
  const [p] = await q(
    `INSERT INTO productos (empresa_id, ${PCOLS.join(',')}) VALUES ($1, ${PCOLS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
    [req.sesion.empresaId, ...PCOLS.map((c) => d[c])]);
  await auditar(req.sesion, 'crear', 'producto', p.id, { sku: p.sku });
  res.status(201).json(p);
});

inventario.put('/productos/:id', permitir('compras'), async (req, res) => {
  const id = idParam(req), d = esquemaProducto.parse(req.body);
  const [p] = await q(
    `UPDATE productos SET ${PCOLS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, actualizado_en = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [id, req.sesion.empresaId, ...PCOLS.map((c) => d[c])]);
  if (!p) throw noEncontrado('Producto');
  await auditar(req.sesion, 'modificar', 'producto', id, { sku: p.sku });
  res.json(p);
});

// ---------- Movimientos ----------
inventario.get('/movimientos', async (req, res) => {
  const f = z.object({
    producto_id: z.coerce.number().int().optional(), almacen_id: z.coerce.number().int().optional(),
    tipo: z.string().optional(), desde: z.iso.date().optional(), hasta: z.iso.date().optional(),
    pagina: z.coerce.number().int().min(1).default(1), tamano: z.coerce.number().int().min(1).max(200).default(50),
  }).parse(req.query);
  const params = [req.sesion.empresaId, f.producto_id ?? null, f.almacen_id ?? null, f.tipo || null, f.desde ?? null, f.hasta ?? null];
  const donde = `m.empresa_id = $1 AND ($2::int IS NULL OR m.producto_id = $2) AND ($3::int IS NULL OR m.almacen_id = $3)
    AND ($4::text IS NULL OR m.tipo = $4) AND ($5::date IS NULL OR m.fecha >= $5::date) AND ($6::date IS NULL OR m.fecha < $6::date + 1)`;
  const [{ total }] = await q(`SELECT count(*)::int AS total FROM movimientos_stock m WHERE ${donde}`, params);
  const filas = await q(
    `SELECT m.id, m.fecha, m.tipo, m.cantidad, m.coste_unitario, m.referencia, p.sku, p.nombre AS producto, p.unidad, a.nombre AS almacen
       FROM movimientos_stock m JOIN productos p ON p.id = m.producto_id JOIN almacenes a ON a.id = m.almacen_id
      WHERE ${donde} ORDER BY m.fecha DESC, m.id DESC LIMIT $7 OFFSET $8`,
    [...params, f.tamano, (f.pagina - 1) * f.tamano]);
  res.json({ total, pagina: f.pagina, tamano: f.tamano, filas });
});

const esquemaMovimiento = z.object({
  producto_id: z.coerce.number().int().positive(),
  almacen_id: z.coerce.number().int().positive(),
  tipo: z.enum(['SALIDA_CONSUMO', 'AJUSTE']),
  // SALIDA_CONSUMO: cantidad positiva que sale. AJUSTE: diferencia con signo (+ sobra, - falta).
  cantidad: z.coerce.number().refine((n) => n !== 0, 'La cantidad no puede ser cero'),
  referencia: z.string().trim().max(120).nullish().transform((v) => v || null),
}).refine((d) => d.tipo !== 'SALIDA_CONSUMO' || d.cantidad > 0, { path: ['cantidad'], message: 'La salida debe ser una cantidad positiva' })
  .refine((d) => d.tipo !== 'AJUSTE' || !!d.referencia, { path: ['referencia'], message: 'Un ajuste requiere indicar el motivo' });

/** Salidas por consumo y ajustes manuales. Las entradas por compra solo nacen de una recepción. */
inventario.post('/movimientos', permitir('almacen'), async (req, res) => {
  const d = esquemaMovimiento.parse(req.body), e = req.sesion.empresaId;
  const mov = await tx(async (c) => {
    const { rows: [p] } = await c.query('SELECT id, coste_estandar FROM productos WHERE id = $1 AND empresa_id = $2', [d.producto_id, e]);
    if (!p) throw noEncontrado('Producto');
    const { rows: [a] } = await c.query('SELECT id FROM almacenes WHERE id = $1 AND empresa_id = $2 AND activo', [d.almacen_id, e]);
    if (!a) throw noEncontrado('Almacén');
    // Bloqueo por producto+almacén: dos salidas simultáneas no pueden dejar el stock en negativo.
    await c.query('SELECT pg_advisory_xact_lock($1, $2)', [d.producto_id, d.almacen_id]);
    const { rows: [{ stock }] } = await c.query(
      'SELECT COALESCE(sum(cantidad), 0) AS stock FROM movimientos_stock WHERE producto_id = $1 AND almacen_id = $2', [d.producto_id, d.almacen_id]);
    const delta = d.tipo === 'SALIDA_CONSUMO' ? -d.cantidad : d.cantidad;
    if (stock + delta < 0) throw conflicto(`Stock insuficiente: hay ${stock} y la operación dejaría ${stock + delta}`);
    const { rows: [m] } = await c.query(
      `INSERT INTO movimientos_stock (empresa_id, producto_id, almacen_id, tipo, cantidad, coste_unitario, referencia, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [e, d.producto_id, d.almacen_id, d.tipo, delta, p.coste_estandar, d.referencia, req.sesion.id]);
    await auditar(req.sesion, d.tipo === 'AJUSTE' ? 'ajuste_stock' : 'salida_stock', 'movimiento', m.id,
      { producto_id: d.producto_id, almacen_id: d.almacen_id, cantidad: delta, stock_resultante: stock + delta }, c);
    return { ...m, stock_resultante: stock + delta };
  });
  res.status(201).json(mov);
});
