import { ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ReservasService } from './reservas.service';
import type { HistorialService } from '../common/historial/historial.service';
import type { ListaEsperaService } from '../lista-espera/lista-espera.service';
import type { NotificacionesService } from '../notificaciones/notificaciones.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CacheDeStats } from '../stats/cache-de-stats';

const ADMIN: JwtPayload = { sub: 'usr-admin', tenantId: 'gym-1', rol: 'ADMIN_OPERATIVO' };

const TURNO = {
  id: 'turno-1',
  tenantId: 'gym-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: new Date('2026-10-17T00:00:00.000Z'),
  horaInicio: '18:00',
  horaFin: '19:00',
  cupo: 2,
};

const PERFIL = {
  id: 'perf-1',
  tenantId: 'gym-1',
  usuarioId: 'usr-1',
  clasesExtra: 0,
  cancelacionesUsadas: 0,
  vigenciaDesde: null,
  vigenciaHasta: null,
  packId: null,
  pack: null,
  salas: [{ salaId: 'sala-1' }],
};

const RESERVA = {
  id: 'res-1',
  tenantId: 'gym-1',
  turnoId: 'turno-1',
  perfilId: 'perf-1',
  origen: 'ADMIN' as const,
  esPrueba: false,
  pagoRealizado: false,
  canceladaEn: null,
  cancelacionTipo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function crearServicio() {
  const turno = { findFirst: jest.fn().mockResolvedValue(TURNO) };
  const perfil = {
    findFirst: jest.fn().mockResolvedValue(PERFIL),
    update: jest.fn().mockResolvedValue(PERFIL),
  };
  const reserva = {
    findFirst: jest.fn().mockResolvedValue(null), // no hay duplicada
    count: jest.fn().mockResolvedValue(0), // turno vacio
    create: jest.fn().mockResolvedValue(RESERVA),
    update: jest.fn().mockResolvedValue(RESERVA),
    // Desde la Fase 9, `listarDeTurno` lee las reservas del turno con el nombre
    // del alumno resuelto. Por defecto vacio: cada caso siembra las suyas.
    findMany: jest.fn().mockResolvedValue([]),
  };

  // `crear` busca una reserva duplicada (sin `include`) y espera null; `cancelar`
  // busca la reserva con su perfil (con `include`). El mismo doble sirve para las
  // dos si se distingue por el `include`.
  const RESERVA_CON_PERFIL = { ...RESERVA, perfil: { ...PERFIL, usuarioId: 'usr-1' } };
  reserva.findFirst.mockImplementation((args: { include?: unknown }) =>
    args?.include ? RESERVA_CON_PERFIL : null,
  );

  const db = {
    turno,
    perfil,
    reserva,
    $transaction: jest.fn((fn: (tx: unknown) => unknown): unknown => fn(db)),
  };
  const prisma = { db } as unknown as PrismaService;
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };
  // Desde la Fase 3A, cancelar reparte el cupo liberado al primero de la cola.
  const listaEspera = { asignarPrimero: jest.fn().mockResolvedValue(null) };
  // Desde la Fase 5B, crear y cancelar encolan el aviso al alumno. Y lo hacen
  // DESPUES del commit, no dentro de la transaccion.
  const notificaciones = {
    reservaCambiada: jest.fn().mockResolvedValue(undefined),
    cupoAsignado: jest.fn().mockResolvedValue(undefined),
  };
  // Desde la Fase 6A, crear y cancelar tiran el cache de reportes del gimnasio:
  // una reserva mueve la ocupacion y la asistencia. Tambien DESPUES del commit,
  // y por el mismo motivo que los avisos.
  const cache = { invalidar: jest.fn().mockResolvedValue(undefined) };

  return {
    servicio: new ReservasService(
      prisma,
      historial as unknown as HistorialService,
      listaEspera as unknown as ListaEsperaService,
      notificaciones as unknown as NotificacionesService,
      cache as unknown as CacheDeStats,
    ),
    turno,
    perfil,
    reserva,
    historial,
    listaEspera,
    notificaciones,
    cache,
    db,
  };
}

