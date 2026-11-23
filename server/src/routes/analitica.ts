import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db/pool.js';
import { permitir } from '../http.js';
import { costes, rendimientoProveedores, reposicion } from '../services/analitica.js';
import { informesGold } from '../services/informes.js';
import { dashboard } from '../services/panel.js';

export const analitica = Router();

const id = z.coerce.number().int().positive().optional();
const filtros = z.object({
  desde: z.iso.date().optional(), hasta: z.iso.date().optional(),
  almacen_id: id, proveedor_id: id, producto_id: id, categoria: z.string().trim().min(1).max(60).optional(),
}).refine((f) => !f.desde || !f.hasta || f.desde <= f.hasta, { path: ['hasta'], message: 'El rango de fechas está invertido' });

analitica.get('/dashboard', async (req, res) => res.json(await dashboard(req.sesion.empresaId, filtros.parse(req.query))));
analitica.get('/inteligencia/proveedores', async (req, res) => res.json(await rendimientoProveedores(req.sesion.empresaId, filtros.parse(req.query))));
analitica.get('/inteligencia/reposicion', async (req, res) => res.json(await reposicion(req.sesion.empresaId)));
analitica.get('/inteligencia/costes', async (req, res) => res.json(await costes(req.sesion.empresaId)));

/** Informes calculados sobre la capa Gold local (no sobre la base operativa). */
analitica.get('/informes', async (req, res) => {
  const f = filtros.parse(req.query);
  res.json(await informesGold(req.sesion.empresaId, { desde: f.desde, hasta: f.hasta, proveedor_id: f.proveedor_id, categoria: f.categoria }));
});

analitica.get('/auditoria', permitir(), async (req, res) => {
  const f = z.object({ entidad: z.string().optional(), limite: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
  res.json(await q(
    `SELECT a.id, a.fecha, a.accion, a.entidad, a.entidad_id, a.detalle, u.nombre AS usuario
       FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.empresa_id = $1 AND ($2::text IS NULL OR a.entidad = $2) ORDER BY a.fecha DESC, a.id DESC LIMIT $3`,
    [req.sesion.empresaId, f.entidad || null, f.limite]));
});
