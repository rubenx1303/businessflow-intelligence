import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type pg from 'pg';
import { ZodError, z } from 'zod';
import { config } from './config.js';
import { pool } from './db/pool.js';

export type Rol = 'admin' | 'compras' | 'almacen' | 'lectura';
export interface Sesion { id: number; empresaId: number; rol: Rol; email: string }

declare global {
  namespace Express {
    interface Request { sesion: Sesion }
  }
}

export class ErrorHttp extends Error {
  constructor(public status: number, mensaje: string, public codigo = 'ERROR') { super(mensaje); }
}
export const noEncontrado = (que: string) => new ErrorHttp(404, `${que} no encontrado`, 'NO_ENCONTRADO');
export const conflicto = (m: string) => new ErrorHttp(409, m, 'CONFLICTO');

export function firmarToken(s: Sesion): string {
  return jwt.sign(s, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] });
}

export function autenticar(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new ErrorHttp(401, 'Sesión no iniciada', 'NO_AUTENTICADO');
  try {
    const p = jwt.verify(h.slice(7), config.JWT_SECRET) as Sesion;
    req.sesion = { id: p.id, empresaId: p.empresaId, rol: p.rol, email: p.email };
    next();
  } catch {
    throw new ErrorHttp(401, 'Sesión caducada o inválida', 'NO_AUTENTICADO');
  }
}

/** Control de acceso por rol. 'admin' siempre pasa. */
export const permitir = (...roles: Rol[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (req.sesion.rol === 'admin' || roles.includes(req.sesion.rol)) return next();
  throw new ErrorHttp(403, 'Tu rol no permite esta operación', 'SIN_PERMISO');
};

export const idParam = (req: Request, nombre = 'id') => z.coerce.number().int().positive().parse(req.params[nombre]);

/** Registro de operaciones relevantes. Acepta un cliente de transacción para que auditoría y cambio sean atómicos. */
export async function auditar(
  s: Sesion, accion: string, entidad: string, entidadId: string | number | null, detalle: unknown = null,
  cliente: pg.PoolClient | pg.Pool = pool,
) {
  await cliente.query(
    'INSERT INTO auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, detalle) VALUES ($1,$2,$3,$4,$5,$6)',
    [s.empresaId, s.id, accion, entidad, entidadId === null ? null : String(entidadId), detalle === null ? null : JSON.stringify(detalle)],
  );
}

export function manejarErrores(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Datos no válidos', codigo: 'VALIDACION',
      campos: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
    });
  }
  if (err instanceof ErrorHttp) return res.status(err.status).json({ error: err.message, codigo: err.codigo });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON mal formado', codigo: 'VALIDACION' });
  // Errores de integridad de PostgreSQL traducidos a respuestas comprensibles.
  if (err?.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese código', codigo: 'DUPLICADO' });
  if (err?.code === '23503') return res.status(409).json({ error: 'El registro está referenciado o apunta a un dato inexistente', codigo: 'REFERENCIA' });
  if (err?.code === '23514') return res.status(400).json({ error: 'El dato incumple una regla de la base de datos', codigo: 'VALIDACION' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor', codigo: 'INTERNO' });
}
