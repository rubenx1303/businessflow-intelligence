import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

/** Raíz del lake local. BFI_LAKE_DIR permite a las pruebas usar una carpeta propia. */
export const raizLake = () => process.env.BFI_LAKE_DIR ?? path.join(config.raiz, 'data', 'lake');
export const rutas = () => {
  const raiz = raizLake();
  return {
    raiz,
    bronze: path.join(raiz, 'Files', 'bronze'),
    silver: path.join(raiz, 'silver'),
    gold: path.join(raiz, 'gold'),
    ejecuciones: path.join(raiz, '_ejecuciones'),
  };
};

export const posix = (p: string) => p.replace(/\\/g, '/');
export const lit = (s: string) => s.replace(/'/g, "''");

export async function conectarDuck(): Promise<DuckDBConnection> {
  const db = await DuckDBInstance.create(':memory:');
  const con = await db.connect();
  // Todo el circuito trabaja en UTC, igual que PostgreSQL y que Spark en Fabric: así un movimiento cae en el mismo día en las tres plataformas.
  await con.run("SET TimeZone = 'UTC'");
  return con;
}

/** Filas como objetos JSON simples. Las consultas deben devolver DOUBLE/INTEGER/VARCHAR (se castea en SQL). */
export async function filas<T = Record<string, any>>(con: DuckDBConnection, sql: string): Promise<T[]> {
  return (await con.runAndReadAll(sql)).getRowObjectsJson() as T[];
}
export const una = async <T = Record<string, any>>(con: DuckDBConnection, sql: string) => (await filas<T>(con, sql))[0];

export function ultimaEjecucion(): any | null {
  const dir = rutas().ejecuciones;
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort().pop();
  return f ? JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) : null;
}

export function listarEjecuciones(limite = 20): any[] {
  const dir = rutas().ejecuciones;
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort().reverse().slice(0, limite)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}
