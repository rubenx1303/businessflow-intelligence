import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { listarEjecuciones, rutas, ultimaEjecucion } from '../data/lake.js';
import { TABLAS_GOLD, TABLAS_SILVER, ejecutarPipeline } from '../data/medallion.js';
import { sembrar } from '../db/seed.js';
import { ErrorHttp, auditar, permitir } from '../http.js';

/** Circuito de datos local (Bronze → Silver → Gold): estado, ejecución y restauración de la demo. */
export const datos = Router();
let enCurso: string | null = null;

async function exclusivo<T>(que: string, fn: () => Promise<T>): Promise<T> {
  if (enCurso) throw new ErrorHttp(409, `Ya hay una operación en curso: ${enCurso}`, 'CONFLICTO');
  enCurso = que;
  try { return await fn(); } finally { enCurso = null; }
}

function resumenCarpeta(dir: string) {
  if (!fs.existsSync(dir)) return { archivos: 0, bytes: 0 };
  let archivos = 0, bytes = 0;
  const recorrer = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) recorrer(p);
      else if (e.name.endsWith('.parquet')) { archivos++; bytes += fs.statSync(p).size; }
    }
  };
  recorrer(dir);
  return { archivos, bytes };
}

/** Evidencias guardadas de la ejecución real en Microsoft Fabric (docs/evidencias-fabric/resumen.json). No se consulta Azure. */
function evidenciasFabric() {
  const f = path.join(config.raiz, 'docs', 'evidencias-fabric', 'resumen.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

datos.get('/estado', (_req, res) => {
  const r = rutas();
  res.json({
    en_curso: enCurso,
    capas: { bronze: resumenCarpeta(r.bronze), silver: resumenCarpeta(r.silver), gold: resumenCarpeta(r.gold) },
    ultima: ultimaEjecucion(),
    historial: listarEjecuciones(10).map((e) => ({
      id_ejecucion: e.id_ejecucion, fin: e.fin, duracion_ms: e.duracion_ms?.total, filas_bronze: e.bronze?.total_filas,
      duplicadas: e.silver?.totales?.duplicadas_eliminadas, rechazadas: e.silver?.totales?.rechazadas, escritas_silver: e.silver?.totales?.escritas,
    })),
    reglas_silver: TABLAS_SILVER.map((t) => ({ tabla: t.nombre, reglas: Object.keys(t.reglas), referencias: Object.entries(t.referencias).map(([c, ref]) => `${c} → ${ref}`) })),
    modelo_gold: [...TABLAS_GOLD.map((t) => ({ tabla: t.nombre, grano: t.grano })), { tabla: 'inventario_diario', grano: 'producto, almacén y día (foto periódica)' }],
    fabric: evidenciasFabric(),
  });
});

/** Ejecuta el circuito completo en local. Cualquier rol que opere (no el de solo lectura) puede lanzarlo. */
datos.post('/pipeline', permitir('compras', 'almacen'), async (req, res) => {
  const e = await exclusivo('pipeline de datos', () => ejecutarPipeline());
  await auditar(req.sesion, 'pipeline', 'datos', e.id_ejecucion, { filas_bronze: e.bronze.total_filas, escritas_silver: e.silver.totales.escritas, ms: e.duracion_ms.total });
  res.status(201).json(e);
});

/**
 * Restaura la demo: vuelve a generar los datos ficticios, vacía el lake local y reconstruye Bronze, Silver y Gold.
 * Solo existe en modo demostración: en la base no hay datos reales que proteger.
 */
datos.post('/restaurar-demo', permitir(), async (req, res) => {
  if (!config.DEMO_MODE) throw new ErrorHttp(403, 'La restauración solo está disponible en modo demostración', 'SIN_PERMISO');
  const r = await exclusivo('restauración de la demo', async () => {
    const semilla = await sembrar();
    fs.rmSync(rutas().raiz, { recursive: true, force: true }); // los identificadores se reinician: las marcas de agua antiguas ya no valen
    const pipeline = await ejecutarPipeline({ completa: true });
    return { semilla, id_ejecucion: pipeline.id_ejecucion, ms: pipeline.duracion_ms.total };
  });
  res.status(201).json(r);
});
