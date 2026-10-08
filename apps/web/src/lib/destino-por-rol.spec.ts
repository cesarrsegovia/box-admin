import { describe, expect, it } from 'vitest';
import { destinoPorRol } from './destino-por-rol';

describe('destinoPorRol', () => {
  it('un ADMIN_OPERATIVO va al panel', () => {
    expect(destinoPorRol('ADMIN_OPERATIVO', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ADMIN_SALON tambien, porque los roles son jerarquicos', () => {
    expect(destinoPorRol('ADMIN_SALON', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un SUPERADMIN tambien', () => {
    expect(destinoPorRol('SUPERADMIN', 'mi-gym')).toBe('/mi-gym/admin');
  });

  it('un ALUMNO va al calendario', () => {
    expect(destinoPorRol('ALUMNO', 'mi-gym')).toBe('/mi-gym/calendario');
  });

  it('un PROFESOR va al calendario, porque no tiene pantalla propia todavia', () => {
    expect(destinoPorRol('PROFESOR', 'mi-gym')).toBe('/mi-gym/calendario');
  });

  it('un FANTASMA va al calendario y NO al panel', () => {
    expect(destinoPorRol('FANTASMA', 'mi-gym')).toBe('/mi-gym/calendario');
  });
});
