import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DatosNotificacionListaEspera } from './colas';
import { NotificacionListaEsperaProcessor } from './notificacion-lista-espera.processor';

type Fila = Record<string, any>;
type JobDeTest = Job<DatosNotificacionListaEspera>;

const GIMNASIO = { id: 'gym-1', nombre: 'Box Fuego', slug: 'box-fuego' };

const ANA = {
  id: 'perfil-ana',
  tenantId: 'gym-1',
  usuario: { nombreCompleto: 'Ana', email: 'ana@correo.test', activo: true },
};

const BETO = {
  id: 'perfil-beto',
  tenantId: 'gym-1',
  usuario: { nombreCompleto: 'Beto', email: 'beto@correo.test', activo: true },
};

const ANA_DE_BAJA = { ...ANA, usuario: { ...ANA.usuario, activo: false } };

const TURNO = {
  id: 'turno-1',
  tenantId: 'gym-1',
  nombre: 'Pilates',
  // Columna @db.Date: Prisma la devuelve a medianoche UTC.
  fecha: new Date('2026-10-07T00:00:00.000Z'),
  horaInicio: '18:00',
};

const CANCELADA = new Date('2026-10-02T09:00:00.000Z');

/** Una reserva como la que deja `asignarPrimero`: origen LISTA_ESPERA y viva. */
function cupoDe(perfilId: string, extra: Fila = {}): Fila {
  return {
    id: `reserva-${perfilId}`,
    tenantId: 'gym-1',
    turnoId: 'turno-1',
    perfilId,
    origen: 'LISTA_ESPERA',
    canceladaEn: null,
    // LAS TRES MARCAS, EXPLICITAS Y EN null. No es decoracion del fixture: el
    // compare-and-set del processor filtra por `avisoCupoEn: null`, y una fila a
    // la que le falte el campo no lo cumple —`undefined !== null`—. Que esten
    // aqui es lo que hace que el doble emule el CAS y no otra cosa.
    avisoConfirmacionEn: null,
    avisoCancelacionEn: null,
    avisoCupoEn: null,
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    ...extra,
  };
}

interface Escenario {
  reservas?: Fila[];
  perfiles?: Fila[];
  turnos?: Fila[];
  /** Lo que trae el payload del job, sobre los valores por defecto. */
  job?: Partial<DatosNotificacionListaEspera>;
  /** Cuantas veces revienta el `updateMany` de la marca antes de funcionar. */
  fallosAlMarcar?: number;
  /**
   * Rompe el doble de Prisma A PROPOSITO: le quita el `perfilId` al where de la
   * reserva, que es exactamente el futuro que el processor dice temer —alguien
   * afloja ese where y la consulta empieza a devolver la reserva de OTRO alumno
   * del mismo turno—. Sirve para comprobar que el destinatario no se arma a
   * medias entre la fila encontrada y el payload; sin el, los dos perfilId
   * valen lo mismo y el test no puede distinguir nada.
   */
  whereLaxo?: boolean;
}

/**
 * Monta el processor con sus dos dobles.
 *
 * El de PRISMA emula la extension de aislamiento, no solo la interfaz: exige
 * contexto de tenant y filtra por el. Es lo que convierte "abre el contexto
 * antes de consultar" en algo que el test comprueba de verdad — sin eso, un
 * processor que olvidara `runWithTenant` pasaria en verde aqui y reventaria con
 * `MissingTenantContextError` la primera vez que corriera.
 *
 * Y el doble de Prisma EMULA EL COMPARE-AND-SET de verdad: `updateMany` filtra,
 * escribe y cuenta en el mismo turno del event loop —su cuerpo no tiene ni un
 * `await` dentro—, que es exactamente la garantia que da un UPDATE de Postgres
 * sobre una fila. Sin esa propiedad, el test de los dos workers simultaneos no
 * probaria nada.
 *
 * El del JOB ya no guarda ninguna marca: desde que la idempotencia vive en
 * `Reserva.avisoCupoEn`, `updateData` no tiene nada que hacer aqui y el doble
 * revienta si alguien vuelve a llamarlo.
 */
