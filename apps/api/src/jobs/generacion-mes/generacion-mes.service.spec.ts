import { planificarMes, type EntradaPlanificacion } from './generacion-mes.service';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

const SALA = { id: 'sala-1', nombre: 'Sala A', cupoBase: 2 };

/** Rutina de los martes a las 18:00, vigente desde siempre. */
const RUTINA_MARTES = {
  id: 'rut-1',
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: d('2020-01-01'),
  hasta: null,
};

const PERFIL_SIN_TOPE = {
  id: 'perf-1',
  vigenciaHasta: null,
  clasesExtra: 0,
  pack: null,
  clasesConsumidas: 0,
};

/** Octubre de 2026 tiene cuatro martes: 6, 13, 20 y 27. */
function entrada(parcial: Partial<EntradaPlanificacion> = {}): EntradaPlanificacion {
  return {
    sala: SALA,
    anio: 2026,
    mes: 10,
    rutinas: [RUTINA_MARTES],
    ausencias: [],
    vacaciones: [],
    turnosExistentes: [],
    reservasActivas: [],
    perfiles: [PERFIL_SIN_TOPE],
    ...parcial,
  };
}

describe('planificarMes — caso sin conflictos', () => {
  it('planifica un turno y una reserva por cada martes del mes', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toEqual([]);
    expect(plan.exclusiones).toEqual([]);
    expect(plan.resumen).toEqual({ turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 });
  });

  it('las fechas planificadas son los martes reales de octubre de 2026', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear.map((t) => t.fecha)).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('el turno hereda el cupo de la sala y el nombre de la rutina', () => {
    const plan = planificarMes(entrada());

    expect(plan.turnosACrear[0]).toEqual({
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-06',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 2,
    });
  });

  it('dos alumnos en la misma franja comparten un solo turno', () => {
    const plan = planificarMes(
      entrada({
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(8);
  });

  it('no planifica nada si el mes no tiene ese dia de semana en la vigencia', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2027-01-01') }] }),
    );

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
  });
});

describe('planificarMes — vigencia de la rutina', () => {
  it('excluye las fechas anteriores a `desde`', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2026-10-14') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-20', '2026-10-27']);
  });

  it('excluye las fechas posteriores a `hasta`', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, hasta: d('2026-10-14') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-13']);
  });

  it('los extremos de la vigencia estan incluidos', () => {
    const plan = planificarMes(
      entrada({ rutinas: [{ ...RUTINA_MARTES, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-13']);
  });
});

describe('planificarMes — cupo lleno', () => {
  it('registra CUPO_LLENO y no planifica la reserva', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toHaveLength(4);
    expect(plan.conflictos[0]).toEqual(
      expect.objectContaining({ tipo: 'CUPO_LLENO', perfilId: 'perf-2', fecha: '2026-10-06' }),
    );
  });

  it('un conflicto de cupo NO interrumpe el resto del mes', () => {
    // El punto 7 del algoritmo del PDF: el objetivo es que el admin revise una
    // lista acotada, no que un alumno bloquee el mes entero.
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
      }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-10-06',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
    ]);
  });

  it('cuenta las reservas que ya ocupan un turno existente', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(3);
    expect(plan.conflictos).toEqual([
      expect.objectContaining({ tipo: 'CUPO_LLENO', fecha: '2026-10-06' }),
    ]);
  });
});

describe('planificarMes — sala sin cupo base', () => {
  it('registra SALA_SIN_CUPO_BASE una sola vez por franja y no planifica nada', () => {
    const plan = planificarMes(entrada({ sala: { ...SALA, cupoBase: null } }));

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
    expect(plan.conflictos).toHaveLength(4);
    expect(plan.conflictos[0]).toEqual(
      expect.objectContaining({ tipo: 'SALA_SIN_CUPO_BASE', perfilId: null }),
    );
  });

  it('no afecta a los turnos que ya existen: esos ya tienen cupo propio', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: null },
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 5,
            reservasActivas: 0,
          },
        ],
      }),
    );

    expect(plan.reservasACrear).toHaveLength(1);
    expect(plan.conflictos).toHaveLength(3);
  });
});

