import { describe, expect, it } from 'vitest';
import { sesionValidaPara } from './sesion';

describe('sesionValidaPara', () => {
  it('acepta cuando hay token y el slug coincide', () => {
    expect(sesionValidaPara({ access: 'tok', slug: 'mi-gym' }, 'mi-gym')).toBe(true);
  });

  it('rechaza sin token', () => {
    expect(sesionValidaPara({ access: undefined, slug: 'mi-gym' }, 'mi-gym')).toBe(false);
  });

  it('rechaza si el slug de la URL es de OTRO gimnasio', () => {
    // El caso que justifica que exista la cookie del slug: el JWT lleva su
    // propio tenantId, asi que la API responderia con datos de mi-gym bajo la
    // URL de otro-gym sin quejarse de nada.
    expect(sesionValidaPara({ access: 'tok', slug: 'mi-gym' }, 'otro-gym')).toBe(false);
  });

  it('rechaza si no hay slug guardado', () => {
    expect(sesionValidaPara({ access: 'tok', slug: undefined }, 'mi-gym')).toBe(false);
  });

  it('una cadena vacia no cuenta como slug', () => {
    expect(sesionValidaPara({ access: 'tok', slug: '' }, '')).toBe(false);
  });
});
