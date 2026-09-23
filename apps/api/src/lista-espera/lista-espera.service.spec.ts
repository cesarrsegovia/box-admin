import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ListaEsperaService } from './lista-espera.service';
import type { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { PrismaService } from '../prisma/prisma.service';

const ALUMNO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

const EN_LISTA_ESPERA = {
  turnoId: 'turno-1',
  estado: 'LISTA_ESPERA' as const,
  cupo: 5,
  ocupados: 5,
  puedeReservar: false,
  motivo: null,
  enListaEspera: false,
  posicionEnLista: null,
};

function crearServicio() {
  const listaEspera = {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({
      id: 'le-1',
      tenantId: 'gym-1',
      turnoId: 'turno-1',
      perfilId: 'perfil-1',
      notificado: false,
      createdAt: new Date('2099-10-01T00:00:00.000Z'),
    }),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const reserva = {
    create: jest.fn().mockResolvedValue({ id: 'reserva-nueva' }),
    findFirst: jest.fn().mockResolvedValue(null),
  };
  const perfil = { findFirst: jest.fn().mockResolvedValue({ id: 'perfil-1' }) };

  const db = {
    listaEspera,
    reserva,
    perfil,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const disponibilidad = { paraTurno: jest.fn().mockResolvedValue(EN_LISTA_ESPERA) };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new ListaEsperaService(
      { db } as unknown as PrismaService,
      disponibilidad as unknown as DisponibilidadService,
      historial as unknown as HistorialService,
    ),
    listaEspera,
    reserva,
    disponibilidad,
    historial,
    db,
  };
}

describe('ListaEsperaService.anotarse', () => {
  it('anota al alumno cuando el turno esta en LISTA_ESPERA', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findMany.mockResolvedValue([{ perfilId: 'perfil-1' }]);

    const entrada = await servicio.anotarse(ALUMNO, 'turno-1');

    expect(listaEspera.create).toHaveBeenCalledWith({
      data: { tenantId: 'gym-1', turnoId: 'turno-1', perfilId: 'perfil-1' },
    });
    expect(entrada).toMatchObject({ id: 'le-1', turnoId: 'turno-1', posicion: 1 });
  });

  it('rechaza anotarse en un turno con cupo libre', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...EN_LISTA_ESPERA,
      estado: 'LIBRE',
      ocupados: 1,
    });

    // Si hay cupo, lo que corresponde es reservar, no hacer cola.
    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza anotarse en un turno LLENO sin lista de espera habilitada', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({ ...EN_LISTA_ESPERA, estado: 'LLENO' });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza anotarse si el alumno no tiene acceso a la sala', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...EN_LISTA_ESPERA,
      motivo: 'SIN_ACCESO_A_SALA',
    });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechaza anotarse si el mes no esta publicado', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...EN_LISTA_ESPERA,
      motivo: 'MES_NO_PUBLICADO',
    });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('rechaza anotarse dos veces en el mismo turno', async () => {
    const { servicio, disponibilidad } = crearServicio();
    disponibilidad.paraTurno.mockResolvedValue({
      ...EN_LISTA_ESPERA,
      enListaEspera: true,
      posicionEnLista: 3,
    });

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('la posicion sale del orden de la cola, no de un contador', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findMany.mockResolvedValue([
      { perfilId: 'otro-1' },
      { perfilId: 'otro-2' },
      { perfilId: 'perfil-1' },
    ]);

    const entrada = await servicio.anotarse(ALUMNO, 'turno-1');

    expect(entrada.posicion).toBe(3);
    expect(listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('404 si el actor no tiene perfil', async () => {
    const { servicio, db } = crearServicio();
    db.perfil.findFirst.mockResolvedValue(null);

    await expect(servicio.anotarse(ALUMNO, 'turno-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ListaEsperaService.salirse', () => {
  it('borra la fila del alumno', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findFirst.mockResolvedValue({
      id: 'le-1',
      turnoId: 'turno-1',
      perfilId: 'perfil-1',
    });

    await servicio.salirse(ALUMNO, 'le-1');

    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });

  it('404 si la entrada no existe', async () => {
    const { servicio } = crearServicio();

    await expect(servicio.salirse(ALUMNO, 'le-9')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 si la entrada es de otro alumno', async () => {
    const { servicio, listaEspera } = crearServicio();
    listaEspera.findFirst.mockResolvedValue({ id: 'le-1', turnoId: 'turno-1', perfilId: 'otro' });

    await expect(servicio.salirse(ALUMNO, 'le-1')).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ListaEsperaService.asignarPrimero', () => {
  const PRIMERO = {
    id: 'le-1',
    tenantId: 'gym-1',
    turnoId: 'turno-1',
    perfilId: 'perfil-7',
    createdAt: new Date('2099-10-01T00:00:00.000Z'),
  };

  it('sin nadie en la cola no hace nada', async () => {
    const { servicio, reserva, db } = crearServicio();

    const asignada = await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(asignada).toBeNull();
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('crea la reserva del primero con origen LISTA_ESPERA', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create).toHaveBeenCalledWith({
      data: { tenantId: 'gym-1', turnoId: 'turno-1', perfilId: 'perfil-7', origen: 'LISTA_ESPERA' },
    });
  });

  it('borra la fila de la cola al asignar', async () => {
    const { servicio, listaEspera, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });

  it('toma al PRIMERO de la cola, ordenada por createdAt e id', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([
      PRIMERO,
      { ...PRIMERO, id: 'le-2', perfilId: 'perfil-8' },
    ]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create.mock.calls[0][0].data.perfilId).toBe('perfil-7');
    expect(listaEspera.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
  });

  it('DEVUELVE el aviso en vez de encolarlo', async () => {
    const { servicio, listaEspera, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    const repartido = await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    // El objeto EXACTO, no un objectContaining: este assert es justo el que
    // garantiza que no se cuela nada de mas en lo que acaba en el payload.
    //
    // Y se comprueba sobre lo DEVUELTO, no sobre un espia del hook: desde la
    // Fase 5B esto corre dentro de una transaccion que puede abortar por
    // conflicto y reintentarse, asi que encolar aqui mandaria el aviso dos
    // veces. Quien encola es quien hizo commit.
    expect(repartido).toEqual({
      perfilId: 'perfil-7',
      turnoId: 'turno-1',
      reservaId: 'reserva-nueva',
      entradaId: 'le-1',
    });
  });

  it('salta a quien ya tenga una reserva activa en ese turno', async () => {
    const { servicio, listaEspera, reserva, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([
      PRIMERO,
      { ...PRIMERO, id: 'le-2', perfilId: 'perfil-8' },
    ]);
    // El primero ya esta dentro: alguien lo reservo manualmente mientras hacia cola.
    reserva.findFirst.mockImplementation((args: { where: { perfilId: string } }) =>
      Promise.resolve(args.where.perfilId === 'perfil-7' ? { id: 'ya-tiene' } : null),
    );

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    expect(reserva.create.mock.calls[0][0].data.perfilId).toBe('perfil-8');
    // Y su fila de la cola se limpia igualmente: ya no pinta nada ahi.
    expect(listaEspera.deleteMany).toHaveBeenCalledWith({ where: { id: 'le-1' } });
  });

  it('registra la asignacion en el historial, con su origen', async () => {
    const { servicio, listaEspera, historial, db } = crearServicio();
    listaEspera.findMany.mockResolvedValue([PRIMERO]);

    await servicio.asignarPrimero(ALUMNO, 'turno-1', db as never);

    // El rastro es lo que permite a un alumno entender despues por que le
    // aparecio una clase que no reservo.
    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Reserva', accion: 'ASIGNADA_DESDE_LISTA' }),
      db,
    );
  });
});
