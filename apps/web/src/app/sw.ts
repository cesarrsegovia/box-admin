/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, Serwist } from 'serwist';
// Relativo y no con el alias `@/`: este archivo lo compila el plugin de Serwist
// para un worker, no el build normal de Next, y no hay por que dar por sentado
// que los paths del tsconfig llegan hasta ahi.
import { contenidoDeNotificacion, destinoDeNotificacion } from '../lib/push';

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

/**
 * El push. Serwist no lo gestiona: registra sus propios listeners para la
 * cache, y este es nuestro. Va ANTES de `addEventListeners()` porque los
 * listeners de un service worker tienen que quedar registrados en la primera
 * vuelta del script; engancharlos despues de un `await` es la forma clasica de
 * que el primer push no le llegue a nadie.
 *
 * ⚠️ El titulo se pasa a `showNotification` TAL CUAL. Llega sin escapar a
 * proposito (es el asunto de la plantilla del gimnasio; ver el comentario de
 * `contenidoDeNotificacion`) y `showNotification` lo pinta como texto, asi que
 * aqui no hay problema. Lo que NO se puede hacer nunca es meterlo en un
 * `innerHTML` ni en un `dangerouslySetInnerHTML` en ninguna pantalla.
 */
self.addEventListener('push', (evento: PushEvent) => {
  const { titulo, cuerpo, url } = contenidoDeNotificacion(evento.data?.text());

  evento.waitUntil(
    self.registration.showNotification(titulo, {
      body: cuerpo,
      icon: '/icono-192.png',
      data: { url },
    }),
  );
});

/**
 * Al tocarla, abrir la aplicacion donde corresponda.
 *
 * Se reutiliza una ventana abierta si la hay, y es SOLO cortesia: no abrir una
 * pestaña de mas a quien ya tiene la aplicacion delante. De su URL no se deduce
 * nada —el destino viene entero en la notificacion.
 */
async function abrirLaNotificacion(url: string | undefined): Promise<void> {
  const destino = destinoDeNotificacion(url);
  const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const abierta = ventanas[0];

  if (abierta) {
    try {
      await abierta.focus();
      await abierta.navigate(destino);
      return;
    } catch {
      // `navigate()` rechaza si la ventana no la controla este service worker
      // (por ejemplo justo tras instalarlo). Abrir una nueva es peor que
      // reutilizarla, pero infinitamente mejor que no abrir nada.
    }
  }

  await self.clients.openWindow(destino);
}

self.addEventListener('notificationclick', (evento: NotificationEvent) => {
  evento.notification.close();
  const datos = evento.notification.data as { url?: string } | undefined;

  evento.waitUntil(abrirLaNotificacion(datos?.url));
});

serwist.addEventListeners();
