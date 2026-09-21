import { describe, expect, it } from 'vitest';
import { diasDeLaSemana, semanaDe, sumarSemanas } from './semana';

describe('semanaDe', () => {
  it('una semana va de lunes a domingo', () => {
    // El 2099-10-14 es miercoles.
    expect(semanaDe('2099-10-14')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('un lunes se queda en su sitio', () => {
    expect(semanaDe('2099-10-12')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('un domingo pertenece a la semana que TERMINA, no a la que empieza', () => {
    // Es la convencion europea, y la que espera cualquiera que mire un
    // calendario aqui. Con la semana empezando en domingo, el domingo saltaria
    // solo a la vista siguiente.
    expect(semanaDe('2099-10-18')).toEqual({ desde: '2099-10-12', hasta: '2099-10-18' });
  });

  it('cruza el cambio de mes sin romperse', () => {
    // El 2099-11-01 es domingo.
    expect(semanaDe('2099-11-01')).toEqual({ desde: '2099-10-26', hasta: '2099-11-01' });
  });

  it('cruza el cambio de año', () => {
    // El 2100-01-01 es viernes.
    expect(semanaDe('2100-01-01')).toEqual({ desde: '2099-12-28', hasta: '2100-01-03' });
  });
});

describe('sumarSemanas', () => {
  it('avanza siete dias', () => {
    expect(sumarSemanas('2099-10-14', 1)).toBe('2099-10-21');
  });

  it('retrocede siete dias', () => {
    expect(sumarSemanas('2099-10-14', -1)).toBe('2099-10-07');
  });

  it('cruza el cambio de año hacia atras', () => {
    expect(sumarSemanas('2100-01-01', -1)).toBe('2099-12-25');
  });
});

describe('diasDeLaSemana', () => {
  it('devuelve los siete dias en orden', () => {
    const dias = diasDeLaSemana('2099-10-12');

    expect(dias).toHaveLength(7);
    expect(dias[0]).toBe('2099-10-12');
    expect(dias[6]).toBe('2099-10-18');
  });
});