function crearEscenario(escenario: Escenario = {}) {
  const reservas = escenario.reservas ?? [];
  const perfiles = escenario.perfiles ?? [ANA, BETO];
  const turnos = escenario.turnos ?? [TURNO];
  const fallos = { restantes: escenario.fallosAlMarcar ?? 0 };

  /** El orden real en que ocurrieron las dos cosas que importan. */
  const pasos: string[] = [];

  function tenantActual(): string {
    const ctx = getTenantContext();
    if (!ctx || ctx.kind !== 'tenant') {
      throw new Error(
        'Consulta sin contexto de tenant: la extension de Prisma habria lanzado ' +
          'MissingTenantContextError aqui.',
      );
    }
    return ctx.tenantId;
  }

  function filtrar(tabla: Fila[], where: Fila = {}): Fila[] {
    const tenantId = tenantActual();
    return tabla.filter(
      (fila) =>
        fila.tenantId === tenantId &&
        Object.entries(where).every(([campo, valor]) => fila[campo] === valor),
    );
  }

  // Todos los metodos son `async` a proposito: Prisma devuelve una promesa
  // rechazada cuando la extension bloquea una query, no un throw sincrono, y el
  // doble tiene que fallar por el mismo camino.
  const db = {
    reserva: {
      async findFirst({ where }: { where: Fila }): Promise<Fila | null> {
        const efectivo = { ...where };
        if (escenario.whereLaxo) delete efectivo.perfilId;

        return (
          [...filtrar(reservas, efectivo)].sort(
            (a, b) => Number(b.createdAt) - Number(a.createdAt),
          )[0] ?? null
        );
      },
      /**
       * EL COMPARE-AND-SET. Entre el filtro y la escritura NO hay ningun
       * `await`, asi que las dos mitades ocurren en el mismo turno del event
       * loop y nadie se puede colar en medio: es la misma garantia que da
       * Postgres al resolver `UPDATE ... WHERE ... IS NULL` en una operacion.
       *
       * Gracias a eso el `count` que devuelve significa lo mismo aqui que
       * alli: 1 = esta ejecucion se llevo la marca, 0 = ya estaba puesta.
       */
      async updateMany({ where, data }: { where: Fila; data: Fila }): Promise<{ count: number }> {
        if (fallos.restantes > 0) {
          fallos.restantes -= 1;
          pasos.push('marca-fallida');
          throw new Error('Postgres rechazo la marca');
        }

        const alcanzadas = filtrar(reservas, where);
        for (const fila of alcanzadas) Object.assign(fila, data);
        if (alcanzadas.length > 0) pasos.push('marca');

        return { count: alcanzadas.length };
      },
    },
    perfil: {
      async findFirst({ where }: { where: Fila }): Promise<Fila | null> {
        return filtrar(perfiles, where)[0] ?? null;
      },
    },
    turno: {
      async findFirst({ where }: { where: Fila }): Promise<Fila | null> {
        return filtrar(turnos, where)[0] ?? null;
      },
    },
    tenant: {
      // Modelo global: la extension le clava `id = tenantId` en vez de filtrar
      // por una columna tenantId que este modelo no tiene.
      async findFirst(): Promise<Fila | null> {
        return GIMNASIO.id === tenantActual() ? GIMNASIO : null;
      },
    },
    // ESTE ESPIA ES LA DECISION DE LA TASK 9 PUESTA EN UN TEST. La columna
    // `ListaEspera.notificado` existe y parece hecha a medida de este processor,
    // pero la fila se borra en `asignarPrimero` —dentro de la transaccion que
    // crea la reserva, y el aviso se encola despues del commit—, asi que aqui
    // ya no existe: cualquier updateMany contra ella devolveria `count: 0`
    // siempre, y un compare-and-set sobre ese count no mandaria NI UN aviso.
    // Ver el comentario de JobDeCupo en el processor.
    listaEspera: { updateMany: jest.fn(), update: jest.fn(), deleteMany: jest.fn() },
    // La auditoria tampoco es el sitio de la marca: una fila escrita por el
    // worker iria sin `usuarioId`, y el e2e de la checklist 9 exige que de toda
    // entrada del historial se sepa quien la hizo.
    historialAccion: { create: jest.fn() },
  };

  const avisar = jest.fn().mockImplementation(() => {
    pasos.push('aviso');
    return Promise.resolve();
  });

  const job = {
    id: 'job-1',
    data: {
      tenantId: 'gym-1',
      // LA FILA QUE ESTE AVISO DESCRIBE. Por defecto, la de Ana: `cupoDe` le
      // pone `reserva-<perfilId>` de id. Un escenario que quiera probar el
      // contraste cambia el `perfilId` del payload y deja este id quieto.
      reservaId: 'reserva-perfil-ana',
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      entradaId: 'le-1',
      ...escenario.job,
    },
    // LA MARCA YA NO VIVE EN EL JOB. Este doble no la guarda: revienta. Si
    // alguien vuelve a escribirla en Redis, que se entere por un test rojo y no
    // por dos marcas que un dia discrepan.
    async updateData(): Promise<void> {
      pasos.push('marca-en-el-job');
      throw new Error(
        'La marca de idempotencia ya no vive en el job: va en Reserva.avisoCupoEn, con CAS',
      );
    },
  };

  return {
    processor: new NotificacionListaEsperaProcessor(
      { db } as unknown as PrismaService,
      { avisar } as unknown as MensajeroService,
    ),
    job: job as unknown as JobDeTest,
    avisar,
    pasos,
    db,
  };
}

