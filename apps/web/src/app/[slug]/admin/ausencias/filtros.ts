import type { FiltrosDeAusencias } from '@/hooks/use-ausencias';

/**
 * LOS FILTROS DE LOS CIERRES, FUERA DE `page.tsx` Y NO DENTRO.
 *
 * No es una preferencia de orden: **Next 15 prohibe que un `page.tsx` exporte
 * cualquier cosa que no sea el `default` y su lista corta de claves de
 * configuracion** (`dynamic`, `revalidate`, `generateStaticParams`…). Un
 * `export function` de mas ahi compila con `tsc --noEmit` y con el bundler, y
 * revienta despues, en el paso de «Linting and checking validity of types» de
 * `next build`, con un error que habla de `OmitWithTag` y de una propiedad que
 * no es asignable a `never` — que no se parece en nada a la causa.
 *
 * Por eso vive aqui, igual que `turnos/filtros.tsx`: la pantalla la usa para
 * armar la consulta y el spec la usa para saber con que clave sembrar la
 * cache, y que las dos cosas salgan de la MISMA funcion es lo que impide que
 * un test pase con una lectura equivocada.
 */

/**
 * Un valor con algo dentro, o nada.
 *
 * Una cadena vacia NO es «sin filtro» para la API: `?salaId=` seria una sala
 * cuyo id es la cadena vacia y devolveria una lista vacia, que la pantalla
 * leeria como «no hay cierres cargados» sobre un salon que cierra en Navidad.
 * `queryDeAusencias` ya corta eso en el hook; aqui se corta antes, para que la
 * clave de cache y la peticion sean las mismas con `?desde=` que sin el.
 */
function valorDeLaUrl(valor: string | null): string | undefined {
  if (valor === null || valor.trim() === '') return undefined;
  return valor;
}

/**
 * LA URL ES LA FUENTE DE VERDAD DE LOS FILTROS.
 *
 * NO se valida el formato de las fechas que vienen de la URL. Una fecha basura
 * la rechaza el `@Query` del controller devolviendo lo que devuelva, y
 * rechazarla aqui dejaria el filtro de un enlace compartido sin efecto en el
 * primer pintado y con efecto en el segundo.
 */
export function filtrosDeLaBusqueda(parametros: URLSearchParams): FiltrosDeAusencias {
  const filtros: FiltrosDeAusencias = {};

  const salaId = valorDeLaUrl(parametros.get('salaId'));
  if (salaId !== undefined) filtros.salaId = salaId;

  const desde = valorDeLaUrl(parametros.get('desde'));
  if (desde !== undefined) filtros.desde = desde;

  const hasta = valorDeLaUrl(parametros.get('hasta'));
  if (hasta !== undefined) filtros.hasta = hasta;

  return filtros;
}
