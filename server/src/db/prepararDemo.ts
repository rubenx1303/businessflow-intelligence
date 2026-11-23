/**
 * Deja la demo lista para usarse (idempotente): aplica migraciones, genera los datos ficticios si la base
 * está vacía y construye Bronze → Silver → Gold si el lake local no existe. Lo llama el script de arranque.
 */
import { ejecutarPipeline } from '../data/medallion.js';
import { goldDisponible } from '../services/informes.js';
import { migrar } from './migrate.js';
import { pool } from './pool.js';
import { sembrar } from './seed.js';

try {
  const aplicadas = await migrar();
  console.log(aplicadas.length ? `  Migraciones aplicadas: ${aplicadas.join(', ')}` : '  Esquema de base de datos al día');
  const { rows: [{ n }] } = await pool.query('SELECT count(*)::int AS n FROM empresas');
  if (n === 0) {
    const r = await sembrar();
    console.log(`  Datos de demostración generados: ${r.pedidos} pedidos, ${r.movimientos} movimientos de stock`);
  } else {
    console.log('  Datos de demostración ya presentes (se conservan)');
  }
  if (n === 0 || !goldDisponible()) {
    const e = await ejecutarPipeline({ completa: true });
    console.log(`  Circuito Bronze → Silver → Gold ejecutado en ${(e.duracion_ms.total / 1000).toFixed(1)} s (${e.silver.totales.escritas} filas en Silver)`);
  } else {
    console.log('  Lake local (Bronze, Silver, Gold) ya construido');
  }
  await pool.end();
  process.exit(0);
} catch (e: any) {
  console.error('  ERROR preparando la demo:', e.message);
  process.exit(1);
}
