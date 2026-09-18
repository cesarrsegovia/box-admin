import {
  calcularDisponibilidad,
  puedeCancelar,
  type EntradaDisponibilidad,
} from './disponibilidad';

const AHORA = new Date('2099-10-01T10:00:00.000Z');
/** El turno empieza 24 h despues de AHORA. */
const FECHA_TURNO = new Date('2099-10-02T00:00:00.000Z');

function entrada(cambios: Partial<EntradaDisponibilidad> = {}): EntradaDisponibilidad {
  return {
    turno: {
      id: 'turno-1',
      salaId: 'sala-1',
      fecha: FECHA_TURNO,
      horaInicio: '10:00',
      cupo: 5,
    },
    sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: false },
    config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: false },
    ocupados: 0,
    huboCancelaciones: false,
    mesPublicado: true,
    tieneAccesoASala: true,
    yaReservado: false,
    enListaEspera: false,
    posicionEnLista: null,
    ahora: AHORA,
    ...cambios,
  };
}

describe('calcularDisponibilidad — estado del turno', () => {
  it('con cupo libre el turno esta LIBRE', () => {
    const d = calcularDisponibilidad(entrada({ ocupados: 3 }));

    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
    expect(d).toMatchObject({ turnoId: 'turno-1', cupo: 5, ocupados: 3 });
  });

  it('sin cupo y sin lista de espera el turno esta LLENO', () => {
    const d = calcularDisponibilidad(entrada({ ocupados: 5 }));

    expect(d.estado).toBe('LLENO');
    expect(d.puedeReservar).toBe(false);
    // El estado ya dice todo lo que hay que decir.
    expect(d.motivo).toBeNull();
  });

  it('sin cupo y con lista de espera habilitada el turno esta en LISTA_ESPERA', () => {
    const d = calcularDisponibilidad(
      entrada({
        ocupados: 5,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: true },
      }),
    );

    expect(d.estado).toBe('LISTA_ESPERA');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBeNull();
  });

  it('mas ocupados que cupo sigue siendo LLENO, no negativo', () => {
    // Puede pasar si un admin baja el cupo de un turno que ya tenia reservas.
    const d = calcularDisponibilidad(
      entrada({ ocupados: 8, turno: { ...entrada().turno, cupo: 5 } }),
    );

    expect(d.estado).toBe('LLENO');
    expect(d.ocupados).toBe(8);
  });
});

describe('calcularDisponibilidad — solo cupos liberados', () => {
  const SOLO_LIBERADOS = { activa: true, visibleAlumnos: true, soloCuposLiberados: true };

  it('con cupo original y sin cancelaciones el turno es SOLO_ADMIN', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 2, huboCancelaciones: false }),
    );

    expect(d.estado).toBe('SOLO_ADMIN');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('SOLO_CUPOS_LIBERADOS');
  });

  it('en cuanto alguien cancela, el turno pasa a LIBRE', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 2, huboCancelaciones: true }),
    );

    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
  });

  it('sin cupo sigue mandando el cupo, no el flag', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: SOLO_LIBERADOS, ocupados: 5, huboCancelaciones: false }),
    );

    expect(d.estado).toBe('LLENO');
  });
});

describe('calcularDisponibilidad — ventana de anotacion', () => {
  it('dentro de la ventana puede reservar', () => {
    // Faltan 24 h y la ventana pide 120 minutos.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 120, listaEsperaHabilitada: false },
      }),
    );

    expect(d.puedeReservar).toBe(true);
    expect(d.motivo).toBeNull();
  });

  it('fuera de la ventana el turno sigue LIBRE pero el alumno no puede', () => {
    // Faltan 24 h = 1440 minutos, y la ventana pide 2000.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 2000, listaEsperaHabilitada: false },
      }),
    );

    // El turno tiene cupo: el estado no miente por culpa de QUIEN pregunta.
    expect(d.estado).toBe('LIBRE');
    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('VENTANA_CERRADA');
  });

  it('justo en el limite de la ventana todavia puede', () => {
    // El turno empieza a las 10:00 del dia 2; AHORA son las 10:00 del dia 1.
    // Faltan exactamente 1440 minutos.
    const d = calcularDisponibilidad(
      entrada({
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 1440, listaEsperaHabilitada: false },
      }),
    );

    expect(d.puedeReservar).toBe(true);
  });

  it('un turno que ya empezo tiene la ventana cerrada aunque no haya ventana configurada', () => {
    const d = calcularDisponibilidad(entrada({ ahora: new Date('2099-10-02T11:00:00.000Z') }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('VENTANA_CERRADA');
  });
});

