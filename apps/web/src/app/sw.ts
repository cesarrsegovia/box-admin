/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      /**
       * La UNICA regla de datos: el calendario del alumno.
       *
       * Es lo que pide el PDF ("funciona razonablemente offline para la vista
       * de mi calendario ya cacheada") y no hay razon para cachear mas.
       *
       * `NetworkFirst` con timeout corto: con red, datos frescos; sin red, lo
       * ultimo que se vio. Al reves —cache primero— el alumno veria su
       * calendario viejo aun teniendo conexion.
       */
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        request.method === 'GET' && url.pathname.startsWith('/api/bx/mi-calendario'),
      handler: new NetworkFirst({
        cacheName: 'mi-calendario',
        networkTimeoutSeconds: 3,
      }),
    },
    // La carcasa: HTML, CSS, JS, fuentes e imagenes.
    ...defaultCache,
  ],
});

/**
 * Todo lo que NO sea leer el calendario se queda sin cachear, y eso es
 * deliberado: sin red, reservar tiene que FALLAR con un mensaje claro.
 * Encolarlo para mas tarde haria que el alumno creyera tener plaza en una clase
 * cuyo cupo pudo agotarse mientras tanto.
 */

serwist.addEventListeners();
