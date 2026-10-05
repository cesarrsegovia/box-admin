import { ConflictException, NotFoundException } from '@nestjs/common';
import { CheckinService } from './checkin.service';
import { firmarTenant } from './firma-qr';

const CLAVE = 'a'.repeat(64);
const ZONA = 'America/Argentina/Buenos_Aires';
const ACTOR = { sub: 'u-1', tenantId: 't1', rol: 'ALUMNO' } as never;
const FIRMA = firmarTenant('t1', CLAVE);

/** 5 de octubre de 2026. La columna `@db.Date` vuelve a medianoche UTC. */
const DIA = new Date('2026-10-05T00:00:00.000Z');
/** Las 18:00 en Buenos Aires. El caso que esta fase existe para arreglar. */
const A_LAS_18_DE_ALLA = new Date('2026-10-05T21:00:00.000Z');
const MARCADA_EN = new Date('2026-10-05T21:02:33.000Z');

const RASTRO = { ip: '203.0.113.9', dispositivo: 'Mozilla/5.0 (iPhone)' };

function filaDeReserva(parcial: Record<string, unknown> = {}) {
  return {
    id: 'r-1',
    turnoId: 'tu-1',
    asistio: null,
    turno: { nombre: 'Pilates', fecha: DIA, horaInicio: '18:00' },
    asistencia: null,
    ...parcial,
  };
}

interface OpcionesDelDoble {
  reservas?: Record<string, unknown>[];
  perfil?: { id: string } | null;
  ventana?: { minutosAntes: number; minutosDespues: number };
  /** Lo que lanza el `create` de Asistencia, si tiene que lanzar. */
  falloAlCrear?: unknown;
}

/**
 * El doble de la base entrega en `$transaction` un cliente DISTINTO del suelto.
 *
 * Es lo que hace comprobable "las dos escrituras van en la misma transaccion":
 * si el service escribiera `asistio` por `db.reserva.update` en vez de por
 * `tx.reserva.update`, el doble lo registra en otro contador y el test lo ve.
 * Con un `$transaction` que devolviera el mismo objeto, la mutacion de sacar la
 * escritura de la transaccion seria invisible.
 */
function crearServicio(opciones: OpcionesDelDoble = {}) {
  const tx = {
    reserva: { update: jest.fn().mockResolvedValue({}) },
    asistencia: {
      create: jest
        .fn()
        .mockImplementation(() =>
          opciones.falloAlCrear === undefined
            ? Promise.resolve({ marcadaEn: MARCADA_EN })
            : Promise.reject(opciones.falloAlCrear),
        ),
    },
  };

  const db = {
    perfil: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opciones.perfil === undefined ? { id: 'p-1' } : opciones.perfil),
    },
    reserva: {
      findMany: jest.fn().mockResolvedValue(opciones.reservas ?? [filaDeReserva()]),
      // Los sueltos existen para poder afirmar que NO se usaron.
      update: jest.fn(),
    },
    asistencia: { create: jest.fn() },
    $transaction: jest.fn().mockImplementation((fn: (cliente: unknown) => unknown) => fn(tx)),
  };

  const configCheckIn = {
    ver: jest.fn().mockResolvedValue(opciones.ventana ?? { minutosAntes: 15, minutosDespues: 15 }),
  };

  const entorno: Record<string, string> = { APP_ENCRYPTION_KEY: CLAVE, ZONA_HORARIA: ZONA };
  const config = { getOrThrow: jest.fn((clave: string) => entorno[clave]) };

  return {
    servicio: new CheckinService({ db } as never, configCheckIn as never, config as never),
    db,
    tx,
    configCheckIn,
  };
}

/** El cuerpo de un 409, que es un objeto y no un string. */
function cuerpoDe(error: unknown): Record<string, unknown> {
  return (error as ConflictException).getResponse() as Record<string, unknown>;
}

