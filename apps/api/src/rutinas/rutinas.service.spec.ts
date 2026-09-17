import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { RutinasService } from './rutinas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const FILA = {
  id: 'rut-1',
  tenantId: 'gym-1',
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  activa: true,
  desde: new Date('2026-10-01T00:00:00.000Z'),
  hasta: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE = {
  perfilId: 'perf-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  diaSemana: 2,
  horaInicio: '18:00',
  horaFin: '19:00',
  desde: '2026-10-01',
};

function crearServicio() {
  const rutinaFija = {
    create: jest.fn().mockResolvedValue(FILA),
    findFirst: jest.fn().mockResolvedValue(FILA),
    findMany: jest.fn().mockResolvedValue([FILA]),
    update: jest.fn().mockResolvedValue(FILA),
  };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue({
      id: 'perf-1',
      tenantId: 'gym-1',
      salas: [{ salaId: 'sala-1' }],
    }),
  };
  const sala = { findFirst: jest.fn().mockResolvedValue({ id: 'sala-1', activa: true }) };

  const db = {
    rutinaFija,
    perfil,
    sala,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new RutinasService(prisma, historial as unknown as HistorialService),
    rutinaFija,
    perfil,
    sala,
    historial,
  };
}

describe('RutinasService.crear', () => {
  it('crea la rutina y la audita', async () => {
    const { servicio, rutinaFija, historial } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(rutinaFija.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tenantId: 'gym-1', perfilId: 'perf-1', diaSemana: 2 }),
    });
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'RutinaFija', accion: 'CREADA' }),
      expect.anything(),
    );
    expect(creada.id).toBe('rut-1');
  });

  it('guarda desde como medianoche UTC y lo devuelve como YYYY-MM-DD', async () => {
    const { servicio, rutinaFija } = crearServicio();

    const creada = await servicio.crear(ADMIN, BASE);

    expect(rutinaFija.create.mock.calls[0][0].data.desde.toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(creada.desde).toBe('2026-10-01');
    expect(creada.hasta).toBeNull();
  });

  it('403 si el alumno no tiene acceso a la sala', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      id: 'perf-1',
      tenantId: 'gym-1',
      salas: [{ salaId: 'sala-9' }],
    });

    // Misma regla que una reserva manual: sin acceso a la sala, la rutina
    // generaria mes tras mes reservas que el motor rechazaria.
    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('404 si el perfil no existe en este gimnasio', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 si la sala no existe en este gimnasio', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('400 si la sala esta dada de baja', async () => {
    const { servicio, sala } = crearServicio();
    sala.findFirst.mockResolvedValue({ id: 'sala-1', activa: false });

    await expect(servicio.crear(ADMIN, BASE)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si horaFin no es posterior a horaInicio', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, horaInicio: '19:00', horaFin: '18:00' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 si hasta es anterior a desde', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-10', hasta: '2026-10-01' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('acepta hasta igual a desde: una rutina de un solo dia es legitima', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.crear(ADMIN, { ...BASE, desde: '2026-10-10', hasta: '2026-10-10' }),
    ).resolves.toBeDefined();
  });
});

describe('RutinasService.listar', () => {
  it('filtra por perfil y por sala', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, { perfilId: 'perf-1', salaId: 'sala-1' });

    // El default de `activa` se sigue aplicando junto a los demas filtros: la
    // ficha de un alumno tampoco debe llenarse de rutinas ya dadas de baja. El
    // historico se pide a proposito con ?activa=false.
    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { perfilId: 'perf-1', salaId: 'sala-1', activa: true } }),
    );
  });

  it('sin filtros devuelve solo las activas: son las que generan', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, {});

    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: true } }),
    );
  });

  it('activa:false permite ver el historico', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.listar(ADMIN, { activa: false });

    expect(rutinaFija.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { activa: false } }),
    );
  });
});

describe('RutinasService.darDeBaja', () => {
  it('marca activa=false en vez de borrar', async () => {
    const { servicio, rutinaFija } = crearServicio();

    await servicio.darDeBaja(ADMIN, 'rut-1');

    // Borrarla perderia el rastro de por que existen los turnos ya generados.
    expect(rutinaFija.update).toHaveBeenCalledWith({
      where: { id: 'rut-1' },
      data: { activa: false },
    });
  });

  it('es idempotente: repetir la baja no vuelve a auditar', async () => {
    const { servicio, rutinaFija, historial } = crearServicio();
    rutinaFija.findFirst.mockResolvedValue({ ...FILA, activa: false });

    await servicio.darDeBaja(ADMIN, 'rut-1');

    expect(rutinaFija.update).not.toHaveBeenCalled();
    expect(historial.registrar).not.toHaveBeenCalled();
  });

  it('404 si la rutina no existe', async () => {
    const { servicio, rutinaFija } = crearServicio();
    rutinaFija.findFirst.mockResolvedValue(null);

    await expect(servicio.darDeBaja(ADMIN, 'rut-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
