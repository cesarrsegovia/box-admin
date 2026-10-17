import { defineConfig, type ViteUserConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { RELOJES_FALSOS } from './src/test/relojes-falsos';

/**
 * Los nombres de reloj que el TIPO de Vitest admite, que NO son los que falsea.
 *
 * Medido: en Vitest 3.2.7 el conjunto por defecto incluye `Intl` —sinon lo
 * falsea si existe en el global— y el tipo `FakeMethod` no lo nombra. El tipo
 * va por detras de lo que hace el runner, que es otra razon para medir la
 * lista en vez de copiarla: tambien el `@default` de su documentacion esta
 * mal («everything except nextTick»; tambien quita `queueMicrotask`).
 */
type RelojesFalseables = NonNullable<NonNullable<ViteUserConfig['test']>['fakeTimers']>['toFake'];

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Los tests de Playwright viven en e2e/ y los corre otro runner. Sin esta
    // exclusion, Vitest intenta ejecutarlos y falla con errores desconcertantes.
    exclude: ['node_modules/**', 'e2e/**', '.next/**'],
    fakeTimers: {
      /**
       * QUE RELOJES FALSEA UN `vi.useFakeTimers()` DESNUDO EN ESTE PAQUETE.
       *
       * El conjunto por defecto de Vitest MENOS `performance`: falsearlo
       * sustituye el objeto entero por el de sinon, que acepta `mark()` y no
       * guarda nada, y eso deja ciego al sexto canal del espia mientras los
       * relojes falsos esten puestos. De donde sale la lista, como se midio y
       * por que vive en un solo sitio: `src/test/relojes-falsos.ts`.
       *
       * Un spec que pase SU PROPIO `toFake` sigue mandando el: Vitest usa el
       * del spec entero cuando lo hay, no lo mezcla con este.
       */
      toFake: [...RELOJES_FALSOS] as RelojesFalseables,
    },
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
