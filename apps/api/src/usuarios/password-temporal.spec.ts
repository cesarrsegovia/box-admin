import { generarPasswordTemporal } from './password-temporal';

describe('generarPasswordTemporal', () => {
  it('produce al menos 16 caracteres', () => {
    expect(generarPasswordTemporal().length).toBeGreaterThanOrEqual(16);
  });

  it('solo usa caracteres seguros en URL y al copiar y pegar', () => {
    for (let i = 0; i < 50; i++) {
      expect(generarPasswordTemporal()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('no repite: 200 generaciones dan 200 valores distintos', () => {
    const vistas = new Set(Array.from({ length: 200 }, () => generarPasswordTemporal()));
    expect(vistas.size).toBe(200);
  });
});