describe('planificarMes — pack', () => {
  it('registra FUERA_DE_PACK cuando la vigencia del perfil ya vencio', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [{ ...PERFIL_SIN_TOPE, vigenciaHasta: d('2026-10-14') }],
      }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-13']);
    expect(plan.conflictos.map((c) => c.fecha)).toEqual(['2026-10-20', '2026-10-27']);
    expect(plan.conflictos[0].tipo).toBe('FUERA_DE_PACK');
  });

  it('registra FUERA_DE_PACK al agotar el tope del pack, contando lo ya consumido', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [
          {
            ...PERFIL_SIN_TOPE,
            pack: { tipo: 'MENSUAL', clasesPorMes: 3, clasesTotales: null },
            clasesConsumidas: 1,
          },
        ],
      }),
    );

    // Tope 3, ya gastada 1 -> caben 2 mas, la cuarta fecha es conflicto.
    expect(plan.reservasACrear).toHaveLength(2);
    expect(plan.conflictos).toHaveLength(2);
    expect(plan.conflictos[0].tipo).toBe('FUERA_DE_PACK');
  });

  it('clasesExtra amplia el tope', () => {
    const plan = planificarMes(
      entrada({
        perfiles: [
          {
            ...PERFIL_SIN_TOPE,
            pack: { tipo: 'MENSUAL', clasesPorMes: 2, clasesTotales: null },
            clasesExtra: 2,
            clasesConsumidas: 0,
          },
        ],
      }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.conflictos).toEqual([]);
  });

  it('un perfil sin pack no tiene tope', () => {
    const plan = planificarMes(entrada());

    expect(plan.conflictos).toEqual([]);
    expect(plan.reservasACrear).toHaveLength(4);
  });

  it('el cupo se comprueba ANTES que el pack, como manda el algoritmo del PDF', () => {
    const plan = planificarMes(
      entrada({
        sala: { ...SALA, cupoBase: 1 },
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
        perfiles: [{ ...PERFIL_SIN_TOPE, vigenciaHasta: d('2026-01-01') }],
      }),
    );

    // El 6 de octubre falla por las dos razones; debe reportarse la del cupo.
    const delSeis = plan.conflictos.find((c) => c.fecha === '2026-10-06');
    expect(delSeis?.tipo).toBe('CUPO_LLENO');
  });
});

describe('planificarMes — ausencias de sala', () => {
  it('una ausencia de todo el salon excluye la fecha', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: null, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-10-06',
      '2026-10-20',
      '2026-10-27',
    ]);
    expect(plan.exclusiones).toEqual([
      expect.objectContaining({ tipo: 'AUSENCIA_SALA', fecha: '2026-10-13' }),
    ]);
  });

  it('una ausencia de OTRA sala no afecta', () => {
    const plan = planificarMes(
      entrada({
        ausencias: [{ salaId: 'sala-9', desde: d('2026-10-13'), hasta: d('2026-10-13') }],
      }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
    expect(plan.exclusiones).toEqual([]);
  });

  it('un rango de varios dias excluye todas las fechas que cubre', () => {
    const plan = planificarMes(
      entrada({
        ausencias: [{ salaId: 'sala-1', desde: d('2026-10-12'), hasta: d('2026-10-21') }],
      }),
    );

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual(['2026-10-06', '2026-10-27']);
    expect(plan.exclusiones).toHaveLength(2);
  });

  it('una ausencia no crea el turno: si nadie puede venir, no hay clase', () => {
    const plan = planificarMes(
      entrada({ ausencias: [{ salaId: null, desde: d('2026-10-13'), hasta: d('2026-10-13') }] }),
    );

    expect(plan.turnosACrear.map((t) => t.fecha)).not.toContain('2026-10-13');
  });
});