describe('ReservasService.crear', () => {
  it('crea la reserva cuando hay lugar', async () => {
    const { servicio, reserva } = crearServicio();

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.create).toHaveBeenCalledTimes(1);
    expect(creada.id).toBe('res-1');
    expect(creada.advertencias).toEqual([]);
  });

  it('usa una transaccion Serializable', async () => {
    const { servicio, db } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });

  it('reintenta el conflicto de serializacion y termina creando la reserva', async () => {
    const { servicio, db, reserva } = crearServicio();
    const original = db.$transaction;
    let intentos = 0;
    db.$transaction = jest.fn((fn: (tx: unknown) => unknown): unknown => {
      intentos += 1;
      if (intentos === 1) throw Object.assign(new Error('write conflict'), { code: 'P2034' });
      return original(fn);
    });

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(intentos).toBe(2);
    expect(reserva.create).toHaveBeenCalledTimes(1);
    expect(creada.id).toBe('res-1');
  });

  it('409 —no 500— si el conflicto de serializacion sobrevive a los reintentos', async () => {
    // Un P2034 crudo llega al AllExceptionsFilter como 500 "Error interno". Que
    // la base aborte por solape es un conflicto, no una averia: el cliente tiene
    // que poder distinguirlo y reintentar.
    const { servicio, db } = crearServicio();
    db.$transaction = jest.fn((_fn: (tx: unknown) => unknown): unknown => {
      throw Object.assign(new Error('write conflict'), { code: 'P2034' });
    });

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.$transaction).toHaveBeenCalledTimes(5);
  });

  it('un error que no es de serializacion se propaga tal cual', async () => {
    const { servicio, db } = crearServicio();
    const roto = new Error('la base se cayo');
    db.$transaction = jest.fn((_fn: (tx: unknown) => unknown): unknown => {
      throw roto;
    });

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBe(roto);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('409 si el turno esta lleno, y sin insertar nada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.count.mockResolvedValue(2); // cupo del turno = 2

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('cuenta solo las reservas sin cancelar al comprobar el cupo', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-1', canceladaEn: null },
    });
  });

  it('409 si el perfil ya tiene una reserva activa en ese turno', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue(RESERVA);

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reserva.create).not.toHaveBeenCalled();
  });

  it('403 si el perfil no tiene acceso a la sala del turno', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue({ ...PERFIL, salas: [{ salaId: 'sala-9' }] });

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 si el turno no existe en este gimnasio', async () => {
    const { servicio, turno } = crearServicio();
    turno.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, 'turno-x', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 si el perfil no existe en este gimnasio', async () => {
    const { servicio, perfil } = crearServicio();
    perfil.findFirst.mockResolvedValue(null);

    await expect(
      servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-de-otro-gym' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('advierte PACK_AGOTADO pero crea igual la reserva', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 4, clasesTotales: null },
    });
    // 2 llamadas a count: la del cupo (0) y la del consumo del pack (4)
    reserva.count.mockResolvedValueOnce(0).mockResolvedValueOnce(4);

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    // El admin manda: puede querer meter una clase de cortesia. Pero se entera.
    expect(reserva.create).toHaveBeenCalledTimes(1);
    expect(creada.advertencias.map((a) => a.codigo)).toEqual(['PACK_AGOTADO']);
  });

  it('no advierte nada si al alumno le quedan clases', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 8, clasesTotales: null },
    });
    reserva.count.mockResolvedValueOnce(0).mockResolvedValueOnce(3);

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(creada.advertencias).toEqual([]);
  });

  it('al contar el consumo del pack ignora las canceladas recuperables', async () => {
    const { servicio, perfil, reserva } = crearServicio();
    perfil.findFirst.mockResolvedValue({
      ...PERFIL,
      packId: 'pack-1',
      pack: { tipo: 'MENSUAL', clasesPorMes: 8, clasesTotales: null },
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(reserva.count).toHaveBeenLastCalledWith({
      where: {
        perfilId: 'perf-1',
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: {
          fecha: {
            gte: new Date('2026-10-01T00:00:00.000Z'),
            lte: new Date('2026-10-31T00:00:00.000Z'),
          },
        },
      },
    });
  });

  it('deja rastro en el historial', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ entidad: 'Reserva', entidadId: 'res-1', accion: 'CREADA' }),
      expect.anything(),
    );
  });
});

