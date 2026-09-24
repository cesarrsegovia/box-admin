/**
 * Lo que la PWA necesita saber de las notificaciones push.
 *
 * Vive aparte del componente y del service worker a proposito: la mitad de este
 * archivo la usa el navegador (suscribirse) y la otra mitad el service worker
 * (recibir), y son dos mundos que no comparten nada mas. Todo lo de aqui son
 * funciones puras para poder probarlas sin levantar ninguno de los dos.
 */

/**
 * La clave VAPID publica viaja en base64url y `pushManager.subscribe` la quiere
 * como Uint8Array. Esta conversion es el paso que mas se equivoca al copiarla
 * de un tutorial: base64url no es base64, y `atob` no entiende `-` ni `_`.
 *
 * El tipo de vuelta es `Uint8Array<ArrayBuffer>` y no `Uint8Array` a secas: con
 * los tipos de TypeScript 5.7 en adelante, `Uint8Array` por defecto es
 * `Uint8Array<ArrayBufferLike>`, que incluye `SharedArrayBuffer` y que
 * `applicationServerKey` (un `BufferSource`) no acepta.
 */
export function claveAplicacionDesdeBase64(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/');
  const crudo = atob(base64);

  const bytes = new Uint8Array(new ArrayBuffer(crudo.length));
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);

  return bytes;
}

export interface SuscripcionSerializada {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Pasa la suscripcion del navegador a lo que espera la API. */
export function serializar(suscripcion: PushSubscription): SuscripcionSerializada {
  const json = suscripcion.toJSON() as { endpoint?: string; keys?: Record<string, string> };

  return {
    endpoint: json.endpoint ?? suscripcion.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  };
}

export interface ContenidoDeNotificacion {
  titulo: string;
  cuerpo: string;
  url: string;
}

/**
 * Lo que hay que mostrar, sacado del cuerpo cifrado que mando la API.
 *
 * ⚠️ `titulo` LLEGA SIN ESCAPAR, Y ESO ES CORRECTO. Es el asunto de la
 * plantilla del gimnasio, y `resolverMensaje` (API) no lo escapa a proposito:
 * escaparlo convertia "O'Brien & Ana" en "O&#x27;Brien &amp;amp; Ana" en la
 * bandeja de entrada. Aqui tampoco se escapa, porque `showNotification` pone el
 * titulo COMO TEXTO y escaparlo se veria igual de mal en la notificacion.
 *
 * Lo que eso obliga: ese texto lo escribe el admin del gimnasio y lleva datos
 * interpolados, asi que cualquier sitio de la PWA que lo PINTE EN EL DOM —un
 * centro de notificaciones, un toast, un historial— tiene que usar
 * `textContent` o el equivalente de React (`{titulo}`), JAMAS
 * `dangerouslySetInnerHTML`. Hoy no lo pinta nadie; queda escrito aqui, que es
 * por donde pasa el texto, para el dia que alguien lo haga.
 *
 * Si el cuerpo no se puede parsear se muestra igualmente algo: una notificacion
 * sin texto es mejor que una excepcion en el service worker, que ademas no se
 * ve en ningun sitio.
 */
export function contenidoDeNotificacion(cargaUtil: string | undefined): ContenidoDeNotificacion {
  const datos = (() => {
    if (cargaUtil === undefined || cargaUtil === '') return {};
    try {
      const parseado: unknown = JSON.parse(cargaUtil);
      // Un JSON valido puede ser `null`, `3` o `"hola"`, y ninguno de esos
      // tiene propiedades. Sin esta comprobacion, `datos.titulo` sobre `null`
      // lanza dentro del handler del push.
      return typeof parseado === 'object' && parseado !== null
        ? (parseado as { titulo?: unknown; cuerpo?: unknown; url?: unknown })
        : {};
    } catch {
      return {};
    }
  })();

  return {
    titulo: typeof datos.titulo === 'string' && datos.titulo !== '' ? datos.titulo : 'BoxAdmin',
    cuerpo: typeof datos.cuerpo === 'string' ? datos.cuerpo : '',
    url: typeof datos.url === 'string' ? datos.url : '/',
  };
}

/**
 * Una ruta que se puede abrir sin salir de la aplicacion.
 *
 * `//otro-sitio.com` y `/\otro-sitio.com` los resuelve el navegador como OTRO
 * ORIGEN, igual que `https://...`. El cuerpo del push va cifrado con las claves
 * VAPID del servidor, asi que hoy nadie de fuera puede meter una url ahi; el
 * filtro esta porque el coste es una linea y lo que evita es que una
 * notificacion abra una pagina ajena con la marca del gimnasio encima.
 */
function rutaSegura(ruta: string | undefined): string {
  if (ruta === undefined || !ruta.startsWith('/')) return '/';
  if (ruta.startsWith('//') || ruta.startsWith('/\\')) return '/';

  return ruta;
}

/**
 * Adonde llevar al tocar la notificacion.
 *
 * **La ruta llega COMPLETA desde la API, con el slug del gimnasio**
 * (`/<slug>/mi-pack`): lo pone el `urlPush` de los processors, que son quienes
 * saben de que tenant es el aviso. Aqui no se adivina nada, y esa es toda la
 * funcion: filtrar el origen y abrir lo que vino.
 *
 * ⚠️ NO se completa el slug desde una ventana abierta, y el motivo importa
 * porque es tentador. Falla en los dos casos que cuentan:
 *
 * 1. Con la aplicacion CERRADA —el caso normal al tocar una notificacion— no hay
 *    ninguna ventana de la que sacarlo, asi que no defiende nada.
 * 2. A un socio de dos gimnasios con una pestaña abierta en el otro lo llevaria
 *    a `/gym-b/calendario`: una pantalla plausible y EQUIVOCADA, que es peor que
 *    un 404 porque no se nota.
 *
 * Un destino ambiguo se arregla en quien lo emite, no en quien lo recibe.
 */
export function destinoDeNotificacion(ruta: string | undefined): string {
  return rutaSegura(ruta);
}
