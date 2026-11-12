import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from './cliente';
import { destinoSiCaducoLaSesion } from './sesion-caducada';

const CADUCADA = new ErrorDeApi('Unauthorized', 401);

describe('destinoSiCaducoLaSesion', () => {
  it('un 401 manda al login del gimnasio, con la vuelta a donde estaba', () => {
    expect(
      destinoSiCaducoLaSesion(CADUCADA, {
        pathname: '/mi-gym/admin/usuarios',
        search: '?tipo=alumno',
      }),
    ).toBe('/mi-gym/login?volverA=%2Fmi-gym%2Fadmin%2Fusuarios%3Ftipo%3Dalumno');
  });

  it('sin query, la vuelta es la ruta pelada', () => {
    expect(
      destinoSiCaducoLaSesion(CADUCADA, { pathname: '/otro-gym/mis-clases', search: '' }),
    ).toBe('/otro-gym/login?volverA=%2Fotro-gym%2Fmis-clases');
  });

  it.each([
    ['un 403', new ErrorDeApi('Forbidden', 403)],
    ['un 500', new ErrorDeApi('Se cayo', 500)],
    ['sin conexion', new ErrorDeApi('Sin red', 0)],
    ['un Error comun', new Error('401')],
    ['algo que no es un error', { estado: 401 }],
  ])('%s no manda a ningun lado', (_caso, error) => {
    expect(destinoSiCaducoLaSesion(error, { pathname: '/mi-gym/admin', search: '' })).toBeNull();
  });

  it('sin gimnasio en la ruta no manda a ningun lado', () => {
    expect(destinoSiCaducoLaSesion(CADUCADA, { pathname: '/', search: '' })).toBeNull();
  });

  it('ya en el login no vuelve a mandar al login', () => {
    expect(
      destinoSiCaducoLaSesion(CADUCADA, { pathname: '/mi-gym/login', search: '?volverA=x' }),
    ).toBeNull();
  });
});
