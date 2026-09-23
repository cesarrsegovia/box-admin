import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DatosNotificacionReserva } from './colas';
import { NotificacionReservaProcessor } from './notificacion-reserva.processor';

type Fila = Record<string, any>;
type JobDeTest = Job<DatosNotificacionReserva & { avisoMarcado?: true }>;

const GIMNASIO = { id: 'gym-1', nombre: 'Box Fuego' };

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
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    ...extra,
  };
}

interface Escenario {
  reservas?: Fila[];
  perfiles?: Fila[];
  turnos?: Fila[];
  /** Lo que trae el payload del job, sobre los valores por defecto. */
  job?: Partial<DatosNotificacionReserva & { avisoMarcado?: true }>;
  /** Cuantas veces revienta `updateData` antes de funcionar. */
  fallosAlMarcar?: number;
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
 * El del JOB guarda lo que se le escribe con `updateData`, que es como se
 * comporta el de verdad: esos datos viven en Redis, y el siguiente intento del
 * mismo job los relee de ahi.
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
      async findMany({ where }: { where: Fila }): Promise<Fila[]> {
        return [...filtrar(reservas, where)].sort(
          (a, b) => Number(b.createdAt) - Number(a.createdAt),
        );
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
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      accion: 'CONFIRMACION' as const,
      ...escenario.job,
    },
    async updateData(nuevos: Fila): Promise<void> {
      if (fallos.restantes > 0) {
        fallos.restantes -= 1;
        pasos.push('marca-fallida');
        throw new Error('Redis rechazo la actualizacion del job');
      }
      pasos.push('marca');
      job.data = nuevos as JobDeTest['data'];
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
    expect(url).toBe('/calendario');
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

  it('el reintento del mismo job no manda el segundo email', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [reservaDe('perfil-ana')] });

    await processor.process(job);
    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('si el job muere al marcar, el reintento manda UNA vez y no dos', async () => {
    // El caso que obliga al orden marcar-antes-de-mandar. Con el orden al reves
    // —mandar y luego marcar— el primer intento ya habria mandado el email y el
    // reintento mandaria el segundo, porque la marca nunca llego a escribirse.
    const { processor, job, avisar } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      fallosAlMarcar: 1,
    });

    await expect(processor.process(job)).rejects.toThrow(/Redis rechazo/);
    expect(avisar).not.toHaveBeenCalled();

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('un job que ya venia marcado no consulta ni manda', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [reservaDe('perfil-ana')],
      job: { avisoMarcado: true },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(pasos).toEqual([]);
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
    await expect(db.reserva.findMany({ where: {} })).rejects.toThrow(/sin contexto de tenant/);

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
