import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/pool.js';
import { auditar, idParam, noEncontrado, permitir } from '../http.js';
import { rendimientoProveedores } from '../services/analitica.js';

export const proveedores = Router();

const texto = (max: number) => z.string().trim().min(1).max(max);
const opcional = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

export const esquemaProveedor = z.object({
  codigo: texto(20).regex(/^[A-Z0-9-]+$/, 'Solo mayúsculas, números y guiones'),
  nombre: texto(120),
  cif: texto(15).regex(/^[A-Z0-9]{8,12}$/i, 'CIF/NIF no válido'),
  email: z.string().trim().email().nullish().or(z.literal('')).transform((v) => v || null),
  telefono: opcional(30),
  ciudad: opcional(80),
  pais: texto(60).default('España'),
  plazo_entrega_dias: z.coerce.number().int().min(0).max(365),
  condiciones_pago: texto(60).default('30 días'),
  estado: z.enum(['activo', 'en_revision', 'bloqueado', 'inactivo']).default('activo'),
  notas: opcional(1000),
});

const COLS = ['codigo', 'nombre', 'cif', 'email', 'telefono', 'ciudad', 'pais', 'plazo_entrega_dias', 'condiciones_pago', 'estado', 'notas'] as const;

proveedores.get('/', async (req, res) => {
  const f = z.object({ buscar: z.string().trim().optional(), estado: z.string().optional() }).parse(req.query);
  const filas = await q(
    `SELECT p.*,
            (SELECT count(*)::int FROM pedidos_compra pc WHERE pc.proveedor_id = p.id AND pc.estado IN ('enviado','parcial')) AS pedidos_abiertos
       FROM proveedores p
      WHERE p.empresa_id = $1
        AND ($2::text IS NULL OR p.nombre ILIKE '%'||$2||'%' OR p.codigo ILIKE '%'||$2||'%' OR p.cif ILIKE '%'||$2||'%' OR p.ciudad ILIKE '%'||$2||'%')
        AND ($3::text IS NULL OR p.estado = $3)
      ORDER BY p.nombre`,
    [req.sesion.empresaId, f.buscar || null, f.estado || null],
  );
  res.json(filas);
});

proveedores.get('/:id', async (req, res) => {
  const [p] = await q('SELECT * FROM proveedores WHERE id = $1 AND empresa_id = $2', [idParam(req), req.sesion.empresaId]);
  if (!p) throw noEncontrado('Proveedor');
  res.json(p);
});

/** Historial: métricas de rendimiento, últimos pedidos y cambios auditados. */
proveedores.get('/:id/historial', async (req, res) => {
  const id = idParam(req), e = req.sesion.empresaId;
  const [p] = await q('SELECT id FROM proveedores WHERE id = $1 AND empresa_id = $2', [id, e]);
  if (!p) throw noEncontrado('Proveedor');
  const [metricas] = (await rendimientoProveedores(e, {})).filter((m) => m.proveedor_id === id);
  const pedidos = await q(
    `SELECT pc.id, pc.numero, pc.estado, pc.fecha_pedido, pc.fecha_entrega_prevista,
            (SELECT max(r.fecha_recepcion) FROM recepciones r WHERE r.pedido_id = pc.id) AS ultima_recepcion,
            (SELECT COALESCE(sum(lp.cantidad * lp.precio_unitario),0) FROM lineas_pedido lp WHERE lp.pedido_id = pc.id) AS importe
       FROM pedidos_compra pc WHERE pc.proveedor_id = $1 AND pc.empresa_id = $2
      ORDER BY pc.fecha_pedido DESC, pc.id DESC LIMIT 25`, [id, e]);
  const cambios = await q(
    `SELECT a.fecha, a.accion, a.detalle, u.nombre AS usuario FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.empresa_id = $1 AND a.entidad = 'proveedor' AND a.entidad_id = $2 ORDER BY a.fecha DESC LIMIT 25`, [e, String(id)]);
  res.json({ metricas: metricas ?? null, pedidos, cambios });
});

proveedores.post('/', permitir('compras'), async (req, res) => {
  const d = esquemaProveedor.parse(req.body);
  const [p] = await q(
    `INSERT INTO proveedores (empresa_id, ${COLS.join(',')}) VALUES ($1, ${COLS.map((_, i) => `$${i + 2}`).join(',')}) RETURNING *`,
    [req.sesion.empresaId, ...COLS.map((c) => d[c])],
  );
  await auditar(req.sesion, 'crear', 'proveedor', p.id, { codigo: p.codigo, nombre: p.nombre });
  res.status(201).json(p);
});

proveedores.put('/:id', permitir('compras'), async (req, res) => {
  const id = idParam(req), d = esquemaProveedor.parse(req.body);
  const [antes] = await q('SELECT * FROM proveedores WHERE id = $1 AND empresa_id = $2', [id, req.sesion.empresaId]);
  if (!antes) throw noEncontrado('Proveedor');
  const [p] = await q(
    `UPDATE proveedores SET ${COLS.map((c, i) => `${c} = $${i + 3}`).join(', ')}, actualizado_en = now() WHERE id = $1 AND empresa_id = $2 RETURNING *`,
    [id, req.sesion.empresaId, ...COLS.map((c) => d[c])],
  );
  const cambios = Object.fromEntries(COLS.filter((c) => antes[c] !== p[c]).map((c) => [c, { antes: antes[c], despues: p[c] }]));
  if (Object.keys(cambios).length) await auditar(req.sesion, 'modificar', 'proveedor', id, cambios);
  res.json(p);
});
