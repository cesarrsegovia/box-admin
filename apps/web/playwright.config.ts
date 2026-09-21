import { defineConfig, devices } from '@playwright/test';

const PUERTO_WEB = 3002;
const URL_WEB = `http://localhost:${PUERTO_WEB}`;

export default defineConfig({
  testDir: './e2e',
  // En serie: los tests comparten la misma base de datos y se pisarian.
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: URL_WEB,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * El BUILD DE PRODUCCION, no `next dev`.
   *
   * El service worker esta desactivado en desarrollo (ver next.config.mjs), asi
   * que probar la PWA contra `next dev` no probaria nada de lo que esta fase
   * tiene que demostrar.
   *
   * Puerto 3002 y no 3001 para no chocar con un `pnpm web:dev` que este abierto.
   */
  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PUERTO_WEB}`,
    url: URL_WEB,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      NODE_ENV: 'production',
      API_URL: process.env.API_URL ?? 'http://localhost:3000',
    },
  },
});
