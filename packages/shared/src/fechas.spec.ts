import {
  aFechaISO,
  desdeFechaISO,
  esHoraValida,
  FechaInvalidaError,
  comparaHoras,
} from './fechas';

describe('aFechaISO', () => {
  it('devuelve solo la parte de fecha, en UTC', () => {
    expect(aFechaISO(new Date('2026-03-08T00:00:00.000Z'))).toBe('2026-03-08');
  });

  it('no se corre de dia con una hora avanzada', () => {
    expect(aFechaISO(new Date('2026-03-08T23:59:59.999Z'))).toBe('2026-03-08');
  });
});

describe('desdeFechaISO', () => {
  it('produce la medianoche UTC del dia indicado', () => {
    expect(desdeFechaISO('2026-03-08').toISOString()).toBe('2026-03-08T00:00:00.000Z');
  });

  it('ida y vuelta sin perdida', () => {
    expect(aFechaISO(desdeFechaISO('2026-12-31'))).toBe('2026-12-31');
  });

  it('rechaza un dia que no existe en vez de correrlo al mes siguiente', () => {
    expect(() => desdeFechaISO('2026-02-31')).toThrow(FechaInvalidaError);
  });

  it('rechaza formatos que no son YYYY-MM-DD', () => {
    expect(() => desdeFechaISO('08/03/2026')).toThrow(FechaInvalidaError);
    expect(() => desdeFechaISO('2026-3-8')).toThrow(FechaInvalidaError);
    expect(() => desdeFechaISO('')).toThrow(FechaInvalidaError);
  });
});

describe('esHoraValida', () => {
  it.each(['00:00', '09:30', '18:00', '23:59'])('acepta %s', (hora) => {
    expect(esHoraValida(hora)).toBe(true);
  });

  it.each(['24:00', '18:60', '8:00', '18:0', '1800', '', '18:00:00'])(
    'rechaza %s',
    (hora) => {
      expect(esHoraValida(hora)).toBe(false);
    },
  );
});

describe('comparaHoras', () => {
  it('ordena lexicograficamente, que con HH:MM equivale a ordenar por hora', () => {
    expect(comparaHoras('09:00', '18:00')).toBeLessThan(0);
    expect(comparaHoras('18:00', '09:00')).toBeGreaterThan(0);
    expect(comparaHoras('18:00', '18:00')).toBe(0);
  });
});
