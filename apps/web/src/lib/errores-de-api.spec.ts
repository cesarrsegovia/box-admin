import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from './cliente';
import { frasesDeLaApi, mensajeDeFallo, repartirPorCampo, textoDelError } from './errores-de-api';
import { TEXTO_DE_SESION_CADUCADA } from './sesion-caducada';

/**
 * El 401 tal como lo contesta Nest: el `message` del cuerpo es «Unauthorized».
 * Con el cuerpo y sin el, porque `frasesDeLaApi` lee los dos caminos.
 */
const CADUCADAS = [
  [
    'con el cuerpo de Nest',
    new ErrorDeApi('Unauthorized', 401, { message: 'Unauthorized', statusCode: 401 }),
  ],
  ['sin cuerpo', new ErrorDeApi('Unauthorized', 401)],
] as const;

describe('frasesDeLaApi', () => {
  it.each(CADUCADAS)('un 401 %s dice que la sesion caduco, no «Unauthorized»', (_caso, error) => {
    expect(frasesDeLaApi(error)).toEqual([TEXTO_DE_SESION_CADUCADA]);
  });
});

describe('repartirPorCampo', () => {
  /**
   * El 401 no nombra ningun campo: va SUELTO, al cartel, y ese cartel es el
   * que tiene que decir que la sesion caduco.
   */
  it.each(CADUCADAS)('un 401 %s va al cartel con el texto comun', (_caso, error) => {
    expect(repartirPorCampo(error, ['nombre', 'activa'] as const)).toEqual({
      porCampo: {},
      sueltas: [TEXTO_DE_SESION_CADUCADA],
    });
  });

  it('lo demas se sigue repartiendo por campo', () => {
    const error = new ErrorDeApi('Bad Request', 400, {
      message: ['nombre must be a string', 'Algo suelto'],
    });

    expect(repartirPorCampo(error, ['nombre', 'activa'] as const)).toEqual({
      porCampo: { nombre: 'nombre must be a string' },
      sueltas: ['Algo suelto'],
    });
  });
});

describe('mensajeDeFallo', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    expect(mensajeDeFallo(new ErrorDeApi('Unauthorized', 401), 'ADMIN_OPERATIVO')).toBe(
      TEXTO_DE_SESION_CADUCADA,
    );
  });

  it('un 403 sigue diciendo que rol hace falta', () => {
    expect(mensajeDeFallo(new ErrorDeApi('Forbidden', 403), 'ADMIN_SALON')).toBe(
      'Para esto hace falta ser administrador del salon. Tu rol no alcanza.',
    );
  });

  it('lo demas, el mensaje de la API tal cual', () => {
    expect(mensajeDeFallo(new ErrorDeApi('Sala inexistente', 404), 'ADMIN_OPERATIVO')).toBe(
      'Sala inexistente',
    );
  });

  it('lo que no es de la API, un texto generico', () => {
    expect(mensajeDeFallo(new Error('x'), 'ADMIN_OPERATIVO')).toBe(
      'No se pudo completar la accion.',
    );
  });
});

describe('textoDelError', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    expect(textoDelError(new ErrorDeApi('Unauthorized', 401))).toBe(TEXTO_DE_SESION_CADUCADA);
  });

  /**
   * TODO LO DEMAS, TAL CUAL. A diferencia de `mensajeDeFallo`, el 403 NO se
   * reescribe: en las pantallas que usan esta funcion el mensaje de la API es
   * la parte util («Redis no contesta»).
   */
  it.each([
    ['un 403', new ErrorDeApi('Forbidden resource', 403), 'Forbidden resource'],
    ['un 503', new ErrorDeApi('Redis no contesta', 503), 'Redis no contesta'],
    [
      'sin conexion',
      new ErrorDeApi('Sin conexion: no se pudo subir el archivo.', 0),
      'Sin conexion: no se pudo subir el archivo.',
    ],
    ['un Error comun', new Error('Se rompio algo'), 'Se rompio algo'],
  ])('%s, el mensaje tal cual', (_caso, error, esperado) => {
    expect(textoDelError(error)).toBe(esperado);
  });
});
