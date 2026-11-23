import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { ErrorHttp, autenticar, manejarErrores } from './http.js';
import { analitica } from './routes/analitica.js';
import { auth } from './routes/auth.js';
import { datos } from './routes/datos.js';
import { inventario } from './routes/inventario.js';
import { pedidos } from './routes/pedidos.js';
import { proveedores } from './routes/proveedores.js';

export function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()) }));
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/salud', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ estado: 'ok', hora: new Date().toISOString() });
  });

  app.use('/api/auth', auth);
  app.use('/api', autenticar);
  app.use('/api/proveedores', proveedores);
  app.use('/api/inventario', inventario);
  app.use('/api/pedidos', pedidos);
  app.use('/api/datos', datos);
  app.use('/api', analitica);

  app.use('/api', () => { throw new ErrorHttp(404, 'Ruta no encontrada', 'NO_ENCONTRADO'); });
  app.use(manejarErrores);
  return app;
}