describe('CheckinService.marcarPresente', () => {
  it('marca presente a la hora de la clase y devuelve los datos del turno', async () => {
    const { servicio } = crearServicio();

    const marcado = await servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA);

    expect(marcado).toEqual({
      reservaId: 'r-1',
      turnoId: 'tu-1',
      fecha: '2026-10-05',
      horaInicio: '18:00',
      // `clase` sale de Turno.nombre: la columna se llama `nombre`, y "clase"
      // es como se le dice de cara al alumno.
      clase: 'Pilates',
      marcadaEn: MARCADA_EN.toISOString(),
    });
  });

  /**
   * LA VENTANA SE CALCULA EN LA ZONA DEL GIMNASIO. El test de la funcion pura
   * ya lo fija; este fija el CABLEADO: que la zona salga de ZONA_HORARIA y
   * llegue hasta `elegirReserva`. Con la ventana en UTC, las 21:00 UTC caerian
   * tres horas fuera de [17:45, 18:15] y esto seria un 409.
   */
  it('la ventana sale de ZONA_HORARIA, no de UTC', async () => {
    const { servicio } = crearServicio();

    await expect(
      servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA),
    ).resolves.toMatchObject({ horaInicio: '18:00' });

    // Y a las 18:00 UTC —que en el gimnasio son las 15:00— no se puede.
    const otro = crearServicio();
    await expect(
      otro.servicio.marcarPresente(ACTOR, FIRMA, RASTRO, new Date('2026-10-05T18:00:00.000Z')),
    ).rejects.toThrow(ConflictException);
  });

  it('escribe `asistio` y la fila de Asistencia en la MISMA transaccion', async () => {
    const { servicio, db, tx } = crearServicio();

    await servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA);

    expect(tx.reserva.update).toHaveBeenCalledWith({
      where: { id: 'r-1' },
      data: { asistio: true },
    });
    expect(tx.asistencia.create).toHaveBeenCalledTimes(1);
    // Lo que hace caer la mutacion: ni una de las dos por el cliente suelto.
    expect(db.reserva.update).not.toHaveBeenCalled();
    expect(db.asistencia.create).not.toHaveBeenCalled();
  });

  it('un fallo al crear la Asistencia aborta: no queda un presente sin evidencia', async () => {
    const { servicio, db } = crearServicio({ falloAlCrear: new Error('la base se cayo') });

    await expect(servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)).rejects.toThrow(
      'la base se cayo',
    );

    // El `asistio` se escribio DENTRO de la transaccion que acaba de fallar, y
    // por eso se desanda. Si estuviera fuera, esta llamada seria la prueba de
    // que quedo escrito.
    expect(db.reserva.update).not.toHaveBeenCalled();
  });

  it('guarda la IP y el aparato que vinieron del request', async () => {
    const { servicio, tx } = crearServicio();

    await servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA);

    expect(tx.asistencia.create.mock.calls[0]![0].data).toMatchObject({
      origen: 'QR',
      ip: '203.0.113.9',
      dispositivo: 'Mozilla/5.0 (iPhone)',
    });
  });

  it('recorta un User-Agent absurdo en vez de guardarlo entero', async () => {
    const { servicio, tx } = crearServicio();

    await servicio.marcarPresente(
      ACTOR,
      FIRMA,
      { ip: null, dispositivo: 'x'.repeat(5000) },
      A_LAS_18_DE_ALLA,
    );

    expect((tx.asistencia.create.mock.calls[0]![0].data.dispositivo as string).length).toBe(512);
  });

  it('solo mira reservas vivas, y de tres dias UTC alrededor', async () => {
    const { servicio, db } = crearServicio();

    await servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA);

    const where = db.reserva.findMany.mock.calls[0]![0].where;
    expect(where.perfilId).toBe('p-1');
    // Una reserva cancelada no se marca presente.
    expect(where.canceladaEn).toBeNull();
    // Ayer y mañana entran: la clase de las 23:00 de un gimnasio en Argentina
    // cae en el dia UTC siguiente, y filtrar por "hoy UTC" la perderia.
    expect(where.turno.fecha.gte).toEqual(new Date('2026-10-04T00:00:00.000Z'));
    expect(where.turno.fecha.lte).toEqual(new Date('2026-10-06T00:00:00.000Z'));
  });
});

