import {
  aFechaISO,
  desdeFechaISO,
  esHoraValida,
  FechaInvalidaError,
  comparaHoras,
  fechaLegible,
  instanteDelTurno,
  minutosEntreHoras,
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

  it.each(['24:00', '18:60', '8:00', '18:0', '1800', '', '18:00:00'])('rechaza %s', (hora) => {
    expect(esHoraValida(hora)).toBe(false);
  });
});

describe('comparaHoras', () => {
  it('ordena lexicograficamente, que con HH:MM equivale a ordenar por hora', () => {
    expect(comparaHoras('09:00', '18:00')).toBeLessThan(0);
    expect(comparaHoras('18:00', '09:00')).toBeGreaterThan(0);
    expect(comparaHoras('18:00', '18:00')).toBe(0);
  });
});

describe('instanteDelTurno', () => {
  it('combina la fecha del turno con su hora de inicio', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(instanteDelTurno(fecha, '18:30').toISOString()).toBe('2099-10-13T18:30:00.000Z');
  });

  it('acepta la medianoche', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(instanteDelTurno(fecha, '00:00').toISOString()).toBe('2099-10-13T00:00:00.000Z');
  });

  it('ignora la hora que traiga el Date de la fecha', () => {
    // Prisma devuelve las columnas @db.Date a medianoche UTC, pero si alguna vez
    // llegara con hora, la hora del turno manda.
    const fecha = new Date('2099-10-13T09:45:00.000Z');

    expect(instanteDelTurno(fecha, '18:00').toISOString()).toBe('2099-10-13T18:00:00.000Z');
  });

  it('rechaza una hora con formato invalido', () => {
    const fecha = new Date('2099-10-13T00:00:00.000Z');

    expect(() => instanteDelTurno(fecha, '25:00')).toThrow(FechaInvalidaError);
    expect(() => instanteDelTurno(fecha, '8:00')).toThrow(FechaInvalidaError);
  });
});

describe('minutosEntreHoras', () => {
  it('una hora clavada', () => {
    expect(minutosEntreHoras('18:00', '19:00')).toBe(60);
  });

  it('hora y media', () => {
    expect(minutosEntreHoras('18:00', '19:30')).toBe(90);
  });

  it('cruzar la medianoche no se contempla: devuelve negativo y quien llame decide', () => {
    expect(minutosEntreHoras('23:00', '01:00')).toBe(-1320);
  });

  it('una hora invalida revienta en vez de mentir', () => {
    expect(() => minutosEntreHoras('25:00', '26:00')).toThrow(/Hora invalida/);
  });
});

describe('fechaLegible', () => {
  it.each([
    ['2026-10-04', 'domingo 4 de octubre'],
    ['2026-10-05', 'lunes 5 de octubre'],
    ['2026-10-06', 'martes 6 de octubre'],
    ['2026-10-07', 'miércoles 7 de octubre'],
    ['2026-10-08', 'jueves 8 de octubre'],
    ['2026-10-09', 'viernes 9 de octubre'],
    ['2026-10-10', 'sábado 10 de octubre'],
  ])('%s se escribe "%s"', (iso, esperado) => {
    expect(fechaLegible(desdeFechaISO(iso))).toBe(esperado);
  });

  it('el cambio de mes no arrastra el mes anterior', () => {
    expect(fechaLegible(desdeFechaISO('2026-01-31'))).toBe('sábado 31 de enero');
    expect(fechaLegible(desdeFechaISO('2026-02-01'))).toBe('domingo 1 de febrero');
  });

  it('los doce meses tienen nombre', () => {
    const nombres = Array.from(
      { length: 12 },
      (_, mes) => fechaLegible(new Date(Date.UTC(2026, mes, 15))).split(' de ')[1],
    );

    expect(nombres).toEqual([
      'enero',
      'febrero',
      'marzo',
      'abril',
      'mayo',
      'junio',
      'julio',
      'agosto',
      'septiembre',
      'octubre',
      'noviembre',
      'diciembre',
    ]);
  });

  it('no depende del huso del proceso', () => {
    // Estos dos instantes son el mismo dia UTC a un lado y a otro de la
    // medianoche. Solo leyendolos en UTC salen estas dos respuestas a la vez:
    // un proceso en UTC+1 o mas leeria el primero como jueves 8, y uno en UTC-1
    // o menos leeria el segundo como miercoles 7. Se fija asi, con un par, en
    // vez de tocar process.env.TZ a mitad de la suite: Node cachea la zona y
    // reasignarla dentro de un test es de por si poco fiable.
    expect(fechaLegible(new Date('2026-10-07T23:30:00.000Z'))).toBe('miércoles 7 de octubre');
    expect(fechaLegible(new Date('2026-10-08T00:30:00.000Z'))).toBe('jueves 8 de octubre');
  });
});
