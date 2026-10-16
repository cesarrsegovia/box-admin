import type { FiltrosDeHorarios } from '@/hooks/use-horarios';

/**
 * LOS FILTROS DE LOS HORARIOS, FUERA DE `page.tsx` Y NO DENTRO.
 *
 * Mismo motivo que en `ausencias/filtros.ts`: **Next 15 prohibe que un
 * `page.tsx` exporte cualquier cosa que no sea el `default`** y su lista corta
 * de claves de configuracion. Un `export function` de mas ahi pasa el
 * `tsc --noEmit` y el bundler, y revienta en el paso de tipos de `next build`
 * con un error que no se parece a la causa.
 */

/**
 * Un identificador con algo dentro, o nada.
 *
 * No se valida contra el catalogo: las profesoras y las salas llegan por red y
 * tarde, y rechazar un id mientras el catalogo viaja dejaria el filtro de la
 * URL sin efecto en el primer pintado y con efecto en el segundo. Un id que no
 * existe devuelve una lista vacia, que es un resultado honesto; un `?salaId=`
 * vacio seria una peticion distinta, y esa si se corta aqui.
 */
function identificadorDeLaUrl(valor: string | null): string | undefined {
  if (valor === null || valor.trim() === '') return undefined;
  return valor;
}

/**
 * LA URL ES LA FUENTE DE VERDAD DE LOS FILTROS.
 *
 * La pantalla la usa para armar la consulta y el spec la usa para saber con
 * que clave sembrar la cache: que las dos cosas salgan de la MISMA funcion es
 * lo que impide que un test pase con una lectura equivocada.
 */
export function filtrosDeLaBusqueda(parametros: URLSearchParams): FiltrosDeHorarios {
  const filtros: FiltrosDeHorarios = {};

  const profesorId = identificadorDeLaUrl(parametros.get('profesorId'));
  if (profesorId !== undefined) filtros.profesorId = profesorId;

  const salaId = identificadorDeLaUrl(parametros.get('salaId'));
  if (salaId !== undefined) filtros.salaId = salaId;

  return filtros;
}
