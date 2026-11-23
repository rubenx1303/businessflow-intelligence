import pg from 'pg';
import { config } from '../config.js';

// NUMERIC y BIGINT llegan como texto por defecto: los convertimos a número (los importes caben en float64).
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));
// DATE como 'YYYY-MM-DD' sin pasar por Date (evita desplazamientos de zona horaria).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  host: config.POSTGRES_HOST,
  port: config.POSTGRES_PORT,
  user: config.POSTGRES_USER,
  password: config.POSTGRES_PASSWORD,
  database: config.POSTGRES_DB,
  max: 10,
});

export async function q<T extends pg.QueryResultRow = any>(texto: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool.query<T>(texto, params);
  return r.rows;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
