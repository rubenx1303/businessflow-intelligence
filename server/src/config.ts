import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(raiz, '.env'), quiet: true });

const esquema = z.object({
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(8),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_HOST: z.string().default('127.0.0.1'),
  POSTGRES_PORT: z.coerce.number().default(5433),
  API_PORT: z.coerce.number().default(4000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:5180'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@demo.local'),
  SEED_ADMIN_PASSWORD: z.string().min(8).optional(),
});

const r = esquema.safeParse(process.env);
if (!r.success) {
  console.error('Configuración inválida (.env):', z.prettifyError(r.error));
  process.exit(1);
}

export const config = { ...r.data, raiz };
