import { ErrorDeApi } from './cliente';
import { destinoDeLoginDesde } from './destino-de-login';

/**
 * Lo que se lee cuando la sesion vencio: en el aviso de una lectura y, el
 * instante antes de salir, en el de una escritura. UNA frase para toda la app.
 */
export const TEXTO_DE_SESION_CADUCADA = 'Tu sesión caducó. Te llevamos al login.';

/**
 * A DONDE MANDAR A QUIEN SE LE CADUCO LA SESION AL GUARDAR, o `null` si el
 * error no es eso.
 *
 * Pura y aparte de `query.tsx` para probarla sin montar el proveedor. El slug
 * es el primer segmento de la ruta: todo lo que escribe cuelga de `/[slug]`.
 * Sin slug, o ya en el login, no hay a donde mandar.
 */
export function destinoSiCaducoLaSesion(
  error: unknown,
  ubicacion: { pathname: string; search: string },
): string | null {
  if (!(error instanceof ErrorDeApi) || !error.esSesionCaducada) return null;

  const [, slug = '', seccion] = ubicacion.pathname.split('/');
  if (slug === '' || seccion === 'login') return null;

  return destinoDeLoginDesde(ubicacion.pathname, ubicacion.search, slug);
}
