import { describe, expect, it } from 'vitest';
import { ErrorDeApi } from './cliente';
import { mensajeDeFallo } from './errores-de-api';

describe('mensajeDeFallo', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    expect(mensajeDeFallo(new ErrorDeApi('Unauthorized', 401), 'ADMIN_OPERATIVO')).toBe(
      'Tu sesión caducó. Te llevamos al login.',
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
