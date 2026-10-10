/**
 * A DONDE SE MANDA A ALGUIEN CUANDO SE LE CADUCA LA SESION, con lo que estaba
 * mirando puesto.
 *
 * Vive aqui y no repetido en cada pantalla por una razon concreta y medida: la
 * linea estuvo cuatro veces copiada —personas, ficha, invitaciones, calendario—
 * y las cuatro cableaban el camino y TIRABAN EL QUERY. En pantallas donde el
 * query ES el estado (los filtros del listado, la sala y el mes del
 * calendario), eso devuelve a la persona a una pantalla vacia despues de volver
 * a escribir la contraseña, y encima parece que funciona.
 *
 * Ese veredicto ya estaba escrito en este repo, en el layout del panel, sobre
 * este mismo patron: «Cableado a `/${slug}/admin`, este `volverA` NO CONSERVABA
 * NADA ... Parecia que funcionaba, que es peor que no estar».
 *
 * En un solo sitio y no en cuatro porque cuatro lineas iguales son cuatro
 * sitios donde la quinta pantalla se olvida. La quinta copia esta llamada y
 * hereda el comportamiento correcto sin tener que saber nada de esto.
 *
 * Lo que sale de aqui acaba en `rutaDeRetornoSegura`, que es quien decide si el
 * destino es aceptable. Este helper NO valida: arma. Los tests comprueban que
 * lo que arma sobrevive entero a esa funcion, que es lo unico que importa.
 */

/**
 * «Esta pantalla no tiene query que conservar», con nombre.
 *
 * Existe para que copiar la llamada no sea copiar un olvido: un `''` suelto en
 * el segundo argumento se lee como un valor por defecto que nadie decidio, y es
 * exactamente asi como la proxima pantalla perderia sus filtros. Con un nombre,
 * quien copie ve que hay una decision y se pregunta si es la suya.
 */
export const SIN_QUERY = '';

/**
 * @param pathname El camino actual, tal cual lo devuelve `usePathname()`.
 * @param search El query actual: `useSearchParams().toString()` (sin `?`) o un
 *   `window.location.search` (con `?`). Se aceptan los dos.
 * @param slug El gimnasio, que es tambien el prefijo que la lista blanca exige.
 */
export function destinoDeLoginDesde(pathname: string, search: string, slug: string): string {
  // `useSearchParams().toString()` no lleva `?` y `window.location.search` si.
  // Aceptar las dos formas evita que la proxima pantalla tenga que acordarse de
  // cual era, y que un `??tipo=alumno` acabe en el historial de alguien.
  const consulta = search.startsWith('?') ? search.slice(1) : search;

  // Sin query NO se cuela un `?` pelado al final: `/mi-gym/admin/usuarios?` no
  // es la misma cadena que `/mi-gym/admin/usuarios`, y el destino acabaria
  // dependiendo de si la pantalla tenia filtros puestos.
  const volverA = consulta === '' ? pathname : `${pathname}?${consulta}`;

  // `encodeURIComponent` y no una plantilla a pelo: sin codificar, el `&` del
  // segundo filtro cortaria el `volverA` por la mitad y el login recibiria dos
  // parametros en vez de uno.
  return `/${slug}/login?volverA=${encodeURIComponent(volverA)}`;
}
