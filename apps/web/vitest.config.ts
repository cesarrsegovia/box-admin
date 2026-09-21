import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Los tests de Playwright viven en e2e/ y los corre otro runner. Sin esta
    // exclusion, Vitest intenta ejecutarlos y falla con errores desconcertantes.
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
