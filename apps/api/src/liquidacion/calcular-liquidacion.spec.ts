import { calcularLiquidacion, type EntradaLiquidacion } from './calcular-liquidacion';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

// Septiembre de 2026: los lunes caen 7, 14, 21 y 28.
function entrada(parcial: Partial<EntradaLiquidacion> = {}): EntradaLiquidacion {
  return {
    profesorId: 'fati',
    profesorNombre: 'Fati Gomez',
    anio: 2026,
    mes: 9,
    horarios: [
      {
        salaId: 'sala-a',
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: dia('2026-09-01'),
        hasta: null,
        tarifaPorHora: '1500.00',
      },
    ],
    turnos: [],
    ausencias: [],
    tarifaDelTenant: '1200.00',
    ...parcial,
  };
}

const HORARIO_BASE = entrada().horarios[0]!;

const turno = (id: string, fecha: string, horaInicio = '18:00', horaFin = '19:00') => ({
  id,
  salaId: 'sala-a',
  fecha: dia(fecha),
  horaInicio,
  horaFin,
});

describe('calcularLiquidacion', () => {
  it('cuatro lunes contratados y ninguno dictado', () => {
    const r = calcularLiquidacion(entrada());

    expect(r.minutosContratados).toBe(240);
    expect(r.minutosDictados).toBe(0);
    expect(r.horasContratadas).toBe('4.00');
    expect(r.franjas).toHaveLength(4);
    expect(r.franjas.every((f) => f.contratada && !f.dictada)).toBe(true);
  });

  it('un turno dentro de la franja la marca dictada', () => {
    const r = calcularLiquidacion(entrada({ turnos: [turno('t1', '2026-09-07')] }));

    expect(r.minutosDictados).toBe(60);
    expect(r.franjas[0]).toMatchObject({ fecha: '2026-09-07', dictada: true, turnoId: 't1' });
  });

  it('un turno que empieza a las 18:30 tambien cuenta como dictada', () => {
    // Misma regla de contencion que el etiquetado: si las dos no dijeran lo
    // mismo, un turno podria estar etiquetado y no aparecer como dictado.
    const r = calcularLiquidacion(
      entrada({ turnos: [turno('t1', '2026-09-07', '18:30', '19:30')] }),
    );

    expect(r.franjas[0]!.dictada).toBe(true);
  });

  it('un feriado no suma a contratadas y se informa aparte', () => {
    const r = calcularLiquidacion(
      entrada({
        ausencias: [
          {
            salaId: 'sala-a',
            desde: dia('2026-09-21'),
            hasta: dia('2026-09-21'),
            motivo: 'Feriado',
          },
        ],
      }),
    );

    expect(r.minutosContratados).toBe(180);
    expect(r.minutosCerrados).toBe(60);
    const cerrada = r.franjas.find((f) => f.cerrada);
    expect(cerrada).toMatchObject({ fecha: '2026-09-21', motivoCierre: 'Feriado', dictada: false });
  });

  it('un cierre del salon entero tambien tapa la franja', () => {
    const r = calcularLiquidacion(
      entrada({
        ausencias: [
          { salaId: null, desde: dia('2026-09-21'), hasta: dia('2026-09-21'), motivo: null },
        ],
      }),
    );

    expect(r.minutosCerrados).toBe(60);
  });

  it('si hubo clase pese al cierre, no esta cerrada: se dio', () => {
    const r = calcularLiquidacion(
      entrada({
        turnos: [turno('t1', '2026-09-21')],
        ausencias: [
          {
            salaId: 'sala-a',
            desde: dia('2026-09-21'),
            hasta: dia('2026-09-21'),
            motivo: 'Feriado',
          },
        ],
      }),
    );

    const franja = r.franjas.find((f) => f.fecha === '2026-09-21')!;
    expect(franja.cerrada).toBe(false);
    expect(franja.dictada).toBe(true);
  });

  it('una suplencia sin contrato aparece como dictada y no contratada', () => {
    const r = calcularLiquidacion(
      entrada({ turnos: [turno('t-sup', '2026-09-09', '10:00', '11:00')] }),
    );

    const suplencia = r.franjas.find((f) => f.turnoId === 't-sup')!;
    expect(suplencia).toMatchObject({ contratada: false, dictada: true, minutos: 60 });
    // La profesora fue: cuenta como dictada aunque no tuviera contrato ahi.
    expect(r.minutosDictados).toBe(60);
    expect(r.minutosContratados).toBe(240);
  });

  it('la tarifa del horario gana a la del gimnasio', () => {
    const r = calcularLiquidacion(entrada());

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: '1500.00', origenTarifa: 'HORARIO' });
  });

  it('sin tarifa en el horario, cae a la del gimnasio', () => {
    const r = calcularLiquidacion(
      entrada({ horarios: [{ ...HORARIO_BASE, tarifaPorHora: null }] }),
    );

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: '1200.00', origenTarifa: 'TENANT' });
  });

  it('sin ninguna tarifa definida, null no es un error', () => {
    // Un gimnasio puede llevar los horarios sin haber cargado tarifas.
    const r = calcularLiquidacion(
      entrada({
        horarios: [{ ...HORARIO_BASE, tarifaPorHora: null }],
        tarifaDelTenant: null,
      }),
    );

    expect(r.franjas[0]).toMatchObject({ tarifaPorHora: null, origenTarifa: null });
  });

  it('el contrato que empieza a mitad de mes solo cuenta desde ahi', () => {
    const r = calcularLiquidacion(
      entrada({ horarios: [{ ...HORARIO_BASE, desde: dia('2026-09-15') }] }),
    );

    // Quedan el 21 y el 28.
    expect(r.franjas).toHaveLength(2);
    expect(r.minutosContratados).toBe(120);
  });

  it('un mes sin horarios ni turnos da todo a cero', () => {
    const r = calcularLiquidacion(entrada({ horarios: [] }));

    expect(r).toMatchObject({
      minutosContratados: 0,
      minutosDictados: 0,
      minutosCerrados: 0,
      horasContratadas: '0.00',
      franjas: [],
    });
  });

  it('las franjas salen ordenadas por fecha', () => {
    const r = calcularLiquidacion(
      entrada({ turnos: [turno('t-sup', '2026-09-02', '10:00', '11:00')] }),
    );

    const fechas = r.franjas.map((f) => f.fecha);
    expect(fechas).toEqual([...fechas].sort());
  });

  it('media hora por franja se informa con dos decimales', () => {
    const r = calcularLiquidacion(entrada({ horarios: [{ ...HORARIO_BASE, horaFin: '18:30' }] }));

    expect(r.minutosContratados).toBe(120);
    expect(r.horasContratadas).toBe('2.00');
    expect(r.franjas[0]!.minutos).toBe(30);
  });

  it('un mismo turno no se reparte entre dos franjas contratadas', () => {
    // Dos horarios en salas distintas a la misma hora no deberian existir (los
    // rechaza el alta), pero si el dato llegara asi, el turno no puede contarse
    // dos veces como dictado.
    const r = calcularLiquidacion(
      entrada({
        horarios: [HORARIO_BASE, { ...HORARIO_BASE, salaId: 'sala-b' }],
        turnos: [turno('t1', '2026-09-07')],
      }),
    );

    expect(r.franjas.filter((f) => f.dictada)).toHaveLength(1);
    expect(r.minutosDictados).toBe(60);
  });
});
