import { resolverProfesorDeFranja, type HorarioParaResolver } from './resolver-profesor';

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

// 2026-09-07 es lunes; 2026-09-08, martes.
const LUNES = dia('2026-09-07');
const MARTES = dia('2026-09-08');

function horario(parcial: Partial<HorarioParaResolver> = {}): HorarioParaResolver {
  return {
    id: 'h1',
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: dia('2026-09-01'),
    hasta: null,
    ...parcial,
  };
}

describe('resolverProfesorDeFranja', () => {
  it('devuelve la profesora cuando coinciden sala, dia y hora', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('el turno que EMPIEZA DENTRO de la franja tambien es suyo', () => {
    // Contratada de 18:00 a 19:00; la rutina del alumno empieza a las 18:30.
    // Comparar horaInicio por igualdad exacta dejaria este caso fuera, y es el
    // caso corriente en un gimnasio con clases escalonadas.
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '18:30')).toBe('fati');
  });

  it('el final de la franja NO le pertenece', () => {
    // Termina a las 19:00: el turno de las 19:00 es de la clase siguiente.
    expect(resolverProfesorDeFranja([horario()], 'sala-a', LUNES, '19:00')).toBeNull();
  });

  it('otro dia de la semana no es suyo', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-a', MARTES, '18:00')).toBeNull();
  });

  it('otra sala no es suya', () => {
    expect(resolverProfesorDeFranja([horario()], 'sala-b', LUNES, '18:00')).toBeNull();
  });

  it('antes de que empiece su contrato, no es suya', () => {
    const h = horario({ desde: dia('2026-09-08') });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('el primer dia del contrato SI es suyo', () => {
    const h = horario({ desde: LUNES });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('el ultimo dia del contrato SI es suyo', () => {
    const h = horario({ hasta: LUNES });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBe('fati');
  });

  it('despues de que termine su contrato, no es suya', () => {
    const h = horario({ hasta: dia('2026-09-06') });
    expect(resolverProfesorDeFranja([h], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('sin horarios no hay profesora', () => {
    expect(resolverProfesorDeFranja([], 'sala-a', LUNES, '18:00')).toBeNull();
  });

  it('con dos coincidencias elige siempre la misma, no la que llegue primero', () => {
    // D5 impide que esto ocurra al dar de alta, pero pueden existir datos
    // anteriores a esta fase o cargados a mano. Lo que NO puede pasar es que la
    // respuesta dependa del orden en que Postgres devolvio las filas: el mismo
    // mes republicado daria profesoras distintas.
    const a = horario({ id: 'h-b', profesorId: 'ana' });
    const b = horario({ id: 'h-a', profesorId: 'fati' });

    expect(resolverProfesorDeFranja([a, b], 'sala-a', LUNES, '18:00')).toBe('fati');
    expect(resolverProfesorDeFranja([b, a], 'sala-a', LUNES, '18:00')).toBe('fati');
  });
});
