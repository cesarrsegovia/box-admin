import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { TurnosService } from './turnos.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { HorariosProfesorService } from '../horarios-profesor/horarios-profesor.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'turno-1',
  tenantId: 'gym-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: new Date('2026-10-05T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 10,
  profesorId: null,
  profesor: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  _count: { reservas: 3 },
};

function crearServicio() {
  const turno = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
    delete: jest.fn().mockResolvedValue(FILA),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };
  const reserva = { count: jest.fn().mockResolvedValue(3) };

  const db = {
    turno,
    sala,
    reserva,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  // Doble del servicio de horarios. Solo se le piden dos cosas: validar que la
  // profesora existe y tiene acceso a la sala, y resolver el patron.
  const horarios = {
    exigirProfesoraConAccesoALaSala: jest.fn().mockResolvedValue(undefined),
    resolverParaFranja: jest.fn().mockResolvedValue(null),
  };

  return {
    servicio: new TurnosService(
      prisma,
      historial as unknown as HistorialService,
      horarios as unknown as HorariosProfesorService,
    ),
    turno,
    sala,
    reserva,
    historial,
    horarios,
  };
}

describe('TurnosService.crear', () => {
  it('guarda la fecha como medianoche UTC del dia indicado', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.crear(ADMIN, {
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 10,
    });

    const guardada: Date = turno.create.mock.calls[0][0].data.fecha;
    expect(guardada.toISOString()).toBe('2026-10-05T00:00:00.000Z');
  });

  it('devuelve la fecha como YYYY-MM-DD, sin hora ni huso', async () => {
    const { servicio } = crearServicio();

    const creado = await servicio.crear(ADMIN, {
      salaId: 'sala-1',
      nombre: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 10,
    });

    expect(creado.fecha).toBe('2026-10-05');
  });

  it('400 si horaFin no es posterior a horaInicio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '19:00',
        horaFin: '18:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si las horas son iguales: un turno de duracion cero no existe', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '18:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-de-otro-gym',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la sala esta dada de baja', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-1', activa: false });

    await expect(
      servicio.crear(ADMIN, {
        salaId: 'sala-1',
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TurnosService.listar', () => {
  it('calcula lugares libres restando solo las reservas no canceladas', async () => {
    const { servicio } = crearServicio();

    const [turno] = await servicio.listar(ADMIN, {});

    expect(turno.cupo).toBe(10);
    expect(turno.reservasActivas).toBe(3);
    expect(turno.lugaresLibres).toBe(7);
  });

  it('cuenta solo reservas con canceladaEn null', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.listar(ADMIN, {});

    // Se comprueba el recuento y NO el include entero: desde la Fase 4 ahi va
    // tambien la profesora, y fijar la forma completa haria que este test
    // fallara cada vez que alguien anade un campo, sin tener nada que ver con
    // lo que el test dice que prueba.
    expect(turno.findMany.mock.calls[0]![0].include._count).toEqual({
      select: { reservas: { where: { canceladaEn: null } } },
    });
  });

  it('filtra por rango de fechas', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.listar(ADMIN, { desde: '2026-10-01', hasta: '2026-10-31' });

    expect(turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          fecha: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-31T00:00:00.000Z'),
          },
        }),
      }),
    );
  });

  it('soloLibres descarta los turnos completos', async () => {
    const { servicio, turno } = crearServicio();
    turno.findMany.mockResolvedValue([
      FILA,
      { ...FILA, id: 'turno-2', cupo: 3, _count: { reservas: 3 } },
    ]);

    const libres = await servicio.listar(ADMIN, { soloLibres: true });

    expect(libres.map((t) => t.id)).toEqual(['turno-1']);
  });
});

