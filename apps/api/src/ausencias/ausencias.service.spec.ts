import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { AusenciasService } from './ausencias.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

const FILA = {
  id: 'aus-1',
  tenantId: 'gym-1',
  salaId: null,
  // A caballo entre dos meses a proposito: es el caso que el filtro por solape
  // tiene que devolver y el de contencion esconderia.
  desde: new Date('2026-09-28T00:00:00.000Z'),
  hasta: new Date('2026-10-03T00:00:00.000Z'),
  todoElDia: true,
  horaInicio: null,
  horaFin: null,
  recuperable: true,
  motivo: 'Feriado',
  createdAt: new Date(),
};

const BASE = { desde: '2026-09-28', hasta: '2026-10-03' };

function crearServicio() {
  const ausencia = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    delete: jest.fn().mockResolvedValue(FILA),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };

  const db = {
    ausencia,
    sala,
    // La anotacion `: unknown` del retorno es obligatoria: sin ella tsc --strict
    // lanza TS7022 por inferencia circular sobre el doble.
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new AusenciasService(prisma, historial as unknown as HistorialService),
    ausencia,
    sala,
    historial,
  };
}

describe('AusenciasService.crear', () => {
  it('crea un cierre de todo el salon cuando salaId es null', async () => {
    const { servicio, ausencia, sala, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(ausencia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', salaId: null }),
    });
    // Sin sala no hay nada que comprobar: el cierre es del salon entero.
    expect(sala.findFirst).not.toHaveBeenCalled();
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Ausencia', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.salaId).toBeNull();
  });

  it('crea un cierre de una sala concreta', async () => {
    const { servicio, ausencia, sala } = crearServicio();
    ausencia.create.mockResolvedValue({ ...FILA, salaId: 'sala-1' });

    const creada = await servicio.crear(ADMIN, { ...BASE, salaId: 'sala-1' });

    expect(sala.findFirst).toHaveBeenCalledWith({ where: { id: 'sala-1' } });
    expect(ausencia.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ salaId: 'sala-1' }),
    });
    expect(creada.salaId).toBe('sala-1');
  });

  it('404 si la sala indicada no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, { ...BASE, salaId: 'sala-de-otro-gym' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si hasta es anterior a desde', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { desde: '2026-10-03', hasta: '2026-09-28' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si todoElDia es false y falta horaInicio o horaFin', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, todoElDia: false, horaInicio: '14:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      servicio.crear(ADMIN, { ...BASE, todoElDia: false, horaFin: '18:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(servicio.crear(ADMIN, { ...BASE, todoElDia: false })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400 si horaFin no es posterior a horaInicio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, {
        ...BASE,
        todoElDia: false,
        horaInicio: '18:00',
        horaFin: '14:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      servicio.crear(ADMIN, {
        ...BASE,
        todoElDia: false,
        horaInicio: '18:00',
        horaFin: '18:00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('con todoElDia true ignora el tramo horario y lo guarda como null', async () => {
    const { servicio, ausencia } = crearServicio();

    const creada = await servicio.crear(ADMIN, {
      ...BASE,
      todoElDia: true,
      horaInicio: '14:00',
      horaFin: '18:00',
    });

    // Guardarlo a medias confundiria al motor: si cierra el dia entero, el
    // tramo no significa nada.
    const data = ausencia.create.mock.calls[0][0].data;
    expect(data.todoElDia).toBe(true);
    expect(data.horaInicio).toBeNull();
    expect(data.horaFin).toBeNull();
    expect(creada.horaInicio).toBeNull();
    expect(creada.horaFin).toBeNull();
  });

  it('guarda el tramo horario de un cierre parcial', async () => {
    const { servicio, ausencia } = crearServicio();

    await servicio.crear(ADMIN, {
      ...BASE,
      todoElDia: false,
      horaInicio: '14:00',
      horaFin: '18:00',
    });

    const data = ausencia.create.mock.calls[0][0].data;
    expect(data.todoElDia).toBe(false);
    expect(data.horaInicio).toBe('14:00');
    expect(data.horaFin).toBe('18:00');
  });
});

describe('AusenciasService.listar', () => {
  it('listar filtra por sala incluyendo los cierres de todo el salon', async () => {
    const { servicio, ausencia } = crearServicio();

    await servicio.listar(ADMIN, { salaId: 'sala-1' });

    // Un feriado del salon entero (salaId null) afecta tambien a esta sala: si
    // no saliera, el admin no veria el cierre que si le toca.
    expect(ausencia.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ salaId: 'sala-1' }, { salaId: null }],
        }),
      }),
    );
  });

  it('listar filtra por rango de fechas solapado, no por contencion', async () => {
    const { servicio, ausencia } = crearServicio();

    await servicio.listar(ADMIN, { desde: '2026-10-01', hasta: '2026-10-31' });

    // Solape: el cierre del 28/09 al 03/10 tiene que salir al preguntar por
    // octubre. Por contencion quedaria escondido justo el que cruza de mes.
    const where = ausencia.findMany.mock.calls[0][0].where;
    expect(where.hasta).toEqual({ gte: new Date('2026-10-01T00:00:00.000Z') });
    expect(where.desde).toEqual({ lte: new Date('2026-10-31T00:00:00.000Z') });
  });

  it('sin filtros no impone ninguna condicion', async () => {
    const { servicio, ausencia } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(ausencia.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('AusenciasService.darDeBaja', () => {
  it('darDeBaja borra el cierre y lo audita', async () => {
    const { servicio, ausencia, historial } = crearServicio();

    const borrada = await servicio.darDeBaja(ADMIN, 'aus-1');

    expect(ausencia.delete).toHaveBeenCalledWith({ where: { id: 'aus-1' } });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Ausencia', accion: 'ELIMINADA' }),
      expect.anything(),
    );
    expect(borrada.id).toBe('aus-1');
  });

  it('404 al borrar un cierre inexistente', async () => {
    const { servicio, ausencia, historial } = crearServicio();
    ausencia.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'aus-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(ausencia.delete).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });
});
