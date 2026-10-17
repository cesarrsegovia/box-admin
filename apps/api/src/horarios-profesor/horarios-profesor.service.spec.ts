import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { HorariosProfesorService } from './horarios-profesor.service';

const ACTOR = { sub: 'admin-1', tenantId: 't1', rol: 'ADMIN_OPERATIVO' } as never;

const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

function baseDelAlta(parcial: Record<string, unknown> = {}) {
  return {
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: '2026-09-01',
    ...parcial,
  } as never;
}

/**
 * Doble de Prisma con lo justo. `horarioProfesorAsignado.findMany` filtra de
 * verdad por `diaSemana` y por el OR de sala/profesora, porque un doble que
 * ignora el filtro convierte los tests de solape en teatro: pasarian igual con
 * el filtro borrado del servicio.
 */
function prismaFalso(estado: {
  perfil?: Record<string, unknown> | null;
  /** A que salas tiene ACCESO la profesora. Todas existen; eso es otra cosa. */
  salas?: string[];
  horarios?: Record<string, unknown>[];
}) {
  const horarios = estado.horarios ?? [];

  const db = {
    perfil: {
      findFirst: jest.fn().mockResolvedValue(estado.perfil ?? null),
    },
    sala: {
      // Las salas del gimnasio existen todas. Que la profesora tenga acceso o no
      // es una pregunta distinta, y la contesta usuarioSala: un doble que las
      // mezclara haria que el test del acceso pasara por el motivo equivocado.
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve({ id: where.id, nombre: `Sala ${where.id}`, activa: true }),
        ),
    },
    usuarioSala: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where: { salaId: string } }) =>
          Promise.resolve(
            (estado.salas ?? ['sala-a']).includes(where.salaId) ? { salaId: where.salaId } : null,
          ),
        ),
    },
    horarioProfesorAsignado: {
      findMany: jest.fn().mockImplementation(({ where }: { where: Record<string, any> }) =>
        Promise.resolve(
          horarios.filter((h: any) => {
            if (where.diaSemana !== undefined && h.diaSemana !== where.diaSemana) return false;
            if (where.activo !== undefined && h.activo !== where.activo) return false;
            if (where.id?.not !== undefined && h.id === where.id.not) return false;
            if (where.OR) {
              const encaja = where.OR.some(
                (c: any) =>
                  (c.salaId !== undefined && c.salaId === h.salaId) ||
                  (c.profesorId !== undefined && c.profesorId === h.profesorId),
              );
              if (!encaja) return false;
            }
            return true;
          }),
        ),
      ),
      findFirst: jest.fn().mockResolvedValue({
        id: 'nuevo',
        profesorId: 'fati',
        salaId: 'sala-a',
        diaSemana: 1,
        horaInicio: '18:00',
        horaFin: '19:00',
        activo: true,
        desde: dia('2026-09-01'),
        hasta: null,
        tarifaPorHora: null,
        profesor: { usuario: { nombreCompleto: 'Fati' } },
        sala: { nombre: 'Sala A' },
      }),
      create: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'nuevo', activo: true, tarifaPorHora: null, ...data }),
        ),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(db)),
  };

  return db;
}

const historialFalso = { registrar: jest.fn().mockResolvedValue(undefined) } as never;

/**
 * El cache de reportes. Un horario mueve `tarifaPorHora` y los minutos de la
 * franja, o sea `costoProfesoras` y el `margen` de la caja: este servicio es el
 * octavo sitio de invalidacion de la Fase 6A.
 */
const cacheFalso = { invalidar: jest.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  cacheFalso.invalidar.mockClear();
});

const PROFESORA = { id: 'fati', usuario: { rol: 'PROFESOR', nombreCompleto: 'Fati' } };