describe('CheckinService.marcarPresente, los rechazos', () => {
  it('la firma de OTRO gimnasio da 404, no 403', async () => {
    // Un 403 diria "esa firma es buena, pero no es tuya", o sea confirmaria
    // que ese gimnasio existe. Con 404 no hay nada que enumerar.
    const { servicio } = crearServicio();
    const ajena = firmarTenant('otro-gym', CLAVE);

    const error = await servicio
      .marcarPresente(ACTOR, ajena, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getStatus()).toBe(404);
  });

  it('una firma inventada tampoco pasa, y no llega a tocar la base', async () => {
    const { servicio, db } = crearServicio();

    await expect(
      servicio.marcarPresente(ACTOR, 'no-es-una-firma', RASTRO, A_LAS_18_DE_ALLA),
    ).rejects.toThrow(NotFoundException);
    expect(db.perfil.findFirst).not.toHaveBeenCalled();
    expect(db.reserva.findMany).not.toHaveBeenCalled();
  });

  it('sin ninguna reserva, 409 con motivo "sin-reserva"', async () => {
    const { servicio } = crearServicio({ reservas: [] });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(cuerpoDe(error).motivo).toBe('sin-reserva');
  });

  it('fuera de ventana, 409 diciendo cual era la clase y a que hora', async () => {
    const { servicio } = crearServicio();

    // Las 16:00 de alla: tres horas antes de que la ventana se abra.
    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, new Date('2026-10-05T19:00:00.000Z'))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(cuerpoDe(error)).toMatchObject({
      motivo: 'fuera-de-ventana',
      clase: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
    });
  });

  it('el segundo check-in da 409 "ya-marcada", no un segundo presente', async () => {
    const { servicio, tx } = crearServicio({
      // El estado real tras un check-in: las DOS marcas escritas.
      reservas: [filaDeReserva({ asistencia: { id: 'a-1' }, asistio: true })],
    });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(cuerpoDe(error).motivo).toBe('ya-marcada');
    expect(tx.asistencia.create).not.toHaveBeenCalled();
  });

  /**
   * LA RED DEL @@unique. Entre comprobar `yaMarcada` y escribir hay una
   * ventana: dos escaneos simultaneos pasan los dos la comprobacion y uno
   * choca contra el indice. El usuario no tiene por que ver la diferencia.
   */
  it('dos escaneos a la vez: el P2002 sale como el MISMO 409', async () => {
    const { servicio } = crearServicio({
      falloAlCrear: Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(cuerpoDe(error).motivo).toBe('ya-marcada');
  });

  it('tambien cuando el P2002 llega envuelto por el driver adapter', async () => {
    // Con el adapter `pg` de Prisma 7 el error no siempre trae `code`: lo
    // traduce a `{ kind }` dentro de un DriverAdapterError. Mirar solo `code`
    // dejaba el reintento de serializacion sin dispararse en la Fase 1.
    const { servicio } = crearServicio({
      falloAlCrear: Object.assign(new Error('x'), {
        name: 'DriverAdapterError',
        cause: { kind: 'UniqueConstraintViolation' },
      }),
    });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(cuerpoDe(error).motivo).toBe('ya-marcada');
  });

  /**
   * LA PROFESORA MANDA, visto desde el service. Lo que hay que comprobar, y
   * por lo que no vale reusar `ya-marcada`: el motivo es distinguible y NO se
   * escribe nada.
   */
  it('con la lista ya pasada, 409 "lista-ya-pasada" y no se escribe nada', async () => {
    const { servicio, tx, db } = crearServicio({
      // La profesora la puso AUSENTE: `asistio` no es null, y no hay fila de
      // Asistencia porque pasar lista no deja una.
      reservas: [filaDeReserva({ asistio: false, asistencia: null })],
    });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConflictException);
    expect(cuerpoDe(error)).toMatchObject({
      motivo: 'lista-ya-pasada',
      clase: 'Pilates',
      fecha: '2026-10-05',
      horaInicio: '18:00',
    });
    // El parte de la profesora queda como ella lo dejo.
    expect(tx.reserva.update).not.toHaveBeenCalled();
    expect(tx.asistencia.create).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('el mensaje de "lista-ya-pasada" manda a la profesora, no dice "ya marcaste"', async () => {
    // Decirle "ya marcaste" a quien no marco lo manda a buscar un problema que
    // no existe. Lo que tiene que hacer es hablar con quien puede corregirlo.
    const { servicio } = crearServicio({ reservas: [filaDeReserva({ asistio: true })] });

    const error = await servicio
      .marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)
      .catch((e: unknown) => e);

    expect(cuerpoDe(error).message).toMatch(/profesora/);
    expect(cuerpoDe(error).message).not.toMatch(/[Yy]a habias marcado/);
  });

  it('un usuario sin perfil de alumno recibe 404', async () => {
    const { servicio } = crearServicio({ perfil: null });

    await expect(servicio.marcarPresente(ACTOR, FIRMA, RASTRO, A_LAS_18_DE_ALLA)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('con la primera clase ya marcada se marca la segunda, no se rechaza', async () => {
    // El orden del algoritmo visto desde el service: `yaMarcada` se mira
    // DESPUES de elegir. Dos clases pegadas y ventana de 45 minutos.
    const { servicio } = crearServicio({
      ventana: { minutosAntes: 45, minutosDespues: 45 },
      reservas: [
        filaDeReserva({ id: 'r-18', asistencia: { id: 'a-1' }, asistio: true }),
        filaDeReserva({
          id: 'r-19',
          turnoId: 'tu-19',
          turno: { nombre: 'Funcional', fecha: DIA, horaInicio: '19:00' },
        }),
      ],
    });

    // 18:40 de alla.
    const marcado = await servicio.marcarPresente(
      ACTOR,
      FIRMA,
      RASTRO,
      new Date('2026-10-05T21:40:00.000Z'),
    );

    expect(marcado).toMatchObject({ reservaId: 'r-19', clase: 'Funcional' });
  });
});
