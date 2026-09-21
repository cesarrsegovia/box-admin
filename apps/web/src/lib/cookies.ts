/**
 * Lo unico que este modulo necesita de las cookies de una respuesta.
 *
 * Se declara estructuralmente en vez de importar el tipo de Next: el tipo real
 * vive en `next/dist/compiled/...`, que es una ruta interna que cambia entre
 * versiones sin avisar. Un `set` es todo lo que se usa aqui.
 */
interface CookiesDeRespuesta {
  set(nombre: string, valor: string, opciones: Record<string, unknown>): unknown;
}

export const COOKIE_ACCESS = 'bx_access';
export const COOKIE_REFRESH = 'bx_refresh';

/**
 * El gimnasio al que pertenece la sesion.
 *
 * Las cookies son del dominio, pero los tokens son de UN gimnasio. Sin esto,
 * alguien logueado en /gym-a/ que abriera /gym-b/calendario veria datos de A
 * bajo la URL de B, porque el JWT lleva su propio tenantId y la API responderia
 * tan tranquila.
 *
 * Es httpOnly como las otras dos: la lee el layout en el servidor, el cliente no
 * la necesita, y una cookie menos legible desde JavaScript es una menos que
 * manipular.
 */
export const COOKIE_SLUG = 'bx_slug';

/**
 * `sameSite: 'lax'` y no `'strict'`: con strict, volver a la aplicacion desde
 * un enlace externo no manda las cookies y el alumno aparece deslogueado sin
 * entender por que. `lax` ya bloquea el envio en peticiones cross-site que no
 * sean navegacion de primer nivel, que es lo que importa aqui.
 */
export function opcionesDeCookie(maxAge: number): Record<string, unknown> {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  };
}

/** 15 minutos, como el access token de la API. */
export const VIDA_ACCESS = 15 * 60;
/** 30 dias, como el refresh de la API. */
export const VIDA_REFRESH = 30 * 24 * 60 * 60;

export function borrarCookiesDeSesion(cookies: CookiesDeRespuesta): void {
  for (const nombre of [COOKIE_ACCESS, COOKIE_REFRESH, COOKIE_SLUG]) {
    cookies.set(nombre, '', { ...opcionesDeCookie(0), maxAge: 0 });
  }
}
