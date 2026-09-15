import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { TurnosService } from './turnos.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

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

  return {
    servicio: new TurnosService(prisma, historial as unknown as HistorialService),
    turno,
    sala,
    reserva,
    historial,
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

    expect(turno.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { _count: { select: { reservas: { where: { canceladaEn: null } } } } },
      }),
    );
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
