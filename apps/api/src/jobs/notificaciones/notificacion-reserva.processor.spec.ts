import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DatosNotificacionReserva } from './colas';
import { NotificacionReservaProcessor } from './notificacion-reserva.processor';

type Fila = Record<string, any>;
type JobDeTest = Job<DatosNotificacionReserva>;

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

function reservaDe(perfilId: string, extra: Fila = {}): Fila {
  return {
    id: `reserva-${perfilId}`,
    tenantId: 'gym-1',
    turnoId: 'turno-1',
    perfilId,
    canceladaEn: null,
    // LAS TRES MARCAS, EXPLICITAS Y EN null. No es decoracion del fixture: el
    // compare-and-set del processor filtra por `...En: null`, y una fila a la
    // que le falte el campo no lo cumple —`undefined !== null`—, igual que no
    // lo cumpliria en Postgres si la columna no existiera. Que esten aqui es lo
    // que hace que el doble emule el CAS y no otra cosa.
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
  /** El gimnasio no aparece: de ahi sale el slug de la ruta del push. */
  sinTenant?: boolean;
  /** Lo que trae el payload del job, sobre los valores por defecto. */
  job?: Partial<DatosNotificacionReserva>;
  /** Cuantas veces revienta el `updateMany` de la marca antes de funcionar. */
  fallosAlMarcar?: number;
  /**
   * Rompe el doble de Prisma A PROPOSITO: le quita el `perfilId` al where de las
   * reservas, que es exactamente el futuro que el processor dice temer —alguien
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
 * `Reserva`, `updateData` no tiene nada que hacer aqui y el doble revienta si
 * alguien vuelve a llamarlo.
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
        if (escenario.sinTenant) return null;
        return GIMNASIO.id === tenantActual() ? GIMNASIO : null;
      },
    },
    // La auditoria NO es el sitio de la marca de idempotencia (ver el comentario
    // de `JobDeAviso` en el processor). Este espia esta para que quede
    // comprobado y no solo dicho: una fila escrita por el worker iria sin
    // `usuarioId`, y el e2e de la checklist 9 exige que de toda entrada del
    // historial se sepa quien la hizo.
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
      // LA FILA QUE ESTE AVISO DESCRIBE. Por defecto, la de Ana: `reservaDe` le
      // pone `reserva-<perfilId>` de id. Un escenario que quiera probar el
      // contraste cambia el `perfilId` del payload y deja este id quieto, que es
      // justo el caso "el job pide avisar a un tercero por la reserva de otro".
      reservaId: 'reserva-perfil-ana',
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      accion: 'CONFIRMACION' as const,
      ...escenario.job,
    },
    // LA MARCA YA NO VIVE EN EL JOB. Este doble no la guarda: revienta. Si
    // alguien vuelve a escribirla en Redis, que se entere por un test rojo y no
    // por dos marcas que un dia discrepan.
    async updateData(): Promise<void> {
      pasos.push('marca-en-el-job');
      throw new Error(
        'La marca de idempotencia ya no vive en el job: va en Reserva.aviso...En, con CAS',
      );
    },
  };

  return {
    processor: new NotificacionReservaProcessor(
      { db } as unknown as PrismaService,
      { avisar } as unknown as MensajeroService,
    ),
    job: job as unknown as JobDeTest,
    avisar,
    pasos,
    db,
  };
}

describe('NotificacionReservaProcessor', () => {
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

  it('manda con la plantilla del tipo que trae el job', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[1]).toBe('CONFIRMACION');
  });

  it('interpola el nombre del alumno, la clase y la fecha, y la fecha va LEGIBLE', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

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
    // un `/calendario` pelado abre un 404 cuando el alumno toca la
    // notificacion con la aplicacion cerrada, que es el caso normal.
    expect(url).toBe('/box-fuego/calendario');
  });

  it('sin gimnasio no hay slug, y entonces la ruta del push va en null: email si, push no', async () => {
    // El gimnasio es de donde sale el slug. Sin el, la ruta seria `/undefined/…`
    // o `/calendario` pelado, y las dos abren un 404 en cuanto el alumno toca la
    // notificacion con la PWA cerrada. `null` le dice a `MensajeroService` que
    // mande solo el email, que no depende de ninguna ruta. Es el mismo criterio
    // que el resto de la fase: perder un canal antes que mandar algo roto.
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      sinTenant: true,
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[3]).toBeNull();
    // Y el nombre del gimnasio sigue degradando a cadena vacia: un email sin el
    // nombre se lee igual, una ruta sin slug no lleva a ningun lado. No es la
    // misma decision y por eso no se toman juntas.
    expect((avisar.mock.calls[0]?.[2] as Fila).gimnasio).toBe('');
  });

  it('manda la CANCELACION cuando la reserva esta de verdad cancelada', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana', { canceladaEn: CANCELADA })],
      job: { accion: 'CANCELACION' },
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[1]).toBe('CANCELACION');
  });

  // --------------------------------------------------------------------------
  // El perfil del payload se contrasta, no se cree.
  // --------------------------------------------------------------------------

  it('NO avisa al perfil del payload si la reserva del turno es de otro alumno', async () => {
    // La reserva del turno es de Ana; el job dice que hay que avisar a Beto.
    // Los dos son del MISMO gimnasio, asi que la extension de aislamiento no ve
    // nada raro: filtra por tenant, y aqui no se cruza ningun tenant.
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('el destinatario ENTERO sale de la reserva contrastada, no del payload', async () => {
    // Con el doble laxo, la consulta devuelve la reserva de Ana aunque el
    // payload diga Beto. Entonces `perfilId`, `email` y `nombre` tienen que ser
    // LOS TRES de Ana: si `email` y `nombre` se buscaran por el perfilId del
    // payload, el push iria a Ana y el correo a Beto. Un destinatario mezclado
    // es peor que uno equivocado, y ninguna de las dos mitades da error: llegan.
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
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

  it('el intento fallido de Beto tampoco marca nada: el aviso de Ana sigue vivo', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(pasos).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // El estado se relee: el payload es una foto del pasado.
  // --------------------------------------------------------------------------

  it('NO confirma una reserva que se cancelo entre el encolado y el envio', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana', { canceladaEn: CANCELADA })],
      job: { accion: 'CONFIRMACION' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('NO avisa de una cancelacion si la reserva sigue viva', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      job: { accion: 'CANCELACION' },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('si el turno ya no existe, no manda nada y no lanza', async () => {
    // Sin reservas Y sin turno, que es el estado real: `Reserva.turno` lleva
    // `onDelete: Cascade`, asi que borrar el turno se lleva sus reservas. Un
    // turno borrado con sus reservas todavia en pie no existe ni puede existir.
    const { processor, job, avisar } = crearEscenario({ reservas: [], turnos: [] });

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).not.toHaveBeenCalled();
  });

  it('el turno borrado es una carrera esperable, no una alarma', async () => {
    // El admin puede borrar un turno en cuanto no le quedan reservas activas, que
    // es justo como queda tras la ultima cancelacion. Si eso ocurre entre encolar
    // y procesar, aqui no hay reservas — y eso NO es un intento de cruce. Un log
    // de error que salta por causas normales se aprende a ignorar, y entonces el
    // dia que salte por el motivo de verdad no lo mira nadie.
    const { processor, job } = crearEscenario({ reservas: [], turnos: [] });

    await processor.process(job);

    expect(alarmado).not.toHaveBeenCalled();
    expect(logueado).toHaveBeenCalledWith(expect.stringContaining('ya no existe'));
  });

  it('una reserva que ya no esta con el turno vivo es un log, no una alarma', async () => {
    // El job nombra una fila que no aparece, y el turno sigue en pie. No hay
    // nada que avisar y tampoco nada que suplantar: nadie esta pidiendo que se
    // avise a un tercero, que es lo unico que merece nivel error aqui.
    const { processor, job, avisar } = crearEscenario({ reservas: [] });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(alarmado).not.toHaveBeenCalled();
  });

  it('un perfil sin reserva en un turno QUE SIGUE VIVO si es una alarma', async () => {
    // La otra causa de "no hay reserva", y la unica que huele a suplantacion.
    const { processor, job } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      job: { perfilId: 'perfil-beto' },
    });

    await processor.process(job);

    expect(alarmado).toHaveBeenCalledWith(expect.stringContaining('perfil-beto'));
  });

  it('a un alumno dado de baja no se le escribe', async () => {
    // La baja es LOGICA: la fila del usuario se queda con `activo: false`, y su
    // perfil y sus reservas siguen existiendo. Sin comprobarlo, todo lo de
    // arriba pasa sin enterarse y el correo sale igual.
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      perfiles: [ANA_DE_BAJA],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    // Y tampoco se marca: el descarte se decide antes de tocar el job.
    expect(pasos).toEqual([]);
  });

  it('si el perfil ya no existe, no manda nada y no lanza', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      perfiles: [],
    });

    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Idempotencia: `attempts: 3`, asi que esto corre dos veces.
  // --------------------------------------------------------------------------

  it('se marca ANTES de mandar, no despues', async () => {
    const { processor, job, pasos } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

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
    // el resultado es el `updateMany`: comprueba y escribe en el mismo turno
    // del event loop, asi que uno se lleva `count: 1` y el otro `count: 0`.
    //
    // QUITAR EL TERMINO `avisoConfirmacionEn: null` DEL WHERE, o mandar aunque
    // el count sea 0, deja este test en rojo con dos avisos. No es el unico que
    // cae —son tres por processor, con el del reintento y el de la reserva ya
    // marcada—, pero si el unico que falla por la razon de verdad: los otros dos
    // miran el estado final, y este mira que no se puedan colar uno entre otro.
    const { processor, job, avisar } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    await Promise.all([processor.process(job), processor.process(job)]);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('dos cancelaciones del mismo alumno en el mismo turno mandan DOS emails', async () => {
    // LA REGRESION QUE EL `reservaId` DEL PAYLOAD EXISTE PARA EVITAR, y que la
    // marca en Redis no tenia: alli cada job llevaba la suya.
    //
    // El alumno cancela A, vuelve a reservar y cancela B. Son dos cancelaciones
    // de verdad y les toca un email a cada una. Pero `Reserva` NO tiene unique
    // sobre `(tenantId, turnoId, perfilId)`, asi que "la reserva cancelada de
    // este perfil en este turno" no identifica una fila: hay dos, y las dos
    // cumplen el estado. Un processor que ELIGIERA una —por ejemplo la mas
    // reciente— marcaria B para el job de A, mandaria una vez, y el job de B se
    // encontraria con `count: 0` y se callaria. Dos cancelaciones, un email.
    //
    // Por eso el where de la busqueda lleva `id: reservaId`: la fila no se
    // elige, se verifica. Quitarlo deja este test en rojo y ningun otro.
    const a = reservaDe('perfil-ana', {
      id: 'reserva-a',
      canceladaEn: CANCELADA,
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
    });
    const b = reservaDe('perfil-ana', {
      id: 'reserva-b',
      canceladaEn: CANCELADA,
      createdAt: new Date('2026-10-01T12:00:00.000Z'),
    });
    const { processor, job, avisar } = crearEscenario({
      reservas: [a, b],
      job: { reservaId: 'reserva-a', accion: 'CANCELACION' },
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(a.avisoCancelacionEn).toBeInstanceOf(Date);
    // Y la de B sigue sin marcar, asi que SU aviso todavia puede salir.
    expect(b.avisoCancelacionEn).toBeNull();
  });

  it('marcar una reserva no marca las demas del gimnasio', async () => {
    // EL HERMANO DEL TEST DE CONCURRENCIA, y sujeta el OTRO termino del where
    // del CAS: `id: reserva.id`.
    //
    // Quitarlo no rompe nada visible —el `updateMany` sigue devolviendo 1, el
    // aviso sigue saliendo, la columna sigue escribiendose— y ningun escenario
    // de una sola reserva lo nota. Lo que cambia es la CARDINALIDAD: con el
    // `tenantId` que inyecta la extension, el update alcanza a TODAS las
    // reservas del gimnasio que tengan esa columna en null. O sea que el primer
    // aviso de confirmacion que saliera marcaria la tabla entera y no volveria a
    // salir ninguno, nunca, en silencio: estrictamente peor que el agujero que
    // el CAS viene a cerrar.
    //
    // Por eso hacen falta DOS reservas del mismo gimnasio y no una.
    const ana = reservaDe('perfil-ana');
    const beto = reservaDe('perfil-beto');
    const { processor, job, avisar } = crearEscenario({ reservas: [ana, beto] });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(ana.avisoConfirmacionEn).toBeInstanceOf(Date);
    // LA LINEA QUE IMPORTA: la de Beto sigue intacta, asi que su aviso todavia
    // puede salir.
    expect(beto.avisoConfirmacionEn).toBeNull();
  });

  it('el reintento del mismo job no manda el segundo email', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

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
      reservas: [reservaDe('perfil-ana')],
      fallosAlMarcar: 1,
    });

    await expect(processor.process(job)).rejects.toThrow(/Postgres rechazo la marca/);
    expect(avisar).not.toHaveBeenCalled();

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('la marca va a la columna de la accion y deja las otras dos en null', async () => {
    const reserva = reservaDe('perfil-ana');
    const { processor, job } = crearEscenario({ reservas: [reserva] });

    await processor.process(job);

    // FECHA Y NO BOOLEANO: la columna tiene que poder contestar "cuando", que es
    // lo que va a preguntar quien atienda a un alumno diciendo que no le llego
    // nada. Ver el comentario del modelo en schema.prisma.
    expect(reserva.avisoConfirmacionEn).toBeInstanceOf(Date);
    expect(reserva.avisoCancelacionEn).toBeNull();
    expect(reserva.avisoCupoEn).toBeNull();
  });

  it('la CANCELACION se marca en SU columna, aunque la confirmacion ya este marcada', async () => {
    // EL CASO NORMAL, no el raro: la misma fila recibe primero su confirmacion
    // y despues, al cancelarse, su aviso de cancelacion. Si el CAS de la
    // cancelacion mirara `avisoConfirmacionEn` —la columna equivocada— se
    // encontraria con una fecha ya puesta, devolveria `count: 0` y el alumno no
    // se enteraria de que le cancelaron la clase. No lanza, no rompe la forma
    // de nada: sencillamente no sale el email.
    const reserva = reservaDe('perfil-ana', {
      canceladaEn: CANCELADA,
      avisoConfirmacionEn: new Date('2026-10-01T10:00:01.000Z'),
    });
    const { processor, job, avisar } = crearEscenario({
      reservas: [reserva],
      job: { accion: 'CANCELACION' },
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
    expect(avisar.mock.calls[0]?.[1]).toBe('CANCELACION');
    expect(reserva.avisoCancelacionEn).toBeInstanceOf(Date);
  });

  it('una reserva que ya tiene la marca no manda', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [
        reservaDe('perfil-ana', { avisoConfirmacionEn: new Date('2026-10-01T10:00:01.000Z') }),
      ],
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
    const { processor, job } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    await processor.process(job);

    expect(job.data).toEqual({
      tenantId: 'gym-1',
      reservaId: 'reserva-perfil-ana',
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      accion: 'CONFIRMACION',
    });
  });

  it('la marca no se escribe en la auditoria', async () => {
    // historial_acciones es el rastro de lo que hicieron las personas. Una fila
    // puesta por el worker iria sin autor y romperia la comprobacion del e2e de
    // la checklist 9, que exige que toda entrada tenga uno.
    const { processor, job, db } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    await processor.process(job);

    expect(db.historialAccion.create).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // El contexto de tenant.
  // --------------------------------------------------------------------------

  it('abre el contexto de tenant antes de consultar', async () => {
    const { processor, job, avisar, db } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    // El doble lanza si se le consulta sin contexto, igual que la extension.
    await expect(db.reserva.findFirst({ where: {} })).rejects.toThrow(/sin contexto de tenant/);

    // Y el processor no lo sufre: abre el suyo con el tenantId del payload.
    await expect(processor.process(job)).resolves.toBeUndefined();
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('no encuentra la reserva de otro gimnasio aunque el payload la nombre', async () => {
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana', { tenantId: 'gym-2' })],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('el contexto que abre es el del payload y no otro', async () => {
    const vistos: (string | undefined)[] = [];
    const { processor, job } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

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
