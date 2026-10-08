/// <reference lib="webworker" />
import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { NetworkFirst, NetworkOnly, Serwist } from 'serwist';
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

/**
 * Las UNICAS rutas de datos que se cachean: las DOS que pide la vista de semana
 * del alumno.
 *
 * Son dos y no una porque la pantalla hace dos consultas —sus clases y los
 * turnos con cupo— y sin red una sola cacheada deja el offline a medias: el
 * banner de "datos guardados" al lado de una alerta de "sin conexion".
 *
 * Cada ruta se nombra UNA VEZ y desde aqui salen los dos sitios que la usan —la
 * lista blanca de `esCacheable` y los `NetworkFirst` de abajo—, porque que esos
 * dos sitios se separaran seria la forma silenciosa de que el alumno se quedara
 * sin calendario sin red: la lista blanca lo dejaria pasar y ninguna regla lo
 * guardaria.
 */
const DATOS_DEL_ALUMNO = [
  { ruta: '/api/bx/mi-calendario', cache: 'mi-calendario' },
  { ruta: '/api/bx/turnos-disponibles', cache: 'turnos-disponibles' },
] as const;

/** Si esa ruta es una de las dos del alumno. */
function esDatoDelAlumno(pathname: string): boolean {
  return DATOS_DEL_ALUMNO.some(({ ruta }) => pathname.startsWith(ruta));
}

/**
 * Lo que NUNCA se cachea: el panel del admin.
 *
 * `defaultCache` guarda la carcasa, y la carcasa incluye el HTML (su cache
 * `pages`) y tambien la carga RSC de cada pantalla (`pages-rsc`), que lleva los
 * datos ya serializados. Un listado de gente con nombres, emails y telefonos
 * quedaria en la CacheStorage del navegador del mostrador, que es una
 * computadora compartida, legible por quien se siente despues. El alumno no
 * tiene este problema porque sus pantallas solo hablan de el mismo.
 *
 * La comparacion mira el SEGUNDO segmento de la ruta y no un `startsWith`: sin
 * eso, un gimnasio llamado "administracion" dejaria de funcionar sin red.
 */
export function esDelPanel(pathname: string): boolean {
  const partes = pathname.split('/');
  // ['', '<slug>', 'admin', ...]
  return partes.length >= 3 && partes[2] === 'admin';
}

/** La regla que decide si algo entra en cache. Exportada para poder probarla. */
export function esCacheable({ url, request }: { url: URL; request: Request }): boolean {
  if (request.method !== 'GET') return false;

  /**
   * Los datos del panel no viajan por `/{slug}/admin/...` sino por `/api/bx/`,
   * donde el segundo segmento es `bx` y `esDelPanel` no los ve. `/api/bx/
   * usuarios` es, literalmente, la lista de gente en JSON.
   *
   * Por eso los datos van por LISTA BLANCA y no por lista negra: de `/api/` solo
   * se cachean las dos rutas de la vista de semana del alumno, y cualquier
   * endpoint que se agregue mañana nace fuera de la cache sin que nadie tenga
   * que acordarse de excluirlo. Al reves —ir enumerando lo que no se cachea— el
   * primer endpoint que alguien olvide acaba en el disco del mostrador.
   */
  if (url.pathname.startsWith('/api/')) return esDatoDelAlumno(url.pathname);

  return !esDelPanel(url.pathname);
}

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      /**
       * Primero la exclusion: la primera regla que casa es la que manda, asi
       * que esta tiene que ir ANTES de `defaultCache`. Detras de el no serviria
       * de nada, porque `defaultCache` acaba en reglas que atrapan todo lo del
       * mismo origen.
       */
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        request.method === 'GET' && !esCacheable({ url, request }),
      handler: new NetworkOnly(),
    },
    /**
     * Las UNICAS reglas de datos: lo que pide la vista de semana del alumno.
     *
     * Es lo que pide el PDF ("funciona razonablemente offline para la vista de
     * mi calendario ya cacheada") y no hay razon para cachear mas. Se generan
     * de `DATOS_DEL_ALUMNO` para que ninguna ruta quede escrita dos veces: una
     * entrada nueva ahi arriba entra sola en la lista blanca Y en su cache.
     *
     * `NetworkFirst` con timeout corto: con red, datos frescos; sin red, lo
     * ultimo que se vio. Al reves —cache primero— el alumno veria su calendario
     * viejo aun teniendo conexion.
     *
     * Una cache por ruta y no una compartida: asi el dia que una de las dos
     * cambie de politica (o se deje de cachear) se vacia la suya sin tocar la
     * otra.
     */
    ...DATOS_DEL_ALUMNO.map(({ ruta, cache }) => ({
      matcher: ({ url, request }: { url: URL; request: Request }) =>
        request.method === 'GET' && url.pathname.startsWith(ruta),
      handler: new NetworkFirst({
        cacheName: cache,
        networkTimeoutSeconds: 3,
      }),
    })),
    // La carcasa: HTML, CSS, JS, fuentes e imagenes.
    ...defaultCache,
  ],
});

/**
 * Todo lo que NO sea leer la semana del alumno se queda sin cachear, y eso es
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