describe('NotificacionListaEsperaProcessor', () => {
  let logueado: jest.SpyInstance;
  let alarmado: jest.SpyInstance;

  beforeEach(() => {
    logueado = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    alarmado = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('avisa con el tipo LISTA_ESPERA', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[1]).toBe('LISTA_ESPERA');
  });

  it('interpola el nombre del alumno, la clase y la fecha, y la fecha va LEGIBLE', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    const [destinatario, , datos, url] = avisar.mock.calls[0] as [Fila, string, Fila, string];

    expect(destinatario).toEqual({
      perfilId: 'perfil-ana',
      email: 'ana@correo.test',
      nombre: 'Ana',
    });
    expect(datos).toEqual({
      alumno: 'Ana',
      gimnasio: 'Box Fuego',
      clase: 'Pilates',
      fecha: 'miércoles 7 de octubre',
      hora: '18:00',
    });
    // Y no "2026-10-07", que es lo que daria aFechaISO. El email lo lee un
    // alumno, no un sistema.
    expect(datos.fecha).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // CON EL SLUG: las pantallas de la PWA viven en `/<slug>/calendario`, y
    // un `/calendario` pelado abre un 404 con la aplicacion cerrada.
    expect(url).toBe('/box-fuego/calendario');
  });

  // --------------------------------------------------------------------------
  // El perfil del payload se contrasta, no se cree.
  // --------------------------------------------------------------------------

  it('NO avisa al perfil del payload si el cupo se lo quedo otro alumno de la cola', async () => {
    // El lugar fue para Ana; el job dice que hay que avisar a Beto. Los dos son
    // del MISMO gimnasio, asi que la extension de aislamiento no ve nada raro:
    // filtra por tenant, y aqui no se cruza ningun tenant.
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('el intento fallido de Beto tampoco marca nada: el aviso de Ana sigue vivo', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(pasos).toEqual([]);
  });

  it('el destinatario ENTERO sale de la reserva contrastada, no del payload', async () => {
    // Con el doble laxo, la consulta devuelve la reserva de Ana aunque el
    // payload diga Beto. Entonces `perfilId`, `email` y `nombre` tienen que ser
    // LOS TRES de Ana: si `email` y `nombre` se buscaran por el perfilId del
    // payload, el push iria a Ana y el correo a Beto. Un destinatario mezclado
    // es peor que uno equivocado, y ninguna de las dos mitades da error: llegan.
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
      whereLaxo: true,
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    // `toEqual` sobre el destinatario ENTERO, no sobre un campo: lo que se fija
    // es que los tres salgan de la misma fila.
    expect(avisar.mock.calls[0]?.[0]).toEqual({
      perfilId: 'perfil-ana',
      email: 'ana@correo.test',
      nombre: 'Ana',
    });
  });

  it('una reserva que ya no esta con el turno vivo es un log, no una alarma', async () => {
    // El job nombra una fila que no aparece, y el turno sigue en pie. No hay
    // nada que avisar y tampoco nada que suplantar.
    const { processor, job, avisar } = crearEscenario({ reservas: [] });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(alarmado).not.toHaveBeenCalled();
  });

  it('un perfil sin cupo en un turno QUE SIGUE VIVO si es una alarma', async () => {
    // La unica causa de "no hay reserva" que huele a suplantacion.
    const { processor, job } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(alarmado).toHaveBeenCalledWith(expect.stringContaining('perfil-beto'));
  });

  // --------------------------------------------------------------------------
  // El estado se relee: el payload es una foto del pasado.
  // --------------------------------------------------------------------------

  it('NO avisa de un cupo que el alumno cancelo entre el encolado y el envio', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana', { canceladaEn: CANCELADA })],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('el cupo cancelado es una carrera esperable, no una alarma', async () => {
    // El alumno entra a la app, ve la clase que no pidio y la suelta antes de
    // que le llegue el correo. Es normal, y un log de error que salta por causas
    // normales se aprende a ignorar: el dia que saltara por el motivo de verdad,
    // no lo miraria nadie.
    const { processor, job } = crearEscenario({
      reservas: [cupoDe('perfil-ana', { canceladaEn: CANCELADA })],
    });

    await processor.process(job);

    expect(alarmado).not.toHaveBeenCalled();
    expect(logueado).toHaveBeenCalledWith(expect.stringContaining('ya no esta activo'));
  });

  it('NO avisa de un cupo por una reserva que el alumno hizo por su cuenta', async () => {
    // Misma persona, mismo turno, reserva viva — pero de origen ALUMNO. El
    // aviso dice "se libero un lugar y TE LO ASIGNAMOS"; esa reserva no la
    // asigno la cola, asi que ese texto seria falso. Y si llegara, taparia el
    // hecho de que el cupo de verdad se lo quedo otro.
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana', { origen: 'ALUMNO' })],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('si el turno ya no existe, no manda nada y no lanza', async () => {
    // Sin reservas Y sin turno, que es el estado real: `Reserva.turno` lleva
    // `onDelete: Cascade`, asi que borrar el turno se lleva sus reservas.
    const { processor, job, avisar } = crearEscenario({ reservas: [], turnos: [] });

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('el turno borrado tampoco es una alarma', async () => {
    const { processor, job } = crearEscenario({ reservas: [], turnos: [] });

    await processor.process(job);

    expect(alarmado).not.toHaveBeenCalled();
    expect(logueado).toHaveBeenCalledWith(expect.stringContaining('ya no existe'));
  });

  it('a un alumno dado de baja no se le escribe', async () => {
    // La baja es LOGICA: la fila del usuario se queda con `activo: false`, y su
    // perfil y sus reservas siguen existiendo. Sin comprobarlo, todo lo de
    // arriba pasa sin enterarse y el correo sale igual.
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      perfiles: [ANA_DE_BAJA],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    // Y tampoco se marca: el descarte se decide antes de tocar el job.
    expect(pasos).toEqual([]);
  });

  it('si el perfil ya no existe, no manda nada y no lanza', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      perfiles: [],
    });

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Idempotencia: `attempts: 3`, asi que esto corre dos veces.
  // --------------------------------------------------------------------------

  it('se marca ANTES de mandar, no despues', async () => {
    const { processor, job, pasos } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(pasos).toEqual(['marca', 'aviso']);
  });

  it('dos ejecuciones simultaneas del mismo job mandan UN solo email', async () => {
    // EL TEST QUE DISTINGUE UN COMPARE-AND-SET DE UN UPDATE DISFRAZADO DE CAS,
    // y el unico. Es el agujero (b) de la cabecera del processor puesto en
    // codigo: si el lock del job vence —una pausa del event loop, un GC, Redis
    // lento— BullMQ lo redistribuye mientras el primer worker sigue vivo, y los
    // dos corren a la vez sobre la misma reserva.
    //
    // Los dos `process` arrancan sin await y se intercalan en cada await del
    // processor, que es justo lo que hacen dos workers de verdad. Lo que decide
    // el resultado es el `updateMany`: comprueba y escribe en el mismo turno del
    // event loop, asi que uno se lleva `count: 1` y el otro `count: 0`.
    //
    // QUITAR EL TERMINO `avisoCupoEn: null` DEL WHERE, o mandar aunque el count
    // sea 0, deja este test en rojo con dos avisos. No es el unico que cae —son
    // tres por processor, con el del reintento y el de la reserva ya marcada—,
    // pero si el unico que falla por la razon de verdad: los otros dos miran el
    // estado final, y este mira que no se puedan colar uno entre otro.
    const { processor, job, avisar } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await Promise.all([processor.process(job), processor.process(job)]);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('marcar una reserva no marca las demas del gimnasio', async () => {
    // EL HERMANO DEL TEST DE CONCURRENCIA, y sujeta el OTRO termino del where
    // del CAS: `id: reserva.id`.
    //
    // Quitarlo no rompe nada visible —el `updateMany` sigue devolviendo 1 y el
    // aviso sigue saliendo— y ningun escenario de una sola reserva lo nota. Lo
    // que cambia es la CARDINALIDAD: con el `tenantId` que inyecta la extension,
    // el update alcanza a TODAS las reservas del gimnasio con esa columna en
    // null, asi que el primer aviso marcaria la tabla entera y no volveria a
    // salir ninguno, en silencio.
    //
    // Por eso hacen falta DOS reservas del mismo gimnasio y no una.
    const ana = cupoDe('perfil-ana');
    const beto = cupoDe('perfil-beto');
    const { processor, job, avisar } = crearEscenario({ reservas: [ana, beto] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(ana.avisoCupoEn).toBeInstanceOf(Date);
    // LA LINEA QUE IMPORTA: la de Beto sigue intacta, asi que su aviso todavia
    // puede salir.
    expect(beto.avisoCupoEn).toBeNull();
  });

  it('el reintento del mismo job no manda el segundo email', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);
    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('si la marca falla, el reintento manda UNA vez y no dos', async () => {
    // El caso que obliga al orden marcar-antes-de-mandar, con el fallo inyectado
    // justo entre las dos cosas. Con el orden al reves —mandar y luego marcar—
    // el primer intento ya habria mandado el email y el reintento mandaria el
    // segundo, porque la marca nunca llego a escribirse.
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      fallosAlMarcar: 1,
    });

    await expect(processor.process(job)).rejects.toThrow(/Postgres rechazo la marca/);
    expect(avisar).not.toHaveBeenCalled();

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('la marca va a `avisoCupoEn` y deja las otras dos en null', async () => {
    // LA COLUMNA DE ESTE PROCESSOR Y NO OTRA. Son tres porque una misma reserva
    // puede generar los tres avisos: el alumno entra por la cola, se le
    // confirma y despues cancela. Compartir columna con el processor hermano
    // haria que el primero de los avisos en salir se comiera a los otros.
    const reserva = cupoDe('perfil-ana');
    const { processor, job } = crearEscenario({ reservas: [reserva] });

    await processor.process(job);

    // FECHA Y NO BOOLEANO: la columna tiene que poder contestar "cuando", que es
    // lo que va a preguntar quien atienda a un alumno diciendo que no le llego
    // nada. Ver el comentario del modelo en schema.prisma.
    expect(reserva.avisoCupoEn).toBeInstanceOf(Date);
    expect(reserva.avisoConfirmacionEn).toBeNull();
    expect(reserva.avisoCancelacionEn).toBeNull();
  });

  it('avisa del cupo aunque la reserva ya tenga marcada la confirmacion', async () => {
    // Las tres marcas son independientes: que a esta reserva ya se le haya
    // confirmado algo no tiene nada que ver con el aviso de "se libero un
    // lugar". Si este CAS mirara la columna del processor hermano, el aviso no
    // saldria —sin lanzar y sin romper la forma de nada—.
    const reserva = cupoDe('perfil-ana', {
      avisoConfirmacionEn: new Date('2026-10-01T10:00:01.000Z'),
    });
    const { processor, job, avisar } = crearEscenario({ reservas: [reserva] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(reserva.avisoCupoEn).toBeInstanceOf(Date);
  });

  it('una reserva que ya tiene la marca no manda', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [cupoDe('perfil-ana', { avisoCupoEn: new Date('2026-10-01T10:00:01.000Z') })],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    // Y no se reescribe la fecha: el CAS no alcanza ninguna fila.
    expect(pasos).toEqual([]);
  });

  it('la marca NO se escribe en el job', async () => {
    // El payload de un job son identificadores y nada mas (ver colas.ts). La
    // marca vivio ahi hasta la Fase 5B —`job.updateData({ ...job.data,
    // avisoMarcado: true })`— y de ahi salio, entre otras cosas, porque muere
    // con el job: `removeOnComplete` o cualquier limpieza de la cola se la
    // lleva. El doble de `updateData` revienta, asi que esto tambien sujeta que
    // nadie la devuelva a Redis "por si acaso".
    const { processor, job } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(job.data).toEqual({
      tenantId: 'gym-1',
      reservaId: 'reserva-perfil-ana',
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      entradaId: 'le-1',
    });
  });

  // --------------------------------------------------------------------------
  // Donde NO vive la marca.
  // --------------------------------------------------------------------------

  it('no escribe `ListaEspera.notificado`: esa fila ya no existe', async () => {
    // `asignarPrimero` borra la entrada de la cola dentro de la transaccion que
    // crea la reserva, y el aviso se encola despues del commit. Marcarla aqui
    // seria un updateMany con `count: 0` garantizado — y escrito como
    // compare-and-set, que es la unica forma correcta de escribir esa columna,
    // el aviso no saldria NUNCA. Ver el comentario de JobDeCupo.
    const { processor, job, avisar, db } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(db.listaEspera.updateMany).not.toHaveBeenCalled();
    expect(db.listaEspera.update).not.toHaveBeenCalled();
  });

  it('la marca no se escribe en la auditoria', async () => {
    // historial_acciones es el rastro de lo que hicieron las personas. Una fila
    // puesta por el worker iria sin autor y romperia la comprobacion del e2e de
    // la checklist 9, que exige que toda entrada tenga uno.
    const { processor, job, db } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(db.historialAccion.create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // El contexto de tenant.
  // --------------------------------------------------------------------------

  it('abre el contexto de tenant antes de consultar', async () => {
    const { processor, job, avisar, db } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    // El doble lanza si se le consulta sin contexto, igual que la extension.
    await expect(db.reserva.findFirst({ where: {} })).rejects.toThrow(/sin contexto de tenant/);

    // Y el processor no lo sufre: abre el suyo con el tenantId del payload.
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('no encuentra el cupo de otro gimnasio aunque el payload lo nombre', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana', { tenantId: 'gym-2' })],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('el contexto que abre es el del payload y no otro', async () => {
    const vistos: (string | undefined)[] = [];
    const { processor, job } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    const espia = jest.fn().mockImplementation(() => {
      const ctx = getTenantContext();
      vistos.push(ctx?.kind === 'tenant' ? ctx.tenantId : undefined);
      return Promise.resolve();
    });
    (processor as unknown as { mensajero: { avisar: jest.Mock } }).mensajero.avisar = espia;

    await processor.process(job);

    expect(vistos).toEqual(['gym-1']);
    // Y fuera del processor el contexto vuelve a no existir.
    expect(getTenantContext()).toBeUndefined();
  });

  it('los listeners del worker no lanzan', () => {
    const { processor } = crearEscenario();

    expect(() => processor.alFallarElWorker(new Error('Redis caido'))).not.toThrow();
    expect(() => processor.alFallarUnJob(undefined, new Error('vaya'))).not.toThrow();
  });
});