describe('HorariosProfesorService.crear', () => {
  it('rechaza un perfil que no existe', async () => {
    const db = prismaFalso({ perfil: null });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);
  });

  it('rechaza un perfil que no es profesor', async () => {
    const db = prismaFalso({
      perfil: { id: 'fati', usuario: { rol: 'ALUMNO', nombreCompleto: 'Ana' } },
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(BadRequestException);
  });

  it('rechaza una sala a la que la profesora no tiene acceso', async () => {
    // Sin esta puerta, la profesora acabaria con un turno en una sala que no
    // puede ni ver, y las dos mitades del sistema dirian cosas distintas sobre
    // la misma clase.
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta({ salaId: 'sala-b' }))).rejects.toThrow(
      /acceso a la sala/i,
    );
  });

  it('rechaza horaFin anterior a horaInicio', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ horaInicio: '19:00', horaFin: '18:00' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('rechaza hasta anterior a desde', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-09-30', hasta: '2026-09-01' })),
    ).rejects.toThrow(BadRequestException);
  });

  it('409 si otra profesora ya cubre esa sala, dia y hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('409 aunque solo se pisen media hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:30',
          horaFin: '19:30',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(ConflictException);
  });

  it('deja pasar dos clases seguidas en la misma sala', async () => {
    // 18:00-19:00 y 19:00-20:00 son consecutivas, no simultaneas.
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '19:00',
          horaFin: '20:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });

  it('deja pasar el relevo: uno termina y el otro empieza despues', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: dia('2026-09-30'),
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(
      servicio.crear(ACTOR, baseDelAlta({ desde: '2026-10-01' })),
    ).resolves.toMatchObject({ profesorId: 'fati' });
  });

  it('409 si la MISMA profesora ya esta en otra sala a esa hora', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      salas: ['sala-a', 'sala-b'],
      horarios: [
        {
          id: 'h-otra',
          profesorId: 'fati',
          salaId: 'sala-b',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).rejects.toThrow(/dos salas a la vez/i);
  });

  it('ignora los horarios dados de baja', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-09-01'),
          hasta: null,
          activo: false,
        },
      ],
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(servicio.crear(ACTOR, baseDelAlta())).resolves.toMatchObject({
      profesorId: 'fati',
    });
  });
});

/**
 * LA REACTIVACION, Y POR QUE NO ES «DEJAR PASAR EL NULL».
 *
 * `eliminar` da de baja Y ADEMAS cierra el `hasta` en hoy. Mientras el PATCH no
 * supo poner `hasta` en nulo, un horario reactivado se quedaba con ese `hasta`
 * de hoy: aparecia como vigente y dejaba de etiquetar turnos a partir de
 * manana, en silencio, porque la API contesta 200.
 *
 * Los tres estados se prueban SEMBRANDO UNA FECHA, nunca `null`. Con el
 * existente ya en `null`, «lo dejo como estaba» y «lo puso en nulo» escriben lo
 * mismo y el par de tests no distingue nada.
 */
