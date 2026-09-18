import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { InvitacionesService } from './invitaciones.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'clave-1',
  tenantId: 'gym-1',
  codigo: 'a'.repeat(32),
  nombre: 'Alumnos de Pilates',
  activa: true,
  usosMax: 10,
  usosActuales: 0,
  expiraEn: null,
  packId: 'pack-1',
  salas: [{ salaId: 'sala-1' }, { salaId: 'sala-2' }],
};

function crearServicio() {
  const claveInvitacion = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([FILA]),
    create: jest.fn().mockResolvedValue(FILA),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const claveInvitacionSala = {
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  // El doble RESPETA el filtro `in`, como haria Prisma. Uno que devolviera
  // siempre las dos salas haria fallar cualquier alta de una sola sala, que es
  // un falso negativo del test, no un bug del servicio.
  const SALAS_DEL_GIMNASIO = ['sala-1', 'sala-2'];
  const sala = {
    findMany: jest.fn((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        args.where.id.in.filter((id) => SALAS_DEL_GIMNASIO.includes(id)).map((id) => ({ id })),
      ),
    ),
  };
  const pack = { findFirst: jest.fn().mockResolvedValue({ id: 'pack-1', activo: true }) };

  const db = {
    claveInvitacion,
    claveInvitacionSala,
    sala,
    pack,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new InvitacionesService(
      { db } as unknown as PrismaService,
      historial as unknown as HistorialService,
    ),
    claveInvitacion,
    claveInvitacionSala,
    sala,
    pack,
    historial,
  };
}

describe('InvitacionesService.crear', () => {
  it('genera un codigo de 32 caracteres que el cliente no propone', async () => {
    const { servicio, claveInvitacion } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'Alumnos de Pilates', salaIds: ['sala-1', 'sala-2'] });

    const data = claveInvitacion.create.mock.calls[0][0].data;
    expect(data.codigo).toMatch(/^[0-9a-f]{32}$/);
    expect(data.nombre).toBe('Alumnos de Pilates');
  });

  it('dos claves seguidas no comparten codigo', async () => {
    const { servicio, claveInvitacion } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'] });
    await servicio.crear(ADMIN, { nombre: 'B', salaIds: ['sala-1'] });

    const primero = claveInvitacion.create.mock.calls[0][0].data.codigo;
    const segundo = claveInvitacion.create.mock.calls[1][0].data.codigo;
    expect(primero).not.toBe(segundo);
  });

  it('crea las filas de salas que la clave otorga', async () => {
    const { servicio, claveInvitacionSala } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1', 'sala-2'] });

    expect(claveInvitacionSala.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-1' },
        { tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-2' },
      ],
    });
  });

  it('rechaza una sala que no existe en este gimnasio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1', 'sala-fantasma'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una clave sin ninguna sala', async () => {
    const { servicio } = crearServicio();

    // Una clave sin salas produciria alumnos que no pueden reservar nada: es
    // exactamente el agujero que esta fase viene a tapar.
    await expect(servicio.crear(ADMIN, { nombre: 'A', salaIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rechaza un pack inexistente', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'], packId: 'pack-fantasma' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rechaza un pack dado de baja', async () => {
    const { servicio, pack } = crearServicio();
    pack.findFirst.mockResolvedValue({ id: 'pack-1', activo: false });

    await expect(
      servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'], packId: 'pack-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('registra la creacion en el historial sin filtrar el codigo', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crear(ADMIN, { nombre: 'A', salaIds: ['sala-1'] });

    const entrada = historial.registrar.mock.calls[0][0];
    expect(entrada).toMatchObject({ entidad: 'ClaveInvitacion', accion: 'CREADA' });
    // El codigo es una credencial: no va al historial, que lo lee mas gente de
    // la que deberia poder darse de alta.
    expect(JSON.stringify(entrada.detalle ?? {})).not.toContain('a'.repeat(32));
  });
});

describe('InvitacionesService.listar', () => {
  it('devuelve las claves con sus salas aplanadas', async () => {
    const { servicio } = crearServicio();

    const claves = await servicio.listar(ADMIN);

    expect(claves[0]).toMatchObject({ id: 'clave-1', salaIds: ['sala-1', 'sala-2'] });
  });
});

describe('InvitacionesService.actualizar', () => {
  it('404 si la clave no existe', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.actualizar(ADMIN, 'clave-9', { activa: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('desactiva la clave sin tocar sus salas', async () => {
    const { servicio, claveInvitacion, claveInvitacionSala } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await servicio.actualizar(ADMIN, 'clave-1', { activa: false });

    expect(claveInvitacion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'clave-1' },
        data: expect.objectContaining({ activa: false }),
      }),
    );
    expect(claveInvitacionSala.deleteMany).not.toHaveBeenCalled();
  });

  it('reemplaza las salas por completo cuando se mandan', async () => {
    const { servicio, claveInvitacion, claveInvitacionSala } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await servicio.actualizar(ADMIN, 'clave-1', { salaIds: ['sala-2'] });

    // Borrar y volver a crear, no diferencia incremental: es lo mismo que hace
    // PATCH /usuarios/:id/salas desde la Fase 1 y evita reconciliaciones
    // sutiles que nadie prueba.
    expect(claveInvitacionSala.deleteMany).toHaveBeenCalledWith({ where: { claveId: 'clave-1' } });
    expect(claveInvitacionSala.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 'gym-1', claveId: 'clave-1', salaId: 'sala-2' }],
    });
  });

  it('rechaza dejar la clave sin salas', async () => {
    const { servicio, claveInvitacion } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await expect(servicio.actualizar(ADMIN, 'clave-1', { salaIds: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('el codigo no se puede cambiar: es una credencial ya repartida', async () => {
    const { servicio, claveInvitacion } = crearServicio();
    claveInvitacion.findFirst.mockResolvedValue(FILA);

    await servicio.actualizar(ADMIN, 'clave-1', { nombre: 'Otro nombre' });

    expect(claveInvitacion.update.mock.calls[0][0].data.codigo).toBeUndefined();
  });
});