describe('planificarMes — vacaciones del alumno', () => {
  it('excluyen solo a ese alumno, no el turno para el resto', () => {
    // Punto 6 del checklist, literal.
    const plan = planificarMes(
      entrada({
        rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-2', perfilId: 'perf-2' }],
        perfiles: [PERFIL_SIN_TOPE, { ...PERFIL_SIN_TOPE, id: 'perf-2' }],
        vacaciones: [{ perfilId: 'perf-1', desde: d('2026-10-13'), hasta: d('2026-10-13') }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(4);
    expect(plan.reservasACrear).toHaveLength(7);
    expect(plan.exclusiones).toEqual([
      expect.objectContaining({ tipo: 'VACACION_ALUMNO', perfilId: 'perf-1', fecha: '2026-10-13' }),
    ]);
  });

  it('las vacaciones NO son un conflicto: no requieren decision humana', () => {
    const plan = planificarMes(
      entrada({
        vacaciones: [{ perfilId: 'perf-1', desde: d('2026-10-01'), hasta: d('2026-10-31') }],
      }),
    );

    expect(plan.conflictos).toEqual([]);
    expect(plan.exclusiones).toHaveLength(4);
  });
});

describe('planificarMes — idempotencia', () => {
  it('no planifica nada que ya exista', () => {
    // Punto 4 del checklist: correr la generacion dos veces no duplica.
    const turnos = ['2026-10-06', '2026-10-13', '2026-10-20', '2026-10-27'].map((fecha, i) => ({
      id: `turno-${i}`,
      fecha: d(fecha),
      horaInicio: '18:00',
      cupo: 2,
      reservasActivas: 1,
    }));

    const plan = planificarMes(
      entrada({
        turnosExistentes: turnos,
        reservasActivas: turnos.map((t) => ({ turnoId: t.id, perfilId: 'perf-1' })),
      }),
    );

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
    expect(plan.conflictos).toEqual([]);
  });

  it('una reserva ya existente no cuenta como conflicto de cupo', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 1,
            reservasActivas: 1,
          },
        ],
        reservasActivas: [{ turnoId: 'turno-1', perfilId: 'perf-1' }],
      }),
    );

    // El turno esta lleno, pero lo llena el propio alumno: no hay nada que hacer
    // ni nada que reportar.
    expect(plan.conflictos).toEqual([]);
  });

  it('planifica solo lo que falta cuando el mes esta a medias', () => {
    const plan = planificarMes(
      entrada({
        turnosExistentes: [
          {
            id: 'turno-1',
            fecha: d('2026-10-06'),
            horaInicio: '18:00',
            cupo: 2,
            reservasActivas: 1,
          },
        ],
        reservasActivas: [{ turnoId: 'turno-1', perfilId: 'perf-1' }],
      }),
    );

    expect(plan.turnosACrear).toHaveLength(3);
    expect(plan.reservasACrear).toHaveLength(3);
  });

  it('dos rutinas identicas del mismo alumno no producen dos reservas', () => {
    const plan = planificarMes(
      entrada({ rutinas: [RUTINA_MARTES, { ...RUTINA_MARTES, id: 'rut-duplicada' }] }),
    );

    expect(plan.reservasACrear).toHaveLength(4);
  });
});

describe('planificarMes — bordes de calendario', () => {
  it('acierta en un mes de 30 dias', () => {
    // Noviembre de 2026: martes 3, 10, 17 y 24.
    const plan = planificarMes(entrada({ mes: 11 }));

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2026-11-03',
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
  });

  it('acierta en febrero de un anio bisiesto', () => {
    // Febrero de 2028: martes 1, 8, 15, 22 y 29.
    const plan = planificarMes(entrada({ anio: 2028, mes: 2 }));

    expect(plan.reservasACrear.map((r) => r.fecha)).toEqual([
      '2028-02-01',
      '2028-02-08',
      '2028-02-15',
      '2028-02-22',
      '2028-02-29',
    ]);
  });

  it('diciembre no se desborda al anio siguiente', () => {
    const plan = planificarMes(entrada({ mes: 12 }));

    expect(plan.reservasACrear.every((r) => r.fecha.startsWith('2026-12'))).toBe(true);
  });

  it('el resultado es determinista: ordenado por fecha, hora y perfil', () => {
    const plan = planificarMes(
      entrada({
        rutinas: [
          { ...RUTINA_MARTES, id: 'rut-b', perfilId: 'perf-b' },
          { ...RUTINA_MARTES, id: 'rut-a', perfilId: 'perf-a' },
        ],
        perfiles: [
          { ...PERFIL_SIN_TOPE, id: 'perf-b' },
          { ...PERFIL_SIN_TOPE, id: 'perf-a' },
        ],
      }),
    );

    // Importa porque, con el cupo justo, quien entra y quien queda en conflicto
    // no puede depender del orden en que la base devolvio las filas.
    expect(plan.reservasACrear.slice(0, 2).map((r) => r.perfilId)).toEqual(['perf-a', 'perf-b']);
  });
});

describe('planificarMes — rutinas de otras salas', () => {
  it('ignora las rutinas que no son de la sala que se esta planificando', () => {
    const plan = planificarMes(entrada({ rutinas: [{ ...RUTINA_MARTES, salaId: 'sala-9' }] }));

    expect(plan.turnosACrear).toEqual([]);
    expect(plan.reservasACrear).toEqual([]);
  });
});
