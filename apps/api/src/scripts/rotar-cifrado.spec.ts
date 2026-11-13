import { cifrar, claveDesdeHex, descifrar } from '../comunicacion/cifrado';
import { rotar } from './rotar-cifrado';

// Las claves se escriben a mano y no salen de `clavesDeApp`: el test fija el
// contrato (la actual cifra, la lista descifra en orden), no lo que devuelva
// el helper.
const ACTUAL = claveDesdeHex('1'.repeat(64));
const ANTERIOR = claveDesdeHex('2'.repeat(64));
const AJENA = claveDesdeHex('3'.repeat(64));
const CLAVES = { actual: ACTUAL, paraDescifrar: [ACTUAL, ANTERIOR] };

describe('rotar', () => {
  it('re-cifra con la ACTUAL lo que estaba con la anterior', () => {
    const viejo = cifrar('smtp-t1', ANTERIOR);

    const resultado = rotar([{ id: 't1', valor: viejo }], CLAVES);

    expect(resultado.rotadas).toBe(1);
    expect(resultado.nuevas).toHaveLength(1);
    expect(resultado.nuevas[0]!.id).toBe('t1');
    // Se lee con la actual SOLA: es lo que pasa cuando se quita la anterior.
    expect(descifrar(resultado.nuevas[0]!.valor, [ACTUAL])).toBe('smtp-t1');
  });

  it('salta lo que ya esta con la actual: no lo reescribe', () => {
    const resultado = rotar([{ id: 't1', valor: cifrar('smtp-t1', ACTUAL) }], CLAVES);

    expect(resultado.rotadas).toBe(0);
    expect(resultado.alDia).toBe(1);
    expect(resultado.nuevas).toEqual([]);
  });

  it('es idempotente: una segunda pasada sobre lo rotado no rota nada', () => {
    const primera = rotar([{ id: 't1', valor: cifrar('smtp-t1', ANTERIOR) }], CLAVES);
    const segunda = rotar(primera.nuevas, CLAVES);

    expect(segunda).toEqual({ rotadas: 0, alDia: 1, fallidas: [], nuevas: [] });
  });

  it('cuenta como fallidas las que no descifra ninguna clave, y sigue con las demas', () => {
    const resultado = rotar(
      [
        { id: 'ajena', valor: cifrar('x', AJENA) },
        { id: 'rota', valor: 'no-es-un-cifrado' },
        { id: 'vieja', valor: cifrar('smtp-vieja', ANTERIOR) },
        { id: 'nueva', valor: cifrar('smtp-nueva', ACTUAL) },
      ],
      CLAVES,
    );

    expect(resultado.fallidas).toEqual(['ajena', 'rota']);
    expect(resultado.rotadas).toBe(1);
    expect(resultado.alDia).toBe(1);
    expect(resultado.nuevas.map((n) => n.id)).toEqual(['vieja']);
  });

  it('sin anterior, lo de la anterior falla en vez de darse por bueno', () => {
    const resultado = rotar([{ id: 't1', valor: cifrar('smtp-t1', ANTERIOR) }], {
      actual: ACTUAL,
      paraDescifrar: [ACTUAL],
    });

    expect(resultado).toEqual({ rotadas: 0, alDia: 0, fallidas: ['t1'], nuevas: [] });
  });
});