describe('calcularDisponibilidad — bloqueos del alumno', () => {
  it('sin acceso a la sala', () => {
    const d = calcularDisponibilidad(entrada({ tieneAccesoASala: false }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('sala dada de baja', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: { activa: false, visibleAlumnos: true, soloCuposLiberados: false } }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('sala oculta a los alumnos', () => {
    const d = calcularDisponibilidad(
      entrada({ sala: { activa: true, visibleAlumnos: false, soloCuposLiberados: false } }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('mes sin publicar', () => {
    const d = calcularDisponibilidad(entrada({ mesPublicado: false }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('ya tiene reserva activa en ese turno', () => {
    const d = calcularDisponibilidad(entrada({ yaReservado: true }));

    expect(d.puedeReservar).toBe(false);
    expect(d.motivo).toBe('YA_RESERVADO');
  });
});

describe('calcularDisponibilidad — precedencia de los motivos', () => {
  // Un alumno al que le faltan cuatro cosas tiene que oir la mas general
  // primero: decirle "la ventana cerro" cuando ni siquiera tiene la sala
  // asignada lo manda a resolver el problema equivocado.
  it('sin acceso a la sala gana a todo lo demas', () => {
    const d = calcularDisponibilidad(
      entrada({
        tieneAccesoASala: false,
        sala: { activa: false, visibleAlumnos: false, soloCuposLiberados: true },
        mesPublicado: false,
        yaReservado: true,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('SIN_ACCESO_A_SALA');
  });

  it('la sala invisible gana al mes sin publicar', () => {
    const d = calcularDisponibilidad(
      entrada({
        sala: { activa: true, visibleAlumnos: false, soloCuposLiberados: false },
        mesPublicado: false,
      }),
    );

    expect(d.motivo).toBe('SALA_NO_VISIBLE');
  });

  it('el mes sin publicar gana a ya reservado', () => {
    const d = calcularDisponibilidad(entrada({ mesPublicado: false, yaReservado: true }));

    expect(d.motivo).toBe('MES_NO_PUBLICADO');
  });

  it('ya reservado gana a la ventana cerrada', () => {
    const d = calcularDisponibilidad(
      entrada({
        yaReservado: true,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('YA_RESERVADO');
  });

  it('la ventana cerrada gana a solo cupos liberados', () => {
    const d = calcularDisponibilidad(
      entrada({
        sala: { activa: true, visibleAlumnos: true, soloCuposLiberados: true },
        huboCancelaciones: false,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 9999, listaEsperaHabilitada: false },
      }),
    );

    expect(d.motivo).toBe('VENTANA_CERRADA');
  });
});

describe('calcularDisponibilidad — lista de espera del alumno', () => {
  it('refleja que el alumno esta anotado y en que puesto', () => {
    const d = calcularDisponibilidad(
      entrada({
        ocupados: 5,
        enListaEspera: true,
        posicionEnLista: 2,
        config: { minMinutosCancelar: 0, minMinutosAnotarse: 0, listaEsperaHabilitada: true },
      }),
    );

    expect(d).toMatchObject({ estado: 'LISTA_ESPERA', enListaEspera: true, posicionEnLista: 2 });
  });

  it('sin anotarse, la posicion es null', () => {
    const d = calcularDisponibilidad(entrada());

    expect(d.enListaEspera).toBe(false);
    expect(d.posicionEnLista).toBeNull();
  });
});

describe('puedeCancelar', () => {
  const SIN_VENTANA = {
    minMinutosCancelar: 0,
    minMinutosAnotarse: 0,
    listaEsperaHabilitada: false,
  };
  const DOS_HORAS = { ...SIN_VENTANA, minMinutosCancelar: 120 };

  it('sin ventana se puede cancelar hasta el comienzo', () => {
    expect(puedeCancelar(FECHA_TURNO, '10:00', SIN_VENTANA, AHORA)).toBe(true);
  });

  it('sin ventana no se puede cancelar una clase que ya empezo', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', SIN_VENTANA, new Date('2099-10-02T10:00:01.000Z')),
    ).toBe(false);
  });

  it('con dos horas de ventana, a tres horas del turno se puede', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T07:00:00.000Z')),
    ).toBe(true);
  });

  it('con dos horas de ventana, a una hora del turno ya no', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T09:00:00.000Z')),
    ).toBe(false);
  });

  it('justo en el limite todavia se puede', () => {
    expect(
      puedeCancelar(FECHA_TURNO, '10:00', DOS_HORAS, new Date('2099-10-02T08:00:00.000Z')),
    ).toBe(true);
  });
});
