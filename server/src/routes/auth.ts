import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { q } from '../db/pool.js';
import { ErrorHttp, autenticar, firmarToken, type Sesion } from '../http.js';

export const auth = Router();

// Límite de intentos en memoria (suficiente para una sola instancia; en producción iría a Redis o al gateway).
const intentos = new Map<string, { n: number; hasta: number }>();
const MAX = 8, VENTANA = 10 * 60_000;

auth.post('/login', async (req, res) => {
  const { email, password } = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const clave = `${req.ip}|${email.toLowerCase()}`;
  const i = intentos.get(clave);
  if (i && i.n >= MAX && i.hasta > Date.now()) throw new ErrorHttp(429, 'Demasiados intentos. Espera unos minutos.', 'LIMITE');

  const [u] = await q('SELECT id, empresa_id, email, nombre, rol, password_hash FROM usuarios WHERE lower(email) = lower($1) AND activo', [email]);
  // Se compara siempre contra un hash para no revelar por tiempo si el usuario existe.
  const ok = await bcrypt.compare(password, u?.password_hash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi');
  if (!u || !ok) {
    const previo = i && i.hasta > Date.now() ? i.n : 0;
    intentos.set(clave, { n: previo + 1, hasta: Date.now() + VENTANA });
    throw new ErrorHttp(401, 'Credenciales incorrectas', 'CREDENCIALES');
  }
  intentos.delete(clave);
  const s: Sesion = { id: u.id, empresaId: u.empresa_id, rol: u.rol, email: u.email };
  res.json({ token: firmarToken(s), usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } });
});

/** La pantalla de acceso pregunta si la instancia es una demo para ofrecer la entrada con un clic. */
auth.get('/modo', (_req, res) => res.json({ demo: config.DEMO_MODE }));

/** Acceso de demostración por rol, sin contraseña. Solo responde si DEMO_MODE=true (datos ficticios, uso local). */
auth.post('/demo', async (req, res) => {
  if (!config.DEMO_MODE) throw new ErrorHttp(404, 'Ruta no encontrada', 'NO_ENCONTRADO');
  const { rol } = z.object({ rol: z.enum(['admin', 'compras', 'almacen', 'lectura']) }).parse(req.body);
  const [u] = await q('SELECT id, empresa_id, email, nombre, rol FROM usuarios WHERE rol = $1 AND activo ORDER BY id LIMIT 1', [rol]);
  if (!u) throw new ErrorHttp(409, 'No hay datos de demostración: ejecuta la siembra', 'SIN_DATOS');
  const s: Sesion = { id: u.id, empresaId: u.empresa_id, rol: u.rol, email: u.email };
  res.json({ token: firmarToken(s), usuario: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol } });
});

auth.get('/me', autenticar, async (req, res) => {
  const [u] = await q(
    `SELECT u.id, u.email, u.nombre, u.rol, e.nombre AS empresa FROM usuarios u JOIN empresas e ON e.id = u.empresa_id WHERE u.id = $1 AND u.activo`,
    [req.sesion.id],
  );
  if (!u) throw new ErrorHttp(401, 'Usuario no disponible', 'NO_AUTENTICADO');
  res.json(u);
});
