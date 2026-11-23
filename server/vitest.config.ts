import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Las pruebas de integración usan una base de datos propia: nunca tocan los datos de desarrollo.
    env: { POSTGRES_DB: 'businessflow_test' },
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 20000,
  },
});
