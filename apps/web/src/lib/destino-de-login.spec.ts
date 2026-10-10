import { describe, expect, it } from 'vitest';
import { rutaDeRetornoSegura } from './ruta-de-retorno';
import { destinoDeLoginDesde } from './destino-de-login';

const SLUG = 'mi-gym';

/** El `volverA` que acabo en la URL del login, ya decodificado. */
function volverADe(url: string): string | null {
  return new URL(url, 'http://x').searchParams.get('volverA');
}

/**
 * EL VIAJE ENTERO, que es lo unico que importa.
 *
 * Comprobar como se escribio la cadena no sirve: lo que decide a donde aterriza
 * la persona es `rutaDeRetornoSegura`, y un destino que esta funcion rechaza
 * cae al calendario igual que si no se hubiera conservado nada —solo que ahora
 * con mas codigo—. Asi que el destino se pasa POR esa funcion y se comprueba
 * que vuelve igual.
 */
function sobreviveAlLogin(pathname: string, search: string): string {
  return rutaDeRetornoSegura(
    volverADe(destinoDeLoginDesde(pathname, search, SLUG)) ?? undefined,
    SLUG,
  );
}

describe('destinoDeLoginDesde', () => {
  it('manda al login de SU gimnasio', () => {
    expect(destinoDeLoginDesde('/mi-gym/admin/usuarios', '', SLUG)).toBe(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/usuarios')}`,
    );
  });

  it('sin query, el destino es el camino pelado y nada mas', () => {
    expect(volverADe(destinoDeLoginDesde('/mi-gym/admin/usuarios', '', SLUG))).toBe(
      '/mi-gym/admin/usuarios',
    );
  });

  // `/mi-gym/admin/usuarios?` no es la misma cadena que `/mi-gym/admin/usuarios`:
  // el destino acabaria dependiendo de si la pantalla tenia filtros puestos.
  it('sin query no se cuela un `?` pelado al final', () => {
    const destino = volverADe(destinoDeLoginDesde('/mi-gym/admin/usuarios', '', SLUG));

    expect(destino).not.toContain('?');
  });

  it('acepta el query venga con `?` o sin el', () => {
    const sinInterrogante = volverADe(
      destinoDeLoginDesde('/mi-gym/admin/usuarios', 'tipo=alumno', SLUG),
    );
    const conInterrogante = volverADe(
      destinoDeLoginDesde('/mi-gym/admin/usuarios', '?tipo=alumno', SLUG),
    );

    expect(sinInterrogante).toBe('/mi-gym/admin/usuarios?tipo=alumno');
    expect(conInterrogante).toBe('/mi-gym/admin/usuarios?tipo=alumno');
  });

  it('un `?` solo no deja un `?` colgando', () => {
    expect(volverADe(destinoDeLoginDesde('/mi-gym/admin/usuarios', '?', SLUG))).toBe(
      '/mi-gym/admin/usuarios',
    );
  });

  /**
   * EL QUERY VIAJA ENTERO Y CODIFICADO.
   *
   * Sin codificar, el `&` del segundo filtro corta el `volverA` por la mitad:
   * el login recibe `volverA=/mi-gym/admin/usuarios?tipo=profesor` y un
   * `activo=false` suelto, y el destino que vuelve esta recortado sin que nada
   * lo avise.
   */
  it('con varios parametros, el query llega entero', () => {
    expect(
      volverADe(destinoDeLoginDesde('/mi-gym/admin/usuarios', 'tipo=profesor&activo=false', SLUG)),
    ).toBe('/mi-gym/admin/usuarios?tipo=profesor&activo=false');
  });

  it('el `&` va codificado, no partiendo la URL del login', () => {
    const url = destinoDeLoginDesde('/mi-gym/admin/usuarios', 'tipo=profesor&activo=false', SLUG);

    // Un solo parametro en la URL del login, no tres.
    expect([...new URL(url, 'http://x').searchParams.keys()]).toEqual(['volverA']);
  });
});

/**
 * LO QUE DE VERDAD IMPORTA: que `rutaDeRetornoSegura` lo acepte y lo devuelva
 * igual. Si no pasara su lista blanca, el arreglo entero no serviria de nada y
 * la persona caeria en el calendario igual que antes.
 */
describe('el destino sobrevive a rutaDeRetornoSegura', () => {
  it.each([
    ['sin query', '/mi-gym/admin/usuarios', '', '/mi-gym/admin/usuarios'],
    [
      'con un filtro',
      '/mi-gym/admin/usuarios',
      'tipo=alumno',
      '/mi-gym/admin/usuarios?tipo=alumno',
    ],
    [
      'con varios filtros',
      '/mi-gym/admin/usuarios',
      'tipo=profesor&activo=false',
      '/mi-gym/admin/usuarios?tipo=profesor&activo=false',
    ],
    [
      'con la sala y el mes del calendario',
      '/mi-gym/admin/calendario',
      'salaId=s1&anio=2026&mes=11',
      '/mi-gym/admin/calendario?salaId=s1&anio=2026&mes=11',
    ],
    ['una ficha', '/mi-gym/admin/usuarios/u1', '', '/mi-gym/admin/usuarios/u1'],
  ])('%s vuelve igual', (_caso, pathname, search, esperado) => {
    expect(sobreviveAlLogin(pathname, search)).toBe(esperado);
  });

  // El respaldo de `rutaDeRetornoSegura` es el calendario del alumno: si alguno
  // de los de arriba cayera ahi, el test diria "igual que antes, con mas
  // codigo". Esto lo nombra para que no se lea como un detalle.
  it('ninguno cae al respaldo del calendario del alumno', () => {
    expect(sobreviveAlLogin('/mi-gym/admin/calendario', 'salaId=s1&anio=2026&mes=11')).not.toBe(
      '/mi-gym/calendario',
    );
  });
});
