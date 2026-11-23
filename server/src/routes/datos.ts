import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { exportarBronze } from '../data/exportBronze.js';
import { ErrorHttp, auditar, permitir } from '../http.js';

/** Estado del circuito de datos: historial de cargas Bronze (manifiestos) y lanzamiento manual. */
export const datos = Router();
const dirManifiestos = path.join(config.raiz, 'data', 'lake', 'Files', 'bronze', '_manifiestos');
let enCurso = false;

datos.get('/cargas', permitir(), (_req, res) => {
  if (!fs.existsSync(dirManifiestos)) return res.json([]);
  const cargas = fs.readdirSync(dirManifiestos).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 30)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dirManifiestos, f), 'utf8')));
  res.json(cargas);
});

datos.post('/cargas', permitir(), async (req, res) => {
  if (enCurso) throw new ErrorHttp(409, 'Ya hay una carga en curso', 'CONFLICTO');
  enCurso = true;
  try {
    const m = await exportarBronze();
    await auditar(req.sesion, 'carga_bronze', 'datos', m.id_carga, { filas: m.total_filas });
    res.status(201).json(m);
  } finally {
    enCurso = false;
  }
});
