import path from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

export default async function setup() {
  dotenv.config({ path: path.resolve(import.meta.dirname, '../../.env'), quiet: true });
  const c = new pg.Client({
    host: process.env.POSTGRES_HOST ?? '127.0.0.1', port: Number(process.env.POSTGRES_PORT ?? 5433),
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, database: 'postgres',
  });
  await c.connect();
  await c.query('DROP DATABASE IF EXISTS businessflow_test WITH (FORCE)');
  await c.query('CREATE DATABASE businessflow_test');
  await c.end();
}
