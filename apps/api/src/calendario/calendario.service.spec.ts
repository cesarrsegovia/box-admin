import { BadRequestException } from '@nestjs/common';
import type { JwtPayload, PlanDeMes } from '@boxadmin/shared';
import { CalendarioService } from './calendario.service';
import type { CalendarioDatos } from './calendario.datos';
import type { PrismaService } from '../prisma/prisma.service';
import type { Queue } from 'bullmq';

const ADMIN: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' };

const ENTRADA = {
  sala: { id: 'sala-1', nombre: 'Sala A', cupoBase: 2 },
  anio: 2099,
  mes: 10,
  rutinas: [],
  ausencias: [],
  vacaciones: [],
  turnosExistentes: [],
  reservasActivas: [],
  perfiles: [],
};

function crearServicio() {
  const mesCalendario = {
    findFirst: jest.fn().mockResolvedValue(null),
    upsert: jest.fn(),
    create: jest.fn().mockResolvedValue({ id: 'mes-1' }),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const db = {
    mesCalendario,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;

  const datos = { cargar: jest.fn().mockResolvedValue(ENTRADA) };
  const cola = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    getJob: jest.fn().mockResolvedValue(null),
  };

  return {
    servicio: new CalendarioService(
      prisma,
      datos as unknown as CalendarioDatos,
      cola as unknown as Queue,
    ),
    datos,
    cola,
    mesCalendario,
  };
}

describe('CalendarioService.previsualizar', () => {
  it('devuelve un plan y NO escribe nada en la base', async () => {
    const { servicio, mesCalendario } = crearServicio();

    const plan: PlanDeMes = await servicio.previsualizar(ADMIN, 'sala-1', 2099, 10);

    expect(plan.resumen).toEqual({ turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 });
    // Punto 2 del checklist, literal: previsualizar no toca la base.
    expect(mesCalendario.create).not.toHaveBeenCalled();
    expect(mesCalendario.updateMany).not.toHaveBeenCalled();
  });

  it('400 si el mes esta fuera de 1..12', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.previsualizar(ADMIN, 'sala-1', 2099, 13)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('400 si el mes ya paso', async () => {
    const { servicio } = crearServicio();

    // Regenerar el pasado crearia reservas para clases que ya ocurrieron.
    await expect(servicio.previsualizar(ADMIN, 'sala-1', 2020, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CalendarioService.encolarPublicacion', () => {
  it('encola el job con el tenant del actor, nunca del cuerpo', async () => {
    const { servicio, cola } = crearServicio();

    const encolada = await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(cola.add).toHaveBeenCalledWith(
      'generar-mes',
      expect.objectContaining({
        tenantId: 'gym-1',
        salaId: 'sala-1',
        anio: 2099,
        mes: 10,
        actorId: 'usr-1',
      }),
      expect.anything(),
    );
    // El jobId lo genera el service, no BullMQ: ver el test de la carrera.
    expect(encolada.jobId).toMatch(/^gen-sala-1-2099-10-\d+$/);
  });

  it('REGRESION: escribe la fila del mes ANTES de encolar el job', async () => {
    const { servicio, mesCalendario, cola } = crearServicio();

    await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    // La fila de MesCalendario es el cerrojo que el worker toma con un updateMany
    // condicional, asi que tiene que existir antes de que el job pueda empezar.
    // Al reves —encolar primero, escribir despues— un worker rapido no encontraba
    // fila, su updateMany devolvia 0 y abortaba en silencio: la primera
    // publicacion se perdia y solo funcionaba la segunda. Salio en los e2e de
    // forma intermitente, que es como se manifiestan las carreras.
    expect(mesCalendario.create.mock.invocationCallOrder[0]).toBeLessThan(
      cola.add.mock.invocationCallOrder[0],
    );
  });

  it('el jobId viaja a BullMQ, para que la fila y el job hablen del mismo trabajo', async () => {
    const { servicio, cola } = crearServicio();

    const encolada = await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(cola.add).toHaveBeenCalledWith(
      'generar-mes',
      expect.anything(),
      expect.objectContaining({ jobId: encolada.jobId }),
    );
  });

  // El plan escribia aqui `expect(mesCalendario.upsert).toHaveBeenCalled()`, y ese
  // upsert no puede existir: la extension de aislamiento clasifica `upsert` como
  // operacion de where unico y la rechaza siempre (UnsafeUniqueOperationError),
  // porque no hay donde inyectarle el filtro de tenant. El propio doble de este
  // test lo delata, porque trae `create`, `updateMany` y `$transaction`, que un
  // upsert no usaria, y porque el primer test exige que `create` y `updateMany` NO
  // se llamen en previsualizar. Se comprueba lo que de verdad importa: que la fila
  // del mes queda apuntando al job encolado.
  it('deja el mes en BORRADOR apuntando al jobId del job encolado', async () => {
    const { servicio, mesCalendario } = crearServicio();

    await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(mesCalendario.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'gym-1',
        salaId: 'sala-1',
        anio: 2099,
        mes: 10,
        ultimoJobId: expect.stringMatching(/^gen-sala-1-2099-10-\d+$/),
      },
    });
    expect(mesCalendario.upsert).not.toHaveBeenCalled();
  });

  it('reutiliza la fila del mes si ya existe, sin duplicarla', async () => {
    const { servicio, mesCalendario } = crearServicio();
    mesCalendario.findFirst.mockResolvedValue({ id: 'mes-1' });

    await servicio.encolarPublicacion(ADMIN, 'sala-1', 2099, 10);

    expect(mesCalendario.create).not.toHaveBeenCalled();
    expect(mesCalendario.updateMany).toHaveBeenCalledWith({
      where: { id: 'mes-1' },
      data: { ultimoJobId: expect.stringMatching(/^gen-sala-1-2099-10-\d+$/) },
    });
  });

  it('400 si el mes ya paso', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.encolarPublicacion(ADMIN, 'sala-1', 2020, 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('CalendarioService.obtenerMes', () => {
  it('devuelve BORRADOR y sin publicacion si el mes no tiene fila', async () => {
    const { servicio } = crearServicio();

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes).toEqual(
      expect.objectContaining({ id: null, estado: 'BORRADOR', publicacion: null }),
    );
  });

  it('traduce el estado del job de BullMQ', async () => {
    const { servicio, mesCalendario, cola } = crearServicio();
    mesCalendario.findFirst.mockResolvedValue({
      id: 'mes-1',
      tenantId: 'gym-1',
      salaId: 'sala-1',
      anio: 2099,
      mes: 10,
      estado: 'HABILITADO',
      publicadoEn: new Date('2026-09-16T10:00:00.000Z'),
      publicadoPor: 'usr-1',
      ultimoJobId: 'job-1',
    });
    cola.getJob.mockResolvedValue({
      id: 'job-1',
      getState: jest.fn().mockResolvedValue('completed'),
      returnvalue: { turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 },
      failedReason: undefined,
    });

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes.estado).toBe('HABILITADO');
    expect(mes.publicacion).toEqual({
      jobId: 'job-1',
      estado: 'terminado',
      resumen: { turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 },
      error: null,
    });
  });

  it('un job fallido llega como fallido con su motivo', async () => {
    const { servicio, mesCalendario, cola } = crearServicio();
    mesCalendario.findFirst.mockResolvedValue({
      id: 'mes-1',
      tenantId: 'gym-1',
      salaId: 'sala-1',
      anio: 2099,
      mes: 10,
      estado: 'BORRADOR',
      publicadoEn: null,
      publicadoPor: null,
      ultimoJobId: 'job-1',
    });
    cola.getJob.mockResolvedValue({
      id: 'job-1',
      getState: jest.fn().mockResolvedValue('failed'),
      returnvalue: undefined,
      failedReason: 'Sala inexistente',
    });

    const mes = await servicio.obtenerMes(ADMIN, 'sala-1', 2099, 10);

    expect(mes.publicacion).toEqual(
      expect.objectContaining({ estado: 'fallido', error: 'Sala inexistente' }),
    );
  });
});
