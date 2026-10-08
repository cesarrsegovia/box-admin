import { NetworkFirst, NetworkOnly } from 'serwist';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/** Una entrada de `runtimeCaching`, con el matcher ya reducido a lo que usamos. */
type ReglaDeCacheo = {
  matcher: (contexto: { url: URL; request: Request }) => boolean;
  handler: unknown;
};

/**
 * El service worker de verdad, probado en jsdom.
 *
 * En jsdom `self` es `window`, asi que los `addEventListener` de `sw.ts` quedan
 * enganchados al window del test y se pueden disparar con `dispatchEvent`. Lo
 * que no existe en jsdom es `registration` ni `clients`: se ponen a mano abajo.
 *
 * Serwist se sustituye entero. Lo que se prueba aqui es el push, no su cache, y
 * el modulo real intenta leer un manifiesto que solo existe tras el build.
 */
/**
 * `defaultCache` se sustituye por UNA regla que lo atrapa todo.
 *
 * No es un doble inventado: el `defaultCache` real de `@serwist/next` termina
 * en reglas de ese ancho —`pages` (por `Content-Type: text/html`), `pages-rsc`,
 * `apis` (todo `/api/` del mismo origen) y `others` (el resto del mismo
 * origen)—, asi que lo unico que importa de el aqui es que SE LLEVA TODO lo que
 * le llegue. Con eso, una regla puesta por detras de el queda tapada, que es
 * justo lo que hay que poder detectar.
 */
vi.mock('@serwist/next/worker', () => ({
  defaultCache: [{ matcher: () => true, handler: { esDefaultCache: true } }],
}));

/** El `runtimeCaching` tal cual se lo pasa `sw.ts` a Serwist, para ver su ORDEN. */
const capturado = vi.hoisted(() => ({
  opciones: undefined as { runtimeCaching?: ReglaDeCacheo[] } | undefined,
}));

vi.mock('serwist', () => ({
  NetworkFirst: class {},
  NetworkOnly: class {},
  Serwist: class {
    constructor(opciones: { runtimeCaching?: ReglaDeCacheo[] }) {
      capturado.opciones = opciones;
    }
    addEventListeners() {}
  },
}));

const mostrar = vi.fn();
const abrirVentana = vi.fn();
const ventanas = vi.fn<() => Promise<unknown[]>>(async () => []);

/**
 * La regla de cacheo DE VERDAD, la misma que usa el `matcher`. Se toma del
 * modulo al importarlo y no se reimplementa: un doble escrito a mano solo
 * sabria lo que creyo su autor.
 */
let esCacheable: typeof import('./sw').esCacheable;

beforeAll(async () => {
  Object.defineProperty(self, 'registration', {
    value: { showNotification: mostrar },
    configurable: true,
  });
  Object.defineProperty(self, 'clients', {
    value: { matchAll: ventanas, openWindow: abrirVentana },
    configurable: true,
  });

  // Se importa DESPUES de poner los dobles: el modulo se ejecuta al importarlo.
  ({ esCacheable } = await import('./sw'));
});

afterEach(() => {
  mostrar.mockClear();
  abrirVentana.mockClear();
  ventanas.mockReset();
  ventanas.mockResolvedValue([]);
});

/** Dispara un `push` como lo haria el navegador y espera a su `waitUntil`. */
async function llegaUnPush(cuerpo: string | undefined): Promise<void> {
  const esperas: Promise<unknown>[] = [];
  const evento = Object.assign(new Event('push'), {
    data: cuerpo === undefined ? null : { text: () => cuerpo },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });

  self.dispatchEvent(evento as unknown as Event);
  await Promise.all(esperas);
}

/** Dispara un `notificationclick` sobre una notificacion con esos datos. */
async function tocanLaNotificacion(datos: unknown): Promise<{ cerrada: boolean }> {
  const cerrar = vi.fn();
  const esperas: Promise<unknown>[] = [];
  const evento = Object.assign(new Event('notificationclick'), {
    notification: { close: cerrar, data: datos },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });

  self.dispatchEvent(evento as unknown as Event);
  await Promise.all(esperas);

  return { cerrada: cerrar.mock.calls.length > 0 };
}

