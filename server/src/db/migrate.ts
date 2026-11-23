import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export async function migrar(): Promise<string[]> {
  await pool.query(`CREATE TABLE IF NOT EXISTS _migraciones (nombre TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const hechas = new Set((await pool.query('SELECT nombre FROM _migraciones')).rows.map((r) => r.nombre));
  const aplicadas: string[] = [];
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (hechas.has(f)) continue;
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await c.query('INSERT INTO _migraciones (nombre) VALUES ($1)', [f]);
      await c.query('COMMIT');
      aplicadas.push(f);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  return aplicadas;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrar()
    .then((a) => console.log(a.length ? `Migraciones aplicadas: ${a.join(', ')}` : 'Base de datos al día'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => pool.end());
}