const ALUMNO_PROPIO: JwtPayload = { sub: 'usr-1', tenantId: 'gym-1', rol: 'ALUMNO' };

describe('ReservasService.cancelar', () => {
  it('marca canceladaEn y el tipo, sin borrar la fila', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE');

    expect(reserva.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { canceladaEn: expect.any(Date), cancelacionTipo: 'RECUPERABLE' },
    });
  });

  it('una cancelacion DEFINITIVA se guarda como tal', async () => {
    const { servicio, reserva } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'DEFINITIVA');

    expect(reserva.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ cancelacionTipo: 'DEFINITIVA' }) }),
    );
  });

  it('409 si la reserva ya estaba cancelada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue({
      ...RESERVA,
      canceladaEn: new Date(),
      cancelacionTipo: 'DEFINITIVA',
      perfil: PERFIL,
    });

    await expect(servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 si la reserva no existe en este gimnasio', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue(null);

    await expect(servicio.cancelar(ADMIN, 'res-x', 'RECUPERABLE')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('una cancelacion del ADMIN no toca cancelacionesUsadas', async () => {
    const { servicio, perfil } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'RECUPERABLE');

    // El documento de relevamiento lo dice explicitamente: el contador mide las
    // cancelaciones del alumno, no las correcciones del salon.
    expect(perfil.update).not.toHaveBeenCalled();
  });

  it('si la origina el propio alumno, si incrementa su contador', async () => {
    const { servicio, perfil } = crearServicio();

    await servicio.cancelar(ALUMNO_PROPIO, 'res-1', 'RECUPERABLE');

    expect(perfil.update).toHaveBeenCalledWith({
      where: { id: 'perf-1' },
      data: { cancelacionesUsadas: { increment: 1 } },
    });
  });

  it('lo deja registrado en el historial con el tipo', async () => {
    const { servicio, historial } = crearServicio();

    await servicio.cancelar(ADMIN, 'res-1', 'DEFINITIVA');

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        entidad: 'Reserva',
        accion: 'CANCELADA',
        detalle: expect.objectContaining({ tipo: 'DEFINITIVA' }),
      }),
      expect.anything(),
    );
  });
});

