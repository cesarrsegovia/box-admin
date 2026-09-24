import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DatosNotificacionListaEspera } from './colas';
import { NotificacionListaEsperaProcessor } from './notificacion-lista-espera.processor';

type Fila = Record<string, any>;
type JobDeTest = Job<DatosNotificacionListaEspera & { avisoMarcado?: true }>;

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
    createdAt: new Date('2026-10-01T10:00:00.000Z'),
    ...extra,
  };
}

interface Escenario {
  reservas?: Fila[];
  perfiles?: Fila[];
  turnos?: Fila[];
  /** Lo que trae el payload del job, sobre los valores por defecto. */
  job?: Partial<DatosNotificacionListaEspera & { avisoMarcado?: true }>;
  /** Cuantas veces revienta `updateData` antes de funcionar. */
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
      async findFirst({ where }: { where: Fila }): Promise<Fila | null> {
        const efectivo = { ...where };
        if (escenario.whereLaxo) delete efectivo.perfilId;

        return (
          [...filtrar(reservas, efectivo)].sort(
            (a, b) => Number(b.createdAt) - Number(a.createdAt),
          )[0] ?? null
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
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      entradaId: 'le-1',
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

  it('el reintento del mismo job no manda el segundo email', async () => {
    const { processor, job, avisar } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);
    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('si el job muere al marcar, el reintento manda UNA vez y no dos', async () => {
    // El caso que obliga al orden marcar-antes-de-mandar. Con el orden al reves
    // —mandar y luego marcar— el primer intento ya habria mandado el email y el
    // reintento mandaria el segundo, porque la marca nunca llego a escribirse.
    const { processor, job, avisar } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      fallosAlMarcar: 1,
    });

    await expect(processor.process(job)).rejects.toThrow(/Redis rechazo/);
    expect(avisar).not.toHaveBeenCalled();

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it('la marca NO se come el payload', async () => {
    // `updateData` REEMPLAZA los datos del job, no los mezcla. Escribir
    // `{ avisoMarcado: true }` a secas en vez de `{ ...job.data, ... }` pasa
    // todos los demas tests —la segunda vuelta sale igual por el early return—,
    // pero deja el job en Redis sin tenantId, sin perfilId y sin turnoId: un job
    // en `failed` asi no se puede diagnosticar desde un panel de Bull, ni saber
    // a quien se le iba a avisar.
    const { processor, job } = crearEscenario({ reservas: [cupoDe('perfil-ana')] });

    await processor.process(job);

    expect(job.data).toEqual({
      tenantId: 'gym-1',
      perfilId: 'perfil-ana',
      turnoId: 'turno-1',
      entradaId: 'le-1',
      avisoMarcado: true,
    });
  });

  it('un job que ya venia marcado no consulta ni manda', async () => {
    const { processor, job, avisar, pasos } = crearEscenario({
      reservas: [cupoDe('perfil-ana')],
      job: { avisoMarcado: true },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(pasos).toEqual([]);
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
