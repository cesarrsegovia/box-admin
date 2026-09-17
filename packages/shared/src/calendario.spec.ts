import {
  diasDelMes,
  fechasDelMesEnDiaSemana,
  primerDiaDelMesUtc,
  rangosSeSolapan,
  ultimoDiaDelMesUtc,
} from './calendario';

describe('primerDiaDelMesUtc / ultimoDiaDelMesUtc', () => {
  it('acota un mes de 31 dias', () => {
    expect(primerDiaDelMesUtc(2026, 10).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(ultimoDiaDelMesUtc(2026, 10).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('acota un mes de 30 dias', () => {
    expect(ultimoDiaDelMesUtc(2026, 11).toISOString()).toBe('2026-11-30T00:00:00.000Z');
  });

  it('acota febrero comun y bisiesto', () => {
    expect(ultimoDiaDelMesUtc(2026, 2).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(ultimoDiaDelMesUtc(2028, 2).toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('diciembre no se va al anio siguiente', () => {
    expect(ultimoDiaDelMesUtc(2026, 12).toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });
});

describe('diasDelMes', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i tiene %i dias', (anio, mes, esperado) => {
    expect(diasDelMes(anio, mes)).toBe(esperado);
  });
});

describe('fechasDelMesEnDiaSemana', () => {
  it('devuelve todos los martes de octubre de 2026', () => {
    // 2026-10-01 es jueves; los martes son 6, 13, 20 y 27.
    const martes = fechasDelMesEnDiaSemana(2026, 10, 2).map((f) => f.toISOString().slice(0, 10));

    expect(martes).toEqual(['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27']);
  });

  it('cuenta el domingo como 0', () => {
    const domingos = fechasDelMesEnDiaSemana(2026, 10, 0).map((f) => f.toISOString().slice(0, 10));

    expect(domingos).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  });

  it('un mes puede tener cinco ocurrencias del mismo dia', () => {
    // Octubre de 2026 empieza en jueves, asi que tiene cinco.
    expect(fechasDelMesEnDiaSemana(2026, 10, 4)).toHaveLength(5);
  });

  it('devuelve fechas a medianoche UTC, para comparar con columnas @db.Date', () => {
    for (const fecha of fechasDelMesEnDiaSemana(2026, 10, 2)) {
      expect(fecha.toISOString().slice(10)).toBe('T00:00:00.000Z');
    }
  });

  it('rechaza un dia de semana fuera de 0..6', () => {
    expect(() => fechasDelMesEnDiaSemana(2026, 10, 7)).toThrow();
    expect(() => fechasDelMesEnDiaSemana(2026, 10, -1)).toThrow();
  });

  it('rechaza un mes fuera de 1..12', () => {
    expect(() => fechasDelMesEnDiaSemana(2026, 13, 2)).toThrow();
    expect(() => fechasDelMesEnDiaSemana(2026, 0, 2)).toThrow();
  });
});

describe('rangosSeSolapan', () => {
  const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

  it('detecta un solape parcial', () => {
    expect(
      rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-08'), d('2026-10-12')),
    ).toBe(true);
  });

  it('los extremos cuentan como solape', () => {
    expect(
      rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-10'), d('2026-10-12')),
    ).toBe(true);
  });

  it('rangos disjuntos no se solapan', () => {
    expect(
      rangosSeSolapan(d('2026-10-05'), d('2026-10-10'), d('2026-10-11'), d('2026-10-12')),
    ).toBe(false);
  });

  it('un fin nulo significa "sin limite"', () => {
    expect(rangosSeSolapan(d('2026-01-01'), null, d('2030-05-05'), d('2030-06-06'))).toBe(true);
  });
});