describe('ReservasService.reasignar', () => {
  it('mueve la reserva al turno destino', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(reserva.update).toHaveBeenCalledWith({
      where: { id: 'res-1' },
      data: { turnoId: 'turno-2' },
    });
  });

  it('valida el cupo del turno DESTINO, no el del origen', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 2 });
    reserva.count.mockResolvedValue(2); // el destino ya esta lleno

    await expect(servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(reserva.update).not.toHaveBeenCalled();
  });

  it('cuenta el cupo del destino, no el de cualquier turno', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(reserva.count).toHaveBeenCalledWith({
      where: { turnoId: 'turno-2', canceladaEn: null },
    });
  });

  it('403 si el perfil no tiene acceso a la sala del destino', async () => {
    const { servicio, turno } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', salaId: 'sala-9' });

    await expect(servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('409 si se reasigna una reserva ya cancelada', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findFirst.mockResolvedValue({
      ...RESERVA,
      canceladaEn: new Date(),
      perfil: { ...PERFIL, salas: [{ salaId: 'sala-1' }] },
    });

    await expect(servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('409 si el perfil ya tiene una reserva activa en el destino', async () => {
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });
    // findFirst sin include = busqueda de duplicada: devuelve una
    reserva.findFirst.mockImplementation((args: { include?: unknown }) =>
      args?.include ? { ...RESERVA, perfil: { ...PERFIL, usuarioId: 'usr-1' } } : RESERVA,
    );

    await expect(servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('deja rastro con turno de origen y de destino', async () => {
    const { servicio, turno, historial } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(historial.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'REASIGNADA',
        detalle: expect.objectContaining({ desde: 'turno-1', hasta: 'turno-2' }),
      }),
      expect.anything(),
    );
  });
});

describe('ReservasService.cancelar dispara la lista de espera', () => {
  it('corre en Serializable: al asignar el cupo pasa a competir por el', async () => {
    const { servicio, db } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Antes de la Fase 3A esta transaccion no llevaba isolationLevel, porque
    // cancelar no competia por ningun cupo. Ahora si: dos cancelaciones
    // simultaneas sobre el mismo turno podrian dar el mismo lugar a dos
    // personas de la cola.
    expect(db.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
  });

  it('llama a asignarPrimero con el MISMO cliente de la transaccion', async () => {
    const { servicio, listaEspera, db } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Mismo cliente = misma transaccion. Si se pasara `this.prisma.db`, una
    // cancelacion que fallara despues dejaria una reserva de la cola que nadie
    // pidio.
    expect(listaEspera.asignarPrimero).toHaveBeenCalledWith(ADMIN, 'turno-1', db);
  });

  it('asigna DESPUES de marcar la cancelacion, no antes', async () => {
    const { servicio, reserva, listaEspera } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // Al reves, el cupo seguiria ocupado y la asignacion encontraria el turno
    // lleno.
    expect(reserva.update.mock.invocationCallOrder[0]).toBeLessThan(
      listaEspera.asignarPrimero.mock.invocationCallOrder[0],
    );
  });

  it('no asigna nada si la reserva ya estaba cancelada', async () => {
    const { servicio, listaEspera, reserva } = crearServicio();
    reserva.findFirst.mockImplementation((args: { include?: unknown }) =>
      args?.include ? { ...RESERVA, canceladaEn: new Date(), perfil: PERFIL } : null,
    );

    await expect(servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(listaEspera.asignarPrimero).not.toHaveBeenCalled();
  });
});

describe('ReservasService avisa al alumno', () => {
  it('crear encola una CONFIRMACION con el origen real de la reserva', async () => {
    const { servicio, notificaciones } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    // El objeto EXACTO: lo que sale de aqui acaba en un payload de Redis, y lo
    // que no haga falta ahi no tiene por que estar.
    expect(notificaciones.reservaCambiada).toHaveBeenCalledWith({
      tenantId: 'gym-1',
      // LA FILA CREADA. Sin este id el worker tendria que buscar "la reserva de
      // este perfil en este turno", que no identifica una: ver `colas.ts`.
      reservaId: 'res-1',
      perfilId: 'perf-1',
      turnoId: 'turno-1',
      origen: 'ADMIN',
      accion: 'CONFIRMACION',
    });
  });

  it('cancelar encola una CANCELACION', async () => {
    const { servicio, notificaciones } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    expect(notificaciones.reservaCambiada).toHaveBeenCalledWith({
      tenantId: 'gym-1',
      reservaId: 'res-1',
      perfilId: 'perf-1',
      turnoId: 'turno-1',
      origen: 'ADMIN',
      accion: 'CANCELACION',
    });
  });

  it('una reserva rechazada no avisa a nadie', async () => {
    const { servicio, turno, notificaciones } = crearServicio();
    turno.findFirst.mockResolvedValue(null);

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(notificaciones.reservaCambiada).not.toHaveBeenCalled();
  });
});

describe('ReservasService encola los avisos DESPUES del commit', () => {
  /** Lo que lanza Postgres cuando aborta una transaccion por solape. */
  function conflictoDeSerializacion(): Error {
    return Object.assign(new Error('could not serialize access'), { code: '40001' });
  }

  it('crear: un aborto 40001 reintentado NO duplica el aviso', async () => {
    const { servicio, notificaciones, db } = crearServicio();

    // El primer intento ejecuta el cuerpo ENTERO y despues aborta: es el caso
    // exacto que rompia el encolado de adentro. Redis no participa del rollback
    // de Postgres, asi que el job del intento fallido se habria quedado vivo y
    // el reintento habria encolado otro.
    //
    // MUTACION QUE TIENE QUE ROMPER ESTE TEST: devolver el `reservaCambiada`
    // adentro de la transaccion. Entonces `add` se llama dos veces.
    let intentos = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      intentos += 1;
      const salida = await fn(db);
      if (intentos === 1) throw conflictoDeSerializacion();
      return salida;
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(intentos).toBe(2);
    expect(notificaciones.reservaCambiada).toHaveBeenCalledTimes(1);
  });

  it('crear: nada se encola mientras la transaccion sigue abierta', async () => {
    const { servicio, notificaciones, db } = crearServicio();

    let avisadoDentro = false;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      avisadoDentro = notificaciones.reservaCambiada.mock.calls.length > 0;
      return salida;
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(avisadoDentro).toBe(false);
    expect(notificaciones.reservaCambiada).toHaveBeenCalledTimes(1);
  });

  it('cancelar: encola tambien el cupo que repartio la lista de espera', async () => {
    const { servicio, notificaciones, listaEspera } = crearServicio();
    listaEspera.asignarPrimero.mockResolvedValue({
      reservaId: 'reserva-nueva',
      perfilId: 'perfil-7',
      turnoId: 'turno-1',
      entradaId: 'le-1',
    });

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    // El objeto EXACTO: esto acaba en un payload que vive en Redis.
    expect(notificaciones.cupoAsignado).toHaveBeenCalledWith({
      tenantId: 'gym-1',
      reservaId: 'reserva-nueva',
      perfilId: 'perfil-7',
      turnoId: 'turno-1',
      entradaId: 'le-1',
    });
  });

  it('cancelar: un aborto 40001 reintentado NO duplica ninguno de los dos avisos', async () => {
    const { servicio, notificaciones, listaEspera, db } = crearServicio();
    listaEspera.asignarPrimero.mockResolvedValue({
      reservaId: 'reserva-nueva',
      perfilId: 'perfil-7',
      turnoId: 'turno-1',
      entradaId: 'le-1',
    });

    let intentos = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      intentos += 1;
      const salida = await fn(db);
      if (intentos === 1) throw conflictoDeSerializacion();
      return salida;
    });

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    expect(intentos).toBe(2);
    expect(notificaciones.reservaCambiada).toHaveBeenCalledTimes(1);
    expect(notificaciones.cupoAsignado).toHaveBeenCalledTimes(1);
  });
});

describe('ReservasService no queda a merced del hook', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('un hook que LANZA no convierte en 500 una reserva ya guardada', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { servicio, notificaciones, reserva } = crearServicio();
    // Un doble que rechaza: hoy el servicio real se traga el fallo, pero eso es
    // disciplina de OTRA clase. `reservas` tiene que sostenerse sola.
    notificaciones.reservaCambiada.mockRejectedValue(new Error('Redis caido'));

    const creada = await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(creada.id).toBe('res-1');
    expect(reserva.create).toHaveBeenCalledTimes(1);
  });

  it('un hook que lanza tampoco tumba una cancelacion', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { servicio, notificaciones } = crearServicio();
    notificaciones.reservaCambiada.mockRejectedValue(new Error('Redis caido'));

    await expect(servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE')).resolves.toBeDefined();
  });
});

