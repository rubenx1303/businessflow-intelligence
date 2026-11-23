import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas usan una base de datos y un lake propios: nunca tocan los datos de la demo.
    env: {
      POSTGRES_DB: 'businessflow_test',
      BFI_LAKE_DIR: path.resolve(import.meta.dirname, '../data/lake_test'),
      DEMO_MODE: 'true',
      SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD ?? 'clave-solo-para-pruebas',
    },
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 20000,
  },
});