describe('el handler de push del service worker', () => {
  it('muestra la notificacion con el titulo, el cuerpo y el destino', async () => {
    await llegaUnPush(
      JSON.stringify({ titulo: 'Tienes plaza', cuerpo: 'Hola Ana', url: '/calendario' }),
    );

    expect(mostrar).toHaveBeenCalledWith('Tienes plaza', {
      body: 'Hola Ana',
      icon: '/icono-192.png',
      data: { url: '/calendario' },
    });
  });

  it('el titulo va COMO TEXTO y sin tocar, con apostrofes y ampersands incluidos', async () => {
    // `showNotification` recibe una cadena, no HTML: escaparla aqui se veria
    // "O&#x27;Brien" en la pantalla del telefono.
    await llegaUnPush(JSON.stringify({ titulo: "Clase de O'Brien & Ana", cuerpo: '' }));

    expect(mostrar.mock.calls[0]![0]).toBe("Clase de O'Brien & Ana");
  });

  it('un cuerpo ilegible muestra algo igualmente en vez de reventar', async () => {
    await llegaUnPush('{roto');

    expect(mostrar).toHaveBeenCalledWith('BoxAdmin', expect.objectContaining({ body: '' }));
  });

  it('un push sin cuerpo tampoco se pierde', async () => {
    await llegaUnPush(undefined);

    expect(mostrar).toHaveBeenCalledWith('BoxAdmin', expect.anything());
  });
});