describe('TurnosService.actualizar', () => {
  it('409 si el cupo nuevo es menor que las reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(8);

    await expect(servicio.actualizar(ADMIN, 'turno-1', { cupo: 5 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(turno.update).not.toHaveBeenCalled();
  });

  it('permite bajar el cupo justo hasta las reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(5);

    await servicio.actualizar(ADMIN, 'turno-1', { cupo: 5 });

    expect(turno.update).toHaveBeenCalled();
  });
});

describe('TurnosService.eliminar', () => {
  it('409 si el turno tiene reservas activas', async () => {
    const { servicio, reserva, turno } = crearServicio();
    reserva.count.mockResolvedValue(1);

    await expect(servicio.eliminar(ADMIN, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
    expect(turno.delete).not.toHaveBeenCalled();
  });

  it('borra fisicamente si no queda ninguna reserva activa', async () => {
    const { servicio, reserva, turno, historial } = crearServicio();
    reserva.count.mockResolvedValue(0);

    await servicio.eliminar(ADMIN, 'turno-1');

    expect(turno.delete).toHaveBeenCalledWith({ where: { id: 'turno-1' } });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Turno', accion: 'ELIMINADA' }),
      expect.anything(),
    );
  });
});

describe('TurnosService.asignarProfesor', () => {
  it('asigna la profesora al turno', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.asignarProfesor(ADMIN, 'turno-1', { profesorId: 'fati' });

    expect(turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { profesorId: 'fati' } }),
    );
  });

  it('quitar la profesora es un null explicito, no una omision', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.asignarProfesor(ADMIN, 'turno-1', { profesorId: null });

    expect(turno.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { profesorId: null } }),
    );
  });

  it('con profesorId null NO se consulta el acceso a la sala', async () => {
    const { servicio, horarios } = crearServicio();

    await servicio.asignarProfesor(ADMIN, 'turno-1', { profesorId: null });

    expect(horarios.exigirProfesoraConAccesoALaSala).not.toHaveBeenCalled();
  });

  it('rechaza una profesora sin acceso a la sala del turno', async () => {
    const { servicio, turno, horarios } = crearServicio();
    horarios.exigirProfesoraConAccesoALaSala.mockRejectedValue(
      new BadRequestException('Fati no tiene acceso a la sala Sala A'),
    );

    await expect(servicio.asignarProfesor(ADMIN, 'turno-1', { profesorId: 'fati' })).rejects.toThrow(
      /acceso a la sala/i,
    );
    expect(turno.update).not.toHaveBeenCalled();
  });

  it('404 si el turno no existe', async () => {
    const { servicio, turno } = crearServicio();
    turno.findFirst.mockResolvedValue(null);

    await expect(
      servicio.asignarProfesor(ADMIN, 'fantasma', { profesorId: 'fati' }),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('TurnosService.listar con profesora', () => {
  it('devuelve la profesora con su nombre resuelto', async () => {
    const { servicio, turno } = crearServicio();
    turno.findMany.mockResolvedValue([
      { ...FILA, profesorId: 'fati', profesor: { usuario: { nombreCompleto: 'Fati Gomez' } } },
    ]);

    const [publico] = await servicio.listar(ADMIN, {});

    // Un id suelto no le sirve a nadie que este mirando un calendario.
    expect(publico!.profesor).toEqual({ id: 'fati', nombreCompleto: 'Fati Gomez' });
  });

  it('un turno sin profesora la devuelve como null, no como undefined', async () => {
    const { servicio } = crearServicio();

    const [publico] = await servicio.listar(ADMIN, {});

    expect(publico!.profesor).toBeNull();
  });

  it('el filtro ?profesorId= llega al where', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.listar(ADMIN, { profesorId: 'fati' });

    expect(turno.findMany.mock.calls[0]![0].where.profesorId).toBe('fati');
  });
});

describe('TurnosService.crear con profesora', () => {
  const ALTA = {
    salaId: 'sala-1',
    nombre: 'Pilates',
    fecha: '2026-10-05',
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 10,
  };

  it('si el admin no manda profesora, la resuelve del patron', async () => {
    const { servicio, turno, horarios } = crearServicio();
    horarios.resolverParaFranja.mockResolvedValue('fati');

    await servicio.crear(ADMIN, ALTA);

    expect(turno.create.mock.calls[0]![0].data.profesorId).toBe('fati');
  });

  it('si el admin manda profesora, gana la suya y NO se consulta el patron', async () => {
    const { servicio, turno, horarios } = crearServicio();
    horarios.resolverParaFranja.mockResolvedValue('ana');

    await servicio.crear(ADMIN, { ...ALTA, profesorId: 'fati' });

    expect(turno.create.mock.calls[0]![0].data.profesorId).toBe('fati');
    expect(horarios.resolverParaFranja).not.toHaveBeenCalled();
    expect(horarios.exigirProfesoraConAccesoALaSala).toHaveBeenCalled();
  });

  it('sin patron que aplique, el turno nace sin profesora', async () => {
    const { servicio, turno } = crearServicio();

    await servicio.crear(ADMIN, ALTA);

    expect(turno.create.mock.calls[0]![0].data.profesorId).toBeNull();
  });
});
