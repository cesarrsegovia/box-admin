import { NextRequest, NextResponse } from 'next/server';
import { describe, expect, it } from 'vitest';
import { CABECERA_DE_RUTA } from '@/lib/ruta-pedida';
import { config, middleware } from './middleware';

function pedir(url: string, cabeceras: Record<string, string> = {}) {
  return middleware(new NextRequest(`http://localhost${url}`, { headers: cabeceras }));
}

/** Lo que el middleware estampa llega al servidor asi. */
function rutaEstampada(respuesta: Response): string | null {
  return respuesta.headers.get(`x-middleware-request-${CABECERA_DE_RUTA}`);
}

describe('el middleware estampa la ruta', () => {
  it('estampa el camino pedido', () => {
    expect(rutaEstampada(pedir('/mi-gym/mi-pack'))).toBe('/mi-gym/mi-pack');
  });

  it('estampa tambien la query, que es parte de donde estaba el usuario', () => {
    expect(rutaEstampada(pedir('/mi-gym/admin/usuarios?tipo=profesor'))).toBe(
      '/mi-gym/admin/usuarios?tipo=profesor',
    );
  });

  it('sin query no inventa un "?" al final', () => {
    expect(rutaEstampada(pedir('/mi-gym/calendario'))).toBe('/mi-gym/calendario');
  });

  it('la cabecera que trae el cliente se PISA, no se respeta', () => {
    const respuesta = pedir('/mi-gym/mi-pack', { [CABECERA_DE_RUTA]: '/otro-gimnasio/secreto' });

    expect(rutaEstampada(respuesta)).toBe('/mi-gym/mi-pack');
  });

  /**
   * LA AUDITORIA DE LO QUE SOBRA.
   *
   * Los tests de arriba miran que `x-ruta` este. Ninguno ve que el middleware
   * estampe ADEMAS otra cosa —el rol, el tenant, un id de peticion— sin quitar
   * nada. Y es el sitio ideal para que pase: una cabecera de mas no se dibuja
   * en ninguna parte, no rompe nada y viaja en TODAS las peticiones. Solo lo
   * ve el total.
   *
   * El total se cuenta contra las cabeceras que ENTRARON, no contra una lista
   * escrita a mano: `NextResponse.next({ request })` reenvia el juego entero,
   * asi que lo que este archivo añade es exactamente la diferencia.
   */
  it('al juego de cabeceras le añade UNA y solo una', () => {
    const entrantes = {
      cookie: 'bx_access=secreto',
      referer: 'http://localhost/mi-gym/perfil',
    };

    const respuesta = pedir('/mi-gym/mi-pack?tipo=profesor', entrantes);

    const estampadas = [...respuesta.headers.keys()]
      .filter((nombre) => nombre.startsWith('x-middleware-request-'))
      .map((nombre) => nombre.slice('x-middleware-request-'.length))
      .sort();

    expect(estampadas).toEqual([...Object.keys(entrantes), CABECERA_DE_RUTA].sort());
  });

  /**
   * LA OTRA DIRECCION, QUE ES LA QUE DUELE.
   *
   * El test de arriba cuenta lo que viaja hacia DENTRO —`x-middleware-request-*`,
   * que se queda en el servidor—. Una cabecera puesta sobre la respuesta no
   * lleva ese prefijo, asi que aquel total ni la ve, y encima es peor: viaja al
   * NAVEGADOR, en cada peticion, y queda en los logs y en los proxys por los
   * que pase.
   *
   * El centinela es un token de sesion porque es la forma mas cara de que esto
   * salga mal: la cookie es httpOnly justo para que no se pueda leer, y
   * devolverla en una cabecera anula esa decision por completo.
   */
  it('no devuelve al navegador nada de su cosecha', () => {
    const respuesta = pedir('/mi-gym/mi-pack', { cookie: 'bx_access=token-centinela' });

    /**
     * `x-middleware-*` queda FUERA a proposito, y no es una excusa: ese
     * prefijo es la maquinaria con la que Next reenvia la peticion al
     * servidor, y ahi la cookie aparece porque ya venia en la peticion. Lo que
     * se audita aqui es lo otro: lo que sale de vuelta hacia el navegador.
     */
    const haciaElNavegador = (cabeceras: Headers) =>
      [...cabeceras.entries()].filter(([nombre]) => !nombre.startsWith('x-middleware-'));

    // El total se compara contra un `next()` pelado, no contra una lista
    // escrita a mano: asi no hay que mantenerla cuando Next cambie.
    expect(
      haciaElNavegador(respuesta.headers)
        .map(([nombre]) => nombre)
        .sort(),
    ).toEqual(
      haciaElNavegador(NextResponse.next().headers)
        .map(([nombre]) => nombre)
        .sort(),
    );

    expect(JSON.stringify(haciaElNavegador(respuesta.headers))).not.toContain('token-centinela');
  });
});

/**
 * EL MATCHER.
 *
 * Se compila a partir del valor REAL de `config`, no de una copia: un test con
 * su propia copia del patron aprueba el patron del test, no el que corre.
 *
 * Es una aproximacion —Next lo compila con path-to-regexp y aqui se usa
 * `RegExp` a secas—, pero el patron es una expresion regular tal cual y lo que
 * se comprueba es la lista de exclusiones, que es la parte que importa y la
 * que puede quedarse corta.
 */
describe('el matcher no corre donde no tiene nada que hacer', () => {
  const casa = (ruta: string) => new RegExp(`^${config.matcher[0]}$`).test(ruta);

  it('casa las pantallas, que son las que tienen puertas', () => {
    expect(casa('/mi-gym/mi-pack')).toBe(true);
    expect(casa('/mi-gym/admin/usuarios')).toBe(true);
    expect(casa('/mi-gym/login')).toBe(true);
  });

  it('NO casa el BFF', () => {
    expect(casa('/api/bx/usuarios')).toBe(false);
    expect(casa('/api/auth/login')).toBe(false);
  });

  it('NO casa los internos de Next', () => {
    expect(casa('/_next/static/chunks/main.js')).toBe(false);
    expect(casa('/_next/image')).toBe(false);
  });

  it('NO casa los estaticos, el service worker incluido', () => {
    expect(casa('/sw.js')).toBe(false);
    expect(casa('/favicon.ico')).toBe(false);
    expect(casa('/iconos/logo-192.png')).toBe(false);
  });
});