describe('el handler de notificationclick', () => {
  it('cierra la notificacion y abre el destino', async () => {
    const { cerrada } = await tocanLaNotificacion({ url: '/mi-gym/mi-pack' });

    expect(cerrada).toBe(true);
    expect(abrirVentana).toHaveBeenCalledWith('/mi-gym/mi-pack');
  });

  it('reutiliza una ventana abierta y la lleva al destino que mando la API', async () => {
    const navegar = vi.fn();
    const enfocar = vi.fn();
    ventanas.mockResolvedValue([
      { url: 'https://app.test/mi-gym/perfil', navigate: navegar, focus: enfocar },
    ]);

    await tocanLaNotificacion({ url: '/mi-gym/calendario' });

    expect(navegar).toHaveBeenCalledWith('/mi-gym/calendario');
    expect(enfocar).toHaveBeenCalled();
    expect(abrirVentana).not.toHaveBeenCalled();
  });

  it('de la ventana abierta NO deduce ningun gimnasio', async () => {
    const navegar = vi.fn();
    ventanas.mockResolvedValue([
      { url: 'https://app.test/gym-b/perfil', navigate: navegar, focus: vi.fn() },
    ]);

    // Reutilizarla es cortesia, no una fuente de datos: si de su URL se sacara
    // el gimnasio, un socio de dos acabaria en `/gym-b/gym-a/calendario`.
    await tocanLaNotificacion({ url: '/gym-a/calendario' });

    expect(navegar).toHaveBeenCalledWith('/gym-a/calendario');
  });

  it('si la ventana abierta no se deja navegar, abre una nueva', async () => {
    ventanas.mockResolvedValue([
      {
        url: 'https://app.test/mi-gym/perfil',
        navigate: vi.fn().mockRejectedValue(new Error('no controlada')),
        focus: vi.fn(),
      },
    ]);

    await tocanLaNotificacion({ url: '/mi-gym/calendario' });

    expect(abrirVentana).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('una notificacion sin datos abre la aplicacion y no falla', async () => {
    await tocanLaNotificacion(undefined);

    expect(abrirVentana).toHaveBeenCalledWith('/');
  });

  it('no abre nunca un destino de otro origen', async () => {
    await tocanLaNotificacion({ url: 'https://otro-sitio.test/robo' });

    expect(abrirVentana).toHaveBeenCalledWith('/');
  });
});

/** El handler de la PRIMERA regla que casa, que es la que Serwist aplica. */
function primerHandlerQueCasa(url: URL, request: Request): unknown {
  const reglas = capturado.opciones?.runtimeCaching ?? [];

  return reglas.find((regla) => regla.matcher({ url, request }))?.handler;
}

/**
 * Las cabeceras con las que Next pide UNA MISMA pantalla segun como se llegue a
 * ella.
 *
 * Next manda `RSC: 1` en cada navegacion de cliente, que es como un admin llega
 * de verdad a un listado: no recargando. Y lo que viaja entonces no es HTML
 * pintado sino los datos ya serializados. `defaultCache` mira estas cabeceras
 * en tres de sus reglas (`pages-rsc-prefetch`, `pages-rsc` y `pages`), asi que
 * una regla que case por cabecera puede colarse por delante de la exclusion sin
 * que el pathname cambie una letra.
 *
 * Agregar una cabecera nueva aqui amplia el barrido solo: las aserciones de
 * abajo no la nombran.
 */
const CABECERAS_DE_NEXT = [
  ['RSC', '1'],
  ['Next-Router-Prefetch', '1'],
  ['Accept', 'text/html'],
  ['Content-Type', 'text/html'],
] as const;

/**
 * TODAS las combinaciones de esas cabeceras, la de ninguna incluida.
 *
 * El barrido es del EJE y no de cinco casos sueltos: lo que se afirma abajo es
 * que NINGUNA combinacion cambia la decision, no que estas cinco no la cambian.
 */
function todasLasCombinaciones(
  cabeceras: readonly (readonly [string, string])[],
): Record<string, string>[] {
  return cabeceras.reduce<Record<string, string>[]>(
    (acumulado, [nombre, valor]) => [
      ...acumulado,
      ...acumulado.map((combinacion) => ({ ...combinacion, [nombre]: valor })),
    ],
    [{}],
  );
}

const COMBINACIONES = todasLasCombinaciones(CABECERAS_DE_NEXT);

/** Como se llama esta combinacion en el informe del fallo. */
function nombreDe(combinacion: Record<string, string>): string {
  return Object.keys(combinacion).join(' + ') || 'sin cabeceras';
}

/** Cual de los handlers gano, con un nombre que se lea en el diff del fallo. */
function nombreDelHandler(handler: unknown): string {
  if (handler instanceof NetworkOnly) return 'NetworkOnly';
  if (handler instanceof NetworkFirst) return 'NetworkFirst';

  return 'defaultCache';
}

/**
 * A que handler llega esa ruta con cada combinacion de cabeceras.
 *
 * Devuelve el mapa entero y no un booleano por caso: si alguna combinacion se
 * escapa, el fallo dice CUAL y a donde fue a parar, en vez de "esperaba true".
 */
function aDondeVaConCadaCabecera(ruta: string): Record<string, string> {
  const url = new URL(ruta);

  return Object.fromEntries(
    COMBINACIONES.map((combinacion) => [
      nombreDe(combinacion),
      nombreDelHandler(
        primerHandlerQueCasa(url, new Request(url, { method: 'GET', headers: combinacion })),
      ),
    ]),
  );
}

/** El mismo mapa con el handler que se espera en TODAS las combinaciones. */
function siempre(handler: string): Record<string, string> {
  return Object.fromEntries(COMBINACIONES.map((combinacion) => [nombreDe(combinacion), handler]));
}

describe('el panel del admin no se cachea', () => {
  it('una navegacion al panel NO casa con ninguna regla de cacheo', () => {
    const url = new URL('https://x.test/mi-gym/admin/usuarios');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(false);
  });

  it('una peticion de datos del panel tampoco', () => {
    const url = new URL('https://x.test/api/bx/usuarios');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(false);
  });

  // La regla no puede ser tan ancha que se lleve por delante la unica que
  // existe: el calendario del alumno es lo que hace que la PWA funcione sin red.
  it('el calendario del alumno SIGUE cacheandose', () => {
    const url = new URL('https://x.test/api/bx/mi-calendario?desde=2026-10-01&hasta=2026-10-07');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  /**
   * La vista de semana del alumno hace DOS consultas, no una: sus clases y los
   * turnos con cupo. Con una sola cacheada el offline queda a medias —el banner
   * de datos guardados al lado de la alerta de "sin conexion"— que es
   * exactamente lo que paso al cerrar la lista blanca.
   */
  it('los turnos disponibles del alumno TAMBIEN se cachean', () => {
    const url = new URL(
      'https://x.test/api/bx/turnos-disponibles?desde=2026-10-01&hasta=2026-10-07',
    );
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  it('el calendario del alumno como PANTALLA sigue cacheandose', () => {
    const url = new URL('https://x.test/mi-gym/calendario');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  // Un gimnasio que se llame "administracion" no es el panel.
  it('un slug que EMPIEZA por admin no es el panel', () => {
    const url = new URL('https://x.test/administracion/calendario');
    const request = new Request(url, { method: 'GET' });

    expect(esCacheable({ url, request })).toBe(true);
  });

  /**
   * Preguntarle a `esCacheable` no basta: la funcion diria lo mismo con la
   * exclusion delante o detras de `defaultCache`, y Serwist aplica la PRIMERA
   * regla que casa. Lo que se mira aqui es la CONFIGURACION, no la funcion.
   */
  it('la exclusion va ANTES de defaultCache en runtimeCaching', () => {
    const url = new URL('https://x.test/mi-gym/admin/usuarios');
    const request = new Request(url, { method: 'GET' });

    expect(primerHandlerQueCasa(url, request)).toBeInstanceOf(NetworkOnly);
  });

  /**
   * El pathname no es el unico eje por el que se decide: `defaultCache` tambien
   * mira cabeceras, asi que una regla que case por cabecera se cuela por
   * delante de la exclusion sin cambiar una letra de la ruta. Aqui se barre el
   * eje entero y no una cabecera concreta.
   */
  it('NINGUNA combinacion de cabeceras hace cacheable una ruta del panel', () => {
    expect(aDondeVaConCadaCabecera('https://x.test/mi-gym/admin/usuarios')).toEqual(
      siempre('NetworkOnly'),
    );
  });

  // Y el simetrico, porque el tapon no puede llevarse por delante el offline.
  it('NINGUNA combinacion de cabeceras aparta al calendario de su NetworkFirst', () => {
    expect(aDondeVaConCadaCabecera('https://x.test/api/bx/mi-calendario?desde=2026-10-01')).toEqual(
      siempre('NetworkFirst'),
    );
  });

  /**
   * La OTRA consulta de la misma pantalla. Llegar a `defaultCache` aqui no es
   * un fallo visible en el navegador —la regla `apis` tambien la guardaria—
   * pero llegar a `NetworkOnly` deja al alumno con media semana sin red, que es
   * la regresion que hubo que arreglar.
   */
  it('NINGUNA combinacion de cabeceras aparta los turnos disponibles de su NetworkFirst', () => {
    expect(
      aDondeVaConCadaCabecera('https://x.test/api/bx/turnos-disponibles?desde=2026-10-01'),
    ).toEqual(siempre('NetworkFirst'));
  });

  /**
   * LA FORMA DE LISTA BLANCA, no de exclusion.
   *
   * Lo valioso de la regla es que un endpoint que se agregue mañana nace FUERA
   * de la cache sin que nadie se acuerde de excluirlo. Esta ruta no existe: su
   * trabajo es fallar el dia que alguien convierta la lista blanca en una lista
   * negra "para que entre lo nuevo".
   */
  it('un endpoint que NADIE puso en la lista blanca nace fuera de la cache', () => {
    expect(aDondeVaConCadaCabecera('https://x.test/api/bx/un-endpoint-de-mañana')).toEqual(
      siempre('NetworkOnly'),
    );
  });

  // La PANTALLA del alumno tiene que seguir llegando a la carcasa: es de ahi de
  // donde sale el calendario cuando se recarga sin red.
  it('NINGUNA combinacion de cabeceras deja la pantalla del alumno sin carcasa', () => {
    expect(aDondeVaConCadaCabecera('https://x.test/mi-gym/calendario')).toEqual(
      siempre('defaultCache'),
    );
  });
});