/**
 * LA INVALIDACION DEL CACHE DE REPORTES.
 *
 * Una reserva no mueve la caja, pero si la ocupacion y el denominador de la
 * asistencia, que son los reportes de la Task 6. Y el cache es uno solo por
 * gimnasio: el contador de version los invalida a todos de golpe, incluidos los
 * que todavia no existen.
 */
describe('ReservasService invalida el cache de reportes DESPUES del commit', () => {
  it('crear invalida el cache del gimnasio del actor', async () => {
    const { servicio, cache } = crearServicio();

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('cancelar invalida tambien', async () => {
    const { servicio, cache } = crearServicio();

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  // LOS DOS QUE FALTABAN. `cancelar` era el unico de los sitios de invalidacion
  // sin un caso que fijara el POST-COMMIT: con solo el de arriba, mover la
  // linea dentro de la transaccion pasa en verde, lo que significa que la
  // posicion —que es la decision entera— no estaba cubierta. Lo encontro una
  // revision moviendola y viendo que no rompia nada.
  it('cancelar: nada se invalida mientras la transaccion sigue abierta', async () => {
    const { servicio, cache, db } = crearServicio();

    let invalidadoDentro = false;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      invalidadoDentro = cache.invalidar.mock.calls.length > 0;
      return salida;
    });

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    expect(invalidadoDentro).toBe(false);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('cancelar: un aborto 40001 reintentado invalida UNA sola vez', async () => {
    // `cancelar` corre en Serializable con reintento igual que `crear`: el
    // cuerpo entero puede ejecutarse dos veces y el commit ocurrir una. Un
    // `incr` hecho desde dentro quedaria hecho igual, porque Redis no se
    // desanda con la transaccion de Postgres.
    const { servicio, cache, db } = crearServicio();

    let intentos = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      intentos += 1;
      const salida = await fn(db);
      if (intentos === 1) {
        throw Object.assign(new Error('could not serialize access'), { code: '40001' });
      }
      return salida;
    });

    await servicio.cancelar(ADMIN, 'reserva-1', 'RECUPERABLE');

    expect(intentos).toBe(2);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('crear: nada se invalida mientras la transaccion sigue abierta', async () => {
    const { servicio, cache, db } = crearServicio();

    let invalidadoDentro = false;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      invalidadoDentro = cache.invalidar.mock.calls.length > 0;
      return salida;
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(invalidadoDentro).toBe(false);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('crear: un aborto 40001 reintentado invalida UNA sola vez', async () => {
    // El caso que obliga a que la linea viva fuera: el cuerpo entero corre dos
    // veces, pero el commit ocurre una. Dentro de la transaccion, el `incr` del
    // intento abortado quedaria hecho igual, porque Redis no se desanda.
    const { servicio, cache, db } = crearServicio();

    let intentos = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      intentos += 1;
      const salida = await fn(db);
      if (intentos === 1) {
        throw Object.assign(new Error('could not serialize access'), { code: '40001' });
      }
      return salida;
    });

    await servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' });

    expect(intentos).toBe(2);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  // REASIGNAR, que es el sitio que trae la Task 6. Mover una reserva de turno no
  // toca un solo peso, pero mueve la OCUPACION: libera un lugar en un turno y
  // ocupa otro, y los dos turnos pueden estar en meses o salas distintos. Sin
  // esta invalidacion, el panel de ocupacion queda cinco minutos mostrando una
  // clase llena que ya no lo esta.
  it('reasignar invalida el cache del gimnasio del actor', async () => {
    const { servicio, cache, turno } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(cache.invalidar).toHaveBeenCalledWith('gym-1');
  });

  it('reasignar: nada se invalida mientras la transaccion sigue abierta', async () => {
    const { servicio, cache, turno, db } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    let invalidadoDentro = false;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      invalidadoDentro = cache.invalidar.mock.calls.length > 0;
      return salida;
    });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(invalidadoDentro).toBe(false);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('reasignar: un aborto 40001 reintentado invalida UNA sola vez', async () => {
    // `reasignar` tambien corre en Serializable con reintento —el cupo del
    // destino es la misma carrera que en `crear`—, asi que el cuerpo entero
    // puede ejecutarse dos veces con un solo commit. Un `incr` de adentro
    // quedaria hecho igual, porque Redis no se desanda con Postgres.
    const { servicio, cache, turno, db } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 5 });

    let intentos = 0;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      intentos += 1;
      const salida = await fn(db);
      if (intentos === 1) {
        throw Object.assign(new Error('could not serialize access'), { code: '40001' });
      }
      return salida;
    });

    await servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' });

    expect(intentos).toBe(2);
    expect(cache.invalidar).toHaveBeenCalledTimes(1);
  });

  it('una reasignacion rechazada por falta de cupo no invalida nada', async () => {
    const { servicio, cache, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue({ ...TURNO, id: 'turno-2', cupo: 2 });
    reserva.count.mockResolvedValue(2); // el destino ya esta lleno

    await expect(servicio.reasignar(ADMIN, 'res-1', { turnoId: 'turno-2' })).rejects.toThrow(
      ConflictException,
    );

    expect(cache.invalidar).not.toHaveBeenCalled();
  });

  it('una reserva rechazada por falta de cupo no invalida nada', async () => {
    const { servicio, cache, reserva } = crearServicio();
    reserva.count.mockResolvedValue(2); // el turno tiene cupo 2

    await expect(servicio.crear(ADMIN, 'turno-1', { perfilId: 'perf-1' })).rejects.toThrow(
      ConflictException,
    );

    expect(cache.invalidar).not.toHaveBeenCalled();
  });
});

/**
 * Una fila de reserva tal y como la devuelve Prisma con el `include` del
 * nombre: la fila ENTERA de la tabla mas la relacion.
 *
 * Trae `tenantId`, `turnoId`, `createdAt` y `updatedAt` a proposito. Son los
 * campos que el mapeo a mano tiene que dejar fuera, y si el doble no los
 * tuviera, el caso de las claves exactas no distinguiria un mapeo de un spread.
 */
const FILA_DE_RESERVA = {
  ...RESERVA,
  asistio: null as boolean | null,
  perfil: { usuario: { nombreCompleto: 'Ana Perez' } },
};

const ORDEN_POR_NOMBRE = { perfil: { usuario: { nombreCompleto: 'asc' } } };

describe('listarDeTurno', () => {
  it('devuelve las reservas del turno con el nombre resuelto', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([FILA_DE_RESERVA]);

    const filas = await servicio.listarDeTurno('turno-1');

    expect(filas).toEqual([
      {
        id: 'res-1',
        perfilId: 'perf-1',
        nombreCompleto: 'Ana Perez',
        origen: 'ADMIN',
        esPrueba: false,
        pagoRealizado: false,
        asistio: null,
        canceladaEn: null,
        cancelacionTipo: null,
      },
    ]);
    expect(reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { turnoId: 'turno-1' } }),
    );
  });

  it('devuelve TAMBIEN las canceladas', async () => {
    // Un solo endpoint sirve a los dos usos; la pantalla las separa. Ver quien
    // cancelo recuperable es contexto que el admin quiere.
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([
      {
        ...FILA_DE_RESERVA,
        id: 'res-cancelada',
        canceladaEn: new Date('2026-10-09T12:30:00.000Z'),
        cancelacionTipo: 'RECUPERABLE',
      },
    ]);

    const filas = await servicio.listarDeTurno('turno-1');

    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      id: 'res-cancelada',
      canceladaEn: '2026-10-09T12:30:00.000Z',
      cancelacionTipo: 'RECUPERABLE',
    });

    // Y no solo sale en la respuesta: NO se le pide a la base que las filtre.
    // Sin esto, un `canceladaEn: null` en el `where` seguiria en verde mientras
    // el doble devolviera la cancelada igualmente.
    const [args] = reserva.findMany.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toEqual({ turnoId: 'turno-1' });
  });

  it('las claves de cada fila son EXACTAMENTE las del contrato', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([FILA_DE_RESERVA]);

    const [fila] = await servicio.listarDeTurno('turno-1');

    // LISTA BLANCA, no lista negra. El mapeo va campo por campo precisamente
    // para que ensanchar el `select` para depurar algo no se filtre a la
    // respuesta: un `select` es una promesa sobre la CONSULTA y el mapeo una
    // sobre la RESPUESTA, y solo la segunda sobrevive a ese dia.
    // OJO CON EL ORDEN: `.sort()` compara caracter a caracter, asi que
    // 'cancelacionTipo' va ANTES de 'canceladaEn' ('a' < 'e' en la septima
    // letra). Escribirlo "en orden alfabetico de palabra" deja el caso en rojo
    // con el codigo correcto.
    expect(Object.keys(fila).sort()).toEqual([
      'asistio',
      'cancelacionTipo',
      'canceladaEn',
      'esPrueba',
      'id',
      'nombreCompleto',
      'origen',
      'pagoRealizado',
      'perfilId',
    ]);
  });

  it('NO devuelve el tenantId ni el turnoId', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([FILA_DE_RESERVA]);

    const filas = await servicio.listarDeTurno('turno-1');

    // Dicho de frente y aparte de la lista blanca: son los dos campos que un
    // spread de la fila colaria, y el `tenantId` es el id interno de OTRO
    // gimnasio en cuanto alguien se equivoque de cliente de Prisma.
    expect(filas[0]).not.toHaveProperty('tenantId');
    expect(filas[0]).not.toHaveProperty('turnoId');
    expect(JSON.stringify(filas)).not.toContain('gym-1');
  });

  it('ordena por nombre', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([FILA_DE_RESERVA]);

    await servicio.listarDeTurno('turno-1');

    // Se comprueba el `orderBy` QUE SE LE PIDE A POSTGRES, no el orden del
    // array que devuelve el doble: el doble devuelve lo que le pongas, asi que
    // ordenar en el test seria autorreferencial. El orden de verdad lo prueba
    // el e2e con dos alumnos sembrados al reves.
    expect(reserva.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: ORDEN_POR_NOMBRE }),
    );
  });

  it('un turno inexistente da 404 y no una lista vacia', async () => {
    // Una lista vacia y "ese turno no existe" son cosas distintas, y el admin
    // que se equivoco de enlace tiene que poder distinguirlas.
    const { servicio, turno, reserva } = crearServicio();
    turno.findFirst.mockResolvedValue(null);

    await expect(servicio.listarDeTurno('turno-fantasma')).rejects.toThrow(NotFoundException);
    expect(reserva.findMany).not.toHaveBeenCalled();
  });

  it('un turno sin reservas da una lista vacia', async () => {
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([]);

    await expect(servicio.listarDeTurno('turno-1')).resolves.toEqual([]);
  });

  it('NO escribe los nombres de los alumnos en el log', async () => {
    // LA OTRA PUERTA POR LA QUE SALEN LOS DATOS DE UNA PERSONA. La lista blanca
    // de arriba cubre el CUERPO de la respuesta, que es la puerta que todo el
    // mundo mira. El log no: un `this.logger.log(...)` de depuracion con los
    // nombres resueltos deja los 60 unitarios y los 8 e2e en verde y manda los
    // nombres y apellidos de los alumnos de un gimnasio al agregador de logs,
    // que no esta aislado por inquilino y que guarda durante meses.
    //
    // SE INTERCEPTA LA SALIDA, NO EL `Logger`. Espiar `Logger.prototype.log`
    // dejaria pasar `logger.debug`, `console.log` o cualquier otro nombre, y
    // una defensa que depende de que nadie cambie una palabra es una defensa
    // que esta verde por casualidad. Por stdout/stderr pasan todas.
    const { servicio, reserva } = crearServicio();
    reserva.findMany.mockResolvedValue([
      { ...FILA_DE_RESERVA, perfil: { usuario: { nombreCompleto: 'Zoe Vera Quintanilla' } } },
    ]);

    const escrito: string[] = [];
    const capturar = (chunk: unknown): boolean => {
      escrito.push(String(chunk));
      return true;
    };
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(capturar);

    try {
      const filas = await servicio.listarDeTurno('turno-1');
      // La premisa, dicha en voz alta: el nombre TIENE que estar en los datos,
      // o este caso no estaria comprobando nada.
      expect(filas[0].nombreCompleto).toBe('Zoe Vera Quintanilla');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }

    expect(escrito.join('')).not.toContain('Zoe Vera');
  });
});
