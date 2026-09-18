import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { MiCalendarioService } from './mi-calendario.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ReservasService } from '../reservas/reservas.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const SALA = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  minMinutosCancelar: 120,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
};

const TURNO = {
  id: 'turno-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: new Date('2099-10-02T00:00:00.000Z'),
  horaInicio: '10:00',
  horaFin: '11:00',
  cupo: 5,
  sala: SALA,
};

const RESERVA = {
  id: 'reserva-1',
  turnoId: 'turno-1',
  perfilId: 'perfil-1',
  origen: 'ALUMNO' as const,
  canceladaEn: null,
  turno: TURNO,
};

function crearServicio() {
  const db = {
    perfil: { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) },
    reserva: { findMany: jest.fn().mockResolvedValue([RESERVA]), findFirst: jest.fn() },
    turno: { findMany: jest.fn().mockResolvedValue([TURNO]) },
    usuarioSala: { findMany: jest.fn().mockResolvedValue([{ salaId: 'sala-1' }]) },
  };
  const disponibilidad = {
    configuracionDeSala: jest.fn().mockResolvedValue({
      minMinutosCancelar: 120,
      minMinutosAnotarse: 0,
      listaEsperaHabilitada: false,
    }),
    paraTurno: jest.fn().mockResolvedValue({
      turnoId: 'turno-1',
      estado: 'LIBRE',
      cupo: 5,
      ocupados: 1,
      puedeReservar: true,
      motivo: null,
      enListaEspera: false,
      posicionEnLista: null,
    }),
  };
  const reservas = {
    crear: jest.fn().mockResolvedValue({ id: 'reserva-nueva', advertencias: [] }),
    cancelar: jest.fn().mockResolvedValue({ id: 'reserva-1' }),
  };

  return {
    servicio: new MiCalendarioService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      reservas as unknown as ReservasService,
    ),
    db,
    disponibilidad,
    reservas,
  };
}

describe('MiCalendarioService.misClases', () => {
  it('devuelve las reservas activas del alumno con los datos del turno', async () => {
    const { servicio } = crearServicio();

    const clases = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-01T00:00:00.000Z'),
    });

    expect(clases).toHaveLength(1);
    expect(clases[0]).toMatchObject({
      reservaId: 'reserva-1',
      turnoId: 'turno-1',
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2099-10-02',
      horaInicio: '10:00',
      horaFin: '11:00',
      origen: 'ALUMNO',
    });
  });

  it('pide solo las reservas NO canceladas del propio perfil', async () => {
    const { servicio, db } = crearServicio();

    await servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    expect(db.reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ perfilId: 'perfil-1', canceladaEn: null }),
      }),
    );
  });

  it('NO exige que el mes este publicado: son clases que el alumno ya tiene', async () => {
    const { servicio, db } = crearServicio();

    await servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    // Si el admin despublicara un mes, hacer desaparecer de la pantalla del
    // alumno una clase que tiene reservada seria peor que mostrarla.
    const where = db.reserva.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('HABILITADO');
  });

  it('calcula puedeCancelar con la ventana de la sala', async () => {
    const { servicio } = crearServicio();

    // El turno empieza el 2 a las 10:00 y la ventana pide 120 minutos.
    const dentro = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-02T07:00:00.000Z'),
    });
    expect(dentro[0].puedeCancelar).toBe(true);

    const fuera = await servicio.misClases(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      ahora: new Date('2099-10-02T09:00:00.000Z'),
    });
    expect(fuera[0].puedeCancelar).toBe(false);
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.misClases(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MiCalendarioService.turnosDisponibles', () => {
  it('solo mira las salas a las que el alumno tiene acceso', async () => {
    const { servicio, db } = crearServicio();

    await servicio.turnosDisponibles(ALUMNO, { desde: '2099-10-01', hasta: '2099-10-31' });

    expect(db.turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ salaId: { in: ['sala-1'] } }),
      }),
    );
  });

  it('con el alumno sin ninguna sala devuelve la lista vacia sin consultar turnos', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([]);

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
    });

    expect(turnos).toEqual([]);
    // Un `in: []` funcionaria, pero pedir a la base que busque en un conjunto
    // vacio es trabajo tirado.
    expect(db.turno.findMany).not.toHaveBeenCalled();
  });

  it('acota a una sala cuando se pide, siempre dentro de las accesibles', async () => {
    const { servicio, db } = crearServicio();
    db.usuarioSala.findMany.mockResolvedValue([{ salaId: 'sala-1' }, { salaId: 'sala-2' }]);

    await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      salaId: 'sala-2',
    });

    expect(db.turno.findMany.mock.calls[0][0].where.salaId).toEqual({ in: ['sala-2'] });
  });

  it('pedir una sala a la que no tiene acceso devuelve vacio, no un 403', async () => {
    const { servicio, db } = crearServicio();

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
      salaId: 'sala-ajena',
    });

    // Vacio y no 403: contestar "no tienes acceso" confirmaria que esa sala
    // existe. Para descubrir un calendario, el silencio es la respuesta.
    expect(turnos).toEqual([]);
    expect(db.turno.findMany).not.toHaveBeenCalled();
  });

  it('adjunta la disponibilidad de cada turno', async () => {
    const { servicio } = crearServicio();

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
    });

    expect(turnos[0]).toMatchObject({
      turnoId: 'turno-1',
      fecha: '2099-10-02',
      disponibilidad: expect.objectContaining({ estado: 'LIBRE', puedeReservar: true }),
    });
  });

  it.each(['MES_NO_PUBLICADO', 'SALA_NO_VISIBLE', 'SIN_ACCESO_A_SALA'])(
    'omite del listado los turnos con motivo %s',
    async (motivo) => {
      const { servicio, disponibilidad } = crearServicio();
      disponibilidad.paraTurno.mockResolvedValue({
        turnoId: 'turno-1',
        estado: 'LIBRE',
        cupo: 5,
        ocupados: 1,
        puedeReservar: false,
        motivo,
        enListaEspera: false,
        posicionEnLista: null,
      });

      const turnos = await servicio.turnosDisponibles(ALUMNO, {
        desde: '2099-10-01',
        hasta: '2099-10-31',
      });

      // Un mes sin publicar o una sala oculta no deben aparecer en el
      // calendario del alumno ni siquiera en gris.
      expect(turnos).toEqual([]);
    },
  );

  it('SI lista un turno lleno: el alumno tiene que poder verlo para hacer cola', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      turnoId: 'turno-1',
      estado: 'LISTA_ESPERA',
      cupo: 5,
      ocupados: 5,
      puedeReservar: false,
      motivo: null,
      enListaEspera: false,
      posicionEnLista: null,
    });

    const turnos = await servicio.turnosDisponibles(ALUMNO, {
      desde: '2099-10-01',
      hasta: '2099-10-31',
    });

    expect(turnos).toHaveLength(1);
    expect(turnos[0].disponibilidad.estado).toBe('LISTA_ESPERA');
  });
});