describe('HorariosProfesorService.actualizar: los tres estados de `hasta`', () => {
  const VIGENTE_HASTA_SEPTIEMBRE = {
    id: 'h1',
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: dia('2026-09-01'),
    // Una FECHA, no null: es lo que hace que los dos tests de abajo se
    // distingan. Sembrado en null, los dos verian `hasta` sin tocar y el par
    // pasaria igual con el `dto.hasta ? … : existente.hasta` de vuelta.
    hasta: dia('2026-09-30'),
    activo: false,
    tarifaPorHora: null,
  };

  function servicioCon(existente: Record<string, unknown>): {
    servicio: HorariosProfesorService;
    db: ReturnType<typeof prismaFalso>;
  } {
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(existente);
    return {
      servicio: new HorariosProfesorService({ db } as never, historialFalso, cacheFalso as never),
      db,
    };
  }

  it('`hasta: null` explicito VACIA la vigencia', async () => {
    const { servicio, db } = servicioCon(VIGENTE_HASTA_SEPTIEMBRE);

    await servicio.actualizar(ACTOR, 'h1', { activo: true, hasta: null } as never);

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.hasta).toBeNull();
    // Y no `undefined`, que para Prisma es «no toques la columna» y dejaria la
    // fila con el 30 de septiembre que se venia a borrar.
    expect(datos.hasta).not.toBeUndefined();
  });

  it('la clave AUSENTE conserva la vigencia que ya habia', async () => {
    const { servicio, db } = servicioCon(VIGENTE_HASTA_SEPTIEMBRE);

    await servicio.actualizar(ACTOR, 'h1', { activo: true } as never);

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.hasta).toBeUndefined();
    expect(datos.hasta).not.toBeNull();
  });

  it('una fecha fija la vigencia en esa fecha', async () => {
    const { servicio, db } = servicioCon(VIGENTE_HASTA_SEPTIEMBRE);

    await servicio.actualizar(ACTOR, 'h1', { activo: true, hasta: '2026-12-31' } as never);

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.hasta).toEqual(dia('2026-12-31'));
  });

  /**
   * LA VIGENCIA AUSENTE ES LA QUE VIAJA A LA COMPROBACION DE SOLAPE, no un
   * null. `exigirSinSolape` decide con `rangosSeSolapan(desde, hasta, …)`: si
   * la rama de «no vino la clave» le pasara `null`, un horario cuya vigencia
   * termino en septiembre chocaria con uno de octubre y el PATCH daria un 409
   * que no corresponde.
   */
  it('lo que ve el solape cuando la clave no vino es la vigencia vieja', async () => {
    // El rival ocupa la franja DESDE OCTUBRE. El existente termina el 30 de
    // septiembre, asi que no se tocan... mientras la rama de «clave ausente»
    // le pase al solape ESA vigencia. Si le pasara `null`, el existente
    // pasaria a ser indefinido, los dos rangos se solaparian y esto seria un
    // 409. El mismo escenario con `hasta: null` explicito es el test de abajo,
    // y da 409: ese par es lo que prueba que la rama se eligio bien.
    const db = prismaFalso({
      perfil: PROFESORA,
      salas: ['sala-a'],
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-10-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(VIGENTE_HASTA_SEPTIEMBRE);
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await servicio.actualizar(ACTOR, 'h1', { activo: true } as never);

    expect(db.horarioProfesorAsignado.update).toHaveBeenCalled();
  });

  /**
   * EL CASO QUE IMPORTA: mientras estuvo de baja, OTRA profesora ocupo la
   * franja. Reactivar vuelve a pasar por `exigirSinSolape` porque `activo`
   * queda en `true`, y tiene que rebotar con el texto del choque que toca —el
   * de «otra profesora en esa sala», que es el que dice QUE cambiar—.
   */
  it('un horario reactivado que ahora choca con otro se rechaza', async () => {
    const db = prismaFalso({
      perfil: PROFESORA,
      salas: ['sala-a'],
      horarios: [
        {
          id: 'h-ana',
          profesorId: 'ana',
          salaId: 'sala-a',
          diaSemana: 1,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: dia('2026-10-01'),
          hasta: null,
          activo: true,
        },
      ],
    });
    // MISMA SEMILLA que el test de arriba, a proposito: lo unico que cambia
    // entre los dos es el `hasta: null` del cuerpo. Uno pasa y el otro da 409.
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(VIGENTE_HASTA_SEPTIEMBRE);
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await expect(
      servicio.actualizar(ACTOR, 'h1', { activo: true, hasta: null } as never),
    ).rejects.toThrow(
      'Ya hay otra profesora asignada a esa sala en ese dia y hora. ' +
        'Un turno tiene una sola profesora, asi que dos horarios que se pisan ' +
        'no se pueden resolver.',
    );

    // Y no escribio nada: el 409 sale de dentro de la transaccion.
    expect(db.horarioProfesorAsignado.update).not.toHaveBeenCalled();
  });

  /**
   * EL NULL ES «INDEFINIDO» Y NO TIENE QUE CHOCAR CON `exigirFechasCoherentes`.
   *
   * Esa funcion compara `hasta` contra `desde`; con la vigencia vacia no hay
   * nada que comparar, y un `null.getTime()` seria un 500. Se ejercita con un
   * `desde` NUEVO para que la comparacion tenga de verdad los dos lados en
   * juego.
   */
  it('vaciar la vigencia y mover el desde a la vez no revienta la coherencia', async () => {
    const { servicio, db } = servicioCon(VIGENTE_HASTA_SEPTIEMBRE);

    await servicio.actualizar(ACTOR, 'h1', {
      activo: true,
      desde: '2026-11-01',
      hasta: null,
    } as never);

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.desde).toEqual(dia('2026-11-01'));
    expect(datos.hasta).toBeNull();
  });

  it('un hasta anterior al desde sigue siendo 400 al actualizar', async () => {
    const { servicio } = servicioCon(VIGENTE_HASTA_SEPTIEMBRE);

    await expect(
      servicio.actualizar(ACTOR, 'h1', { desde: '2026-11-01', hasta: '2026-10-01' } as never),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('HorariosProfesorService.eliminar', () => {
  /**
   * ESTA ES LA PREMISA DE LA PANTALLA DE REACTIVAR. Si alguien le quita el
   * cierre del `hasta` al DELETE, reactivar deja de hacer falta y la pantalla
   * que pide la vigencia de nuevo pasa a mentir sobre lo que se perdio.
   */
  it('da de baja y ademas cierra el hasta abierto, sin borrar la fila', async () => {
    // La liquidacion mira desde/hasta y NO activo: cerrar el hasta es lo que
    // hace que borrar un horario no reescriba los meses ya liquidados.
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-09-01'),
      hasta: null,
      activo: true,
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    /**
     * EL RELOJ, CLAVADO. `toBeInstanceOf(Date)` dejaba pasar cualquier fecha:
     * un cierre en el 2099 es tan `Date` como el de hoy y no cerraria nada. La
     * fecha esperada se escribe A MANO y no con `desdeFechaISO(aFechaISO(...))`,
     * que seria comparar la salida contra la misma funcion que la produce.
     */
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-16T09:00:00.000Z'));

    try {
      await servicio.eliminar(ACTOR, 'h1');
    } finally {
      jest.useRealTimers();
    }

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toEqual(new Date('2026-10-16T00:00:00.000Z'));
  });

  it('no toca un hasta que ya estaba en el pasado', async () => {
    const db = prismaFalso({ perfil: PROFESORA });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue({
      id: 'h1',
      profesorId: 'fati',
      salaId: 'sala-a',
      desde: dia('2026-01-01'),
      hasta: dia('2026-01-31'),
      activo: true,
    });
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await servicio.eliminar(ACTOR, 'h1');

    const datos = db.horarioProfesorAsignado.update.mock.calls[0]![0].data;
    expect(datos.activo).toBe(false);
    expect(datos.hasta).toBeUndefined();
  });
});

/**
 * LO QUE ESTE SERVICIO ESCRIBE EN LA AUDITORIA, Y NADA MAS.
 *
 * NINGUN TEST DE ESTE ARCHIVO MIRABA EL HISTORIAL: `historialFalso` era un
 * mock que nadie interrogaba, asi que el `detalle` de las tres operaciones
 * estaba sin vigilar entero. Un `detalle: { ...dto, anterior: existente }`
 * —«para poder deshacer una reactivacion, dejemos como estaba la fila»—
 * sobrevivia a los 1335 tests de la API, a los 218 e2e, a eslint y a tsc.
 *
 * Y NO ES UN CANAL INOCENTE. `historial.service.ts` ya lo dice por escrito para
 * ConfiguracionSMTP: «el historial es la otra puerta por la que se escaparia,
 * porque lo lee el mismo admin por otra ruta». Lo que entra por ahi sale. La
 * fila de un horario lleva `tenantId` y lleva `tarifaPorHora`, que es lo que el
 * gimnasio le paga por hora a esa profesora.
 *
 * SE AFIRMA CON `toEqual` SOBRE EL OBJETO ENTERO, no con un `not.toContain`
 * sobre la palabra «tenantId»: esa defensa depende de que nadie renombre el
 * campo, y el dia que la fila traiga un dato nuevo —el email de la profesora,
 * la tarifa resuelta— no se entera nadie. La igualdad exacta rompe con una
 * clave de mas se llame como se llame.
 */
describe('HorariosProfesorService: lo que llega al historial', () => {
  /** Centinelas: si alguno aparece en el detalle, se escapo por la fila. */
  const TENANT_CENTINELA = 'tnt-no-deberia-estar';
  const TARIFA_CENTINELA = { toFixed: () => '1777.77' };

  const EXISTENTE = {
    id: 'h1',
    tenantId: TENANT_CENTINELA,
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: dia('2026-09-01'),
    hasta: dia('2026-09-30'),
    activo: false,
    tarifaPorHora: TARIFA_CENTINELA,
  };

  function servicioDe(db: ReturnType<typeof prismaFalso>): HorariosProfesorService {
    return new HorariosProfesorService({ db } as never, historialFalso, cacheFalso as never);
  }

  const registrar = (historialFalso as unknown as { registrar: jest.Mock }).registrar;

  beforeEach(() => {
    registrar.mockClear();
  });

  function entradaRegistrada(indice = 0): Record<string, unknown> {
    const entrada = registrar.mock.calls[indice]?.[0] as Record<string, unknown> | undefined;
    if (entrada === undefined) throw new Error(`No hubo entrada de historial numero ${indice}`);

    return entrada;
  }

  it('reactivar audita SOLO lo que el admin mando, y una sola entrada', async () => {
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(EXISTENTE);

    await servicioDe(db).actualizar(ACTOR, 'h1', {
      activo: true,
      desde: '2026-11-01',
      hasta: null,
    } as never);

    const entrada = entradaRegistrada();
    expect(entrada.entidad).toBe('HorarioProfesorAsignado');
    expect(entrada.entidadId).toBe('h1');
    expect(entrada.accion).toBe('ACTUALIZADA');
    expect(entrada.detalle).toEqual({ activo: true, desde: '2026-11-01', hasta: null });

    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it('el alta audita los cuatro campos elegidos, ni uno mas', async () => {
    // El detalle del alta es un SUBCONJUNTO a proposito: no lleva la tarifa.
    // Fijarlo entero es lo que impide que se le sume «de paso».
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });

    await servicioDe(db).crear(ACTOR, baseDelAlta({ tarifaPorHora: '1500.00' }));

    expect(entradaRegistrada().detalle).toEqual({
      profesorId: 'fati',
      salaId: 'sala-a',
      diaSemana: 1,
      horaInicio: '18:00',
    });
  });

  it('la baja audita SIN detalle: no hay nada que el admin haya elegido', async () => {
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(EXISTENTE);

    await servicioDe(db).eliminar(ACTOR, 'h1');

    const entrada = entradaRegistrada();
    expect(entrada.accion).toBe('DADA_DE_BAJA');
    expect(entrada.detalle).toBeUndefined();
    // La clave tampoco esta: un `detalle: undefined` serializado seria una
    // puerta abierta esperando a que alguien la rellene.
    expect('detalle' in entrada).toBe(false);
  });

  /**
   * Y LOS CENTINELAS, dichos aparte de la igualdad exacta: explican QUE se
   * estaba protegiendo. Si alguien relaja los `toEqual` de arriba a un
   * `toMatchObject`, esto todavia caza la fuga del dinero y del gimnasio.
   */
  it('ni el tenantId ni la tarifa de la fila se escapan por el detalle', async () => {
    const db = prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(EXISTENTE);

    await servicioDe(db).actualizar(ACTOR, 'h1', { activo: true, hasta: null } as never);

    const serializado = JSON.stringify(entradaRegistrada().detalle);
    expect(serializado).not.toContain(TENANT_CENTINELA);
    expect(serializado).not.toContain('1777.77');
  });
});

/**
 * LA INVALIDACION DEL CACHE DE REPORTES — EL OCTAVO SITIO.
 *
 * El plan de la Fase 6A listaba siete y este no estaba. Un horario de profesora
 * lleva `tarifaPorHora` y define los minutos de cada franja, y las dos cosas
 * entran directo en `calcularLiquidacion` -> `importes.aPagar` ->
 * `costoProfesoras` -> `margen`. Sin esto, subirle la tarifa a alguien dejaba
 * la caja ensenando el margen de la tarifa vieja hasta que venciera el TTL, que
 * es exactamente la llamada de soporte que el contador de version existe para
 * que no ocurra.
 */
describe('HorariosProfesorService invalida el cache DESPUES del commit', () => {
  const conProfesora = (): ReturnType<typeof prismaFalso> =>
    prismaFalso({ perfil: PROFESORA, salas: ['sala-a'] });

  const horarioExistente = {
    id: 'h1',
    profesorId: 'fati',
    salaId: 'sala-a',
    diaSemana: 1,
    horaInicio: '18:00',
    horaFin: '19:00',
    desde: dia('2026-09-01'),
    hasta: null,
    activo: true,
    // `actualizar` termina llamando a `obtener`, que mapea la fila entera.
    tarifaPorHora: null,
  };

  it('crear invalida el cache del gimnasio del actor', async () => {
    const db = conProfesora();
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await servicio.crear(ACTOR, baseDelAlta());

    expect(cacheFalso.invalidar).toHaveBeenCalledWith('t1');
  });

  it('actualizar invalida: ahi es donde cambia la tarifa', async () => {
    const db = conProfesora();
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(horarioExistente);
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await servicio.actualizar(ACTOR, 'h1', { tarifaPorHora: '2500.00' } as never);

    expect(cacheFalso.invalidar).toHaveBeenCalledWith('t1');
  });

  it('eliminar invalida: cierra el hasta y con el las horas contratadas', async () => {
    const db = conProfesora();
    db.horarioProfesorAsignado.findFirst = jest.fn().mockResolvedValue(horarioExistente);
    const servicio = new HorariosProfesorService(
      { db } as never,
      historialFalso,
      cacheFalso as never,
    );

    await servicio.eliminar(ACTOR, 'h1');

    expect(cacheFalso.invalidar).toHaveBeenCalledWith('t1');
  });

  it('nada se invalida mientras la transaccion sigue abierta', async () => {
    const db = conProfesora();

    let invalidadoDentro = false;
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const salida = await fn(db);
      invalidadoDentro = cacheFalso.invalidar.mock.calls.length > 0;
      return salida;
    });

    await servicioDe(db).crear(ACTOR, baseDelAlta());

    expect(invalidadoDentro).toBe(false);
    expect(cacheFalso.invalidar).toHaveBeenCalledTimes(1);
  });

  it('un alta rechazada no invalida nada', async () => {
    const db = prismaFalso({ perfil: null });

    await expect(servicioDe(db).crear(ACTOR, baseDelAlta())).rejects.toThrow(NotFoundException);

    expect(cacheFalso.invalidar).not.toHaveBeenCalled();
  });

  function servicioDe(db: ReturnType<typeof prismaFalso>): HorariosProfesorService {
    return new HorariosProfesorService({ db } as never, historialFalso, cacheFalso as never);
  }
});
