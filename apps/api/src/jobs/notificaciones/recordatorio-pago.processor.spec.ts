import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PagosService } from '../../pagos/pagos.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { DatosDiarios } from './colas';
import { RecordatorioPagoProcessor } from './recordatorio-pago.processor';

type Fila = Record<string, any>;
/** El job tal como lo pide el processor: el payload mas su marca por gimnasio. */
type JobDelProcessor = Parameters<RecordatorioPagoProcessor['process']>[0];

const FUEGO = { id: 'gym-1', nombre: 'Box Fuego', activo: true, slug: 'box-fuego' };
const HIELO = { id: 'gym-2', nombre: 'Box Hielo', activo: true, slug: 'box-hielo' };
const CERRADO = { id: 'gym-3', nombre: 'Box Cerrado', activo: false, slug: 'box-cerrado' };

function alumno(id: string, tenantId: string, nombre: string, extra: Fila = {}): Fila {
  return {
    id,
    tenantId,
    packId: 'pack-1',
    usuario: {
      rol: 'ALUMNO',
      activo: true,
      nombreCompleto: nombre,
      email: `${nombre.toLowerCase()}@correo.test`,
    },
    ...extra,
  };
}

const ANA = alumno('perfil-ana', 'gym-1', 'Ana');
const BETO = alumno('perfil-beto', 'gym-1', 'Beto');
const CARLA = alumno('perfil-carla', 'gym-1', 'Carla');

/** Sin pack no debe nada: el `where` lleva `packId: { not: null }`. */
const SIN_PACK = alumno('perfil-sinpack', 'gym-1', 'Dani', { packId: null });

/**
 * La baja es LOGICA: la fila se queda con todo su pack y su historial, asi que
 * sin `usuario: { activo: true }` en el where seguiria recibiendo el
 * recordatorio todos los meses para siempre.
 */
const DE_BAJA = alumno('perfil-baja', 'gym-1', 'Eva', {
  usuario: { rol: 'ALUMNO', activo: false, nombreCompleto: 'Eva', email: 'eva@correo.test' },
});

/** Un profesor no paga cuota. */
const PROFE = alumno('perfil-profe', 'gym-1', 'Fede', {
  usuario: { rol: 'PROFESOR', activo: true, nombreCompleto: 'Fede', email: 'fede@correo.test' },
});

interface Escenario {
  tenants?: Fila[];
  perfiles?: Fila[];
  /** Los que `PagosService` dice que estan al dia. */
  alDia?: string[];
  job?: Partial<DatosDiarios & { gimnasiosHechos?: string[] }>;
  /** Cuantas veces revienta `updateData` antes de funcionar. */
  fallosAlMarcar?: number;
}

/**
 * Monta el processor con sus tres dobles.
 *
 * El de PRISMA emula la EXTENSION de aislamiento, no solo la interfaz: exige
 * contexto y filtra por tenant. Es lo que convierte "abre el contexto antes de
 * consultar" en algo que el test comprueba de verdad — sin eso, un processor
 * que olvidara `runWithTenant` pasaria en verde aqui y reventaria con
 * `MissingTenantContextError` la primera vez que corriera de noche.
 *
 * Y aplica el WHERE de verdad (`packId`, `usuario.rol`, `usuario.activo`), que
 * es lo que hace que quitar cualquiera de esas condiciones rompa un test en vez
 * de pasar desapercibido.
 */
function crearEscenario(escenario: Escenario = {}) {
  const tenants = escenario.tenants ?? [FUEGO];
  const perfiles = escenario.perfiles ?? [ANA, BETO, CARLA];
  const alDia = new Set(escenario.alDia ?? []);

  /** El orden real de lo que paso: sirve para fijar "contar ANTES de mandar". */
  const pasos: string[] = [];
  /** El contexto en que se pidio cada cosa. */
  const contextoAlListarTenants: string[] = [];
  const tenantsConsultados: string[] = [];

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

  function cumple(fila: Fila, where: Fila): boolean {
    return Object.entries(where).every(([campo, esperado]) => {
      if (campo === 'usuario') {
        return Object.entries(esperado as Fila).every(
          ([sub, valor]) => fila.usuario?.[sub] === valor,
        );
      }
      if (esperado !== null && typeof esperado === 'object' && 'not' in esperado) {
        return fila[campo] !== (esperado as Fila).not;
      }
      return fila[campo] === esperado;
    });
  }

  const db = {
    tenant: {
      async findMany({ where }: { where: Fila }): Promise<Fila[]> {
        const ctx = getTenantContext();
        contextoAlListarTenants.push(ctx?.kind ?? 'ninguno');
        if (!ctx) {
          throw new Error('Consulta sin contexto: la extension habria lanzado aqui.');
        }
        // Tenant es un modelo global: con contexto de tenant la extension le
        // clava `id = tenantId`, y sin el (unscoped) los devuelve todos.
        const visibles =
          ctx.kind === 'tenant' ? tenants.filter((t) => t.id === ctx.tenantId) : tenants;
        return visibles.filter((fila) => cumple(fila, where ?? {}));
      },
    },
    perfil: {
      async findMany({ where }: { where: Fila }): Promise<Fila[]> {
        const tenantId = tenantActual();
        tenantsConsultados.push(tenantId);
        return perfiles.filter((fila) => fila.tenantId === tenantId && cumple(fila, where ?? {}));
      },
    },
  };

  const perfilesAlDia = jest.fn(async (_cliente: unknown, ids: string[], _ahora?: Date) => {
    return new Set(ids.filter((id) => alDia.has(id)));
  });

  const avisar = jest.fn().mockImplementation((destinatario: Fila) => {
    pasos.push(`aviso:${destinatario.perfilId}`);
    return Promise.resolve();
  });

  // El doble del JOB guarda lo que se le escribe con `updateData`, que es como
  // se comporta el de verdad: esos datos viven en Redis, y la siguiente
  // ejecucion del mismo job —un reintento, o un atasco que lo devuelve a la
  // cola— los relee de ahi.
  //
  // ⚠️ DIVERGE DEL REAL EN UN PUNTO, Y ESTA ESCRITO PARA QUE NO SEA UNA TRAMPA
  // CON FECHA: el `updateData` de BullMQ hace `this.data = data` **antes** de
  // esperar la escritura a Redis (`bullmq/dist/cjs/classes/job.js`), asi que
  // cuando la escritura falla el objeto en memoria YA quedo con la marca que
  // Redis no tiene. Este doble solo asigna si la escritura fue bien.
  //
  // Hoy da igual, y por un motivo concreto: el error aborta el `process`, asi
  // que nadie vuelve a leer `job.data` en esa ejecucion. Empezaria a importar el
  // dia que alguien capture ese error y siga —por ejemplo, para no perder los
  // gimnasios que faltan—: ahi el doble seria MAS OPTIMISTA QUE LA REALIDAD,
  // porque en produccion el bucle veria el gimnasio como marcado y aqui no. Si
  // se toca ese camino, este doble se cambia primero.
  const fallos = { restantes: escenario.fallosAlMarcar ?? 0 };
  const job = {
    id: 'job-diario',
    data: { ...escenario.job } as Fila,
    async updateData(nuevos: Fila): Promise<void> {
      if (fallos.restantes > 0) {
        fallos.restantes -= 1;
        pasos.push('marca-fallida');
        throw new Error('Redis rechazo la actualizacion del job');
      }
      pasos.push(`marca:${((nuevos.gimnasiosHechos as string[]) ?? []).join(',')}`);
      job.data = nuevos;
    },
  };

  return {
    processor: new RecordatorioPagoProcessor(
      { db } as unknown as PrismaService,
      { perfilesAlDia } as unknown as PagosService,
      { avisar } as unknown as MensajeroService,
    ),
    job: job as unknown as JobDelProcessor,
    avisar,
    perfilesAlDia,
    pasos,
    contextoAlListarTenants,
    tenantsConsultados,
  };
}

/** Los destinatarios, en el orden en que se les escribio. */
function destinatarios(avisar: jest.Mock): string[] {
  return avisar.mock.calls.map((llamada) => (llamada[0] as Fila).email as string);
}

describe('RecordatorioPagoProcessor', () => {
  let logueado: jest.SpyInstance;
  let pasosDeLog: string[];

  beforeEach(() => {
    pasosDeLog = [];
    logueado = jest.spyOn(Logger.prototype, 'log').mockImplementation((mensaje: unknown) => {
      pasosDeLog.push(String(mensaje));
      return undefined;
    });
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // A quien se le escribe.
  // --------------------------------------------------------------------------

  it('avisa solo a quien NO esta al dia', async () => {
    const { processor, job, avisar } = crearEscenario({ alDia: ['perfil-beto'] });

    const resultado = await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test', 'carla@correo.test']);
    expect(resultado).toEqual({ avisados: 2 });
  });

  it('no avisa a un alumno sin pack', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [ANA, SIN_PACK] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('no avisa a un alumno dado de baja', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [ANA, DE_BAJA] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('no avisa a un profesor', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [ANA, PROFE] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('con todos al dia no manda ni un email', async () => {
    const { processor, job, avisar } = crearEscenario({
      alDia: ['perfil-ana', 'perfil-beto', 'perfil-carla'],
    });

    const resultado = await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
    expect(resultado).toEqual({ avisados: 0 });
  });

  // --------------------------------------------------------------------------
  // Un job diario no tiene tenant: los recorre todos.
  // --------------------------------------------------------------------------

  it('lista los gimnasios SIN contexto de tenant, y consulta cada uno DENTRO del suyo', async () => {
    const { processor, job, contextoAlListarTenants, tenantsConsultados } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
    });

    await processor.process(job);

    // `runUnscoped` y no el cliente base: el cron no viene de ningun gimnasio,
    // y eso tiene que estar visible en el codigo.
    expect(contextoAlListarTenants).toEqual(['unscoped']);
    expect(tenantsConsultados).toEqual(['gym-1', 'gym-2']);
  });

  it('recorre todos los gimnasios activos y no mezcla sus alumnos', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
    });

    const resultado = await processor.process(job);

    expect(resultado).toEqual({ avisados: 2 });
    expect(destinatarios(avisar)).toEqual(['ana@correo.test', 'gus@correo.test']);
    // El nombre del gimnasio sale del tenant que se esta recorriendo, no del
    // primero: un email que diga el gimnasio equivocado es un email equivocado.
    expect((avisar.mock.calls[0]?.[2] as Fila).gimnasio).toBe('Box Fuego');
    expect((avisar.mock.calls[1]?.[2] as Fila).gimnasio).toBe('Box Hielo');
  });

  it('la ruta del push lleva el slug del gimnasio DE ESA VUELTA, no el del primero', async () => {
    // Un job recorre varios gimnasios en el mismo proceso. Si el slug se
    // calculara una vez fuera del bucle, el alumno del segundo gimnasio
    // recibiria una notificacion que abre el gimnasio del primero: el layout
    // compara el slug de la URL contra la cookie, asi que no hay fuga de datos,
    // pero lo manda al login del gimnasio equivocado.
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
    });

    await processor.process(job);

    expect(avisar.mock.calls[0]?.[3]).toBe('/box-fuego/mi-pack');
    expect(avisar.mock.calls[1]?.[3]).toBe('/box-hielo/mi-pack');
  });

  it('un gimnasio dado de baja no recibe nada', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [CERRADO],
      perfiles: [alumno('perfil-zoe', 'gym-3', 'Zoe')],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Lo que se manda.
  // --------------------------------------------------------------------------

  it('manda el tipo RECORDATORIO_PAGO con el alumno y el gimnasio, y nada mas', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [ANA] });

    await processor.process(job);

    const [destinatario, tipo, datos, url] = avisar.mock.calls[0] as [Fila, string, Fila, string];

    expect(destinatario).toEqual({
      perfilId: 'perfil-ana',
      email: 'ana@correo.test',
      nombre: 'Ana',
    });
    expect(tipo).toBe('RECORDATORIO_PAGO');
    // `toEqual` y no `objectContaining`: la forma EXACTA. Ni `fecha`, ni
    // `clase`, ni `hora` en blanco — esta plantilla no los usa, y una cadena
    // vacia es una invitacion a interpolarla y mandar un email con huecos.
    // Tampoco importe ni periodo: esta hablado, la plantilla se queda vaga.
    expect(datos).toEqual({ alumno: 'Ana', gimnasio: 'Box Fuego' });
    // CON EL SLUG: la pantalla vive en `/<slug>/mi-pack`, y un `/mi-pack`
    // pelado abre un 404 cuando el alumno toca la notificacion con la
    // aplicacion cerrada, que es el caso normal.
    expect(url).toBe('/box-fuego/mi-pack');
  });

  it('la fecha de corte sale del payload cuando viene, para poder fijarla en un test', async () => {
    const { processor, job, perfilesAlDia } = crearEscenario({
      job: { ahoraISO: '2026-10-07T00:00:00.000Z' },
    });

    await processor.process(job);

    expect(perfilesAlDia.mock.calls[0]?.[2]).toEqual(new Date('2026-10-07T00:00:00.000Z'));
  });

  it('pregunta por los perfiles de ESTE gimnasio en una sola consulta de pagos', async () => {
    const { processor, job, perfilesAlDia } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, BETO, alumno('perfil-gus', 'gym-2', 'Gus')],
    });

    await processor.process(job);

    expect(perfilesAlDia).toHaveBeenCalledTimes(2);
    expect(perfilesAlDia.mock.calls[0]?.[1]).toEqual(['perfil-ana', 'perfil-beto']);
    expect(perfilesAlDia.mock.calls[1]?.[1]).toEqual(['perfil-gus']);
  });

  it('un gimnasio sin alumnos con pack no llega ni a preguntar por los pagos', async () => {
    const { processor, job, perfilesAlDia, avisar } = crearEscenario({ perfiles: [SIN_PACK] });

    await processor.process(job);

    expect(perfilesAlDia).not.toHaveBeenCalled();
    expect(avisar).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Contar antes de mandar. Es lo unico que permite ver el mismo dia que la
  // consulta de "quien no esta al dia" se rompio: la diferencia entre "3
  // avisos" y "180 avisos" en el log.
  // --------------------------------------------------------------------------

  it('loguea cuantos avisos va a mandar cada gimnasio ANTES de mandarlos', async () => {
    const { processor, job, pasos } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, BETO, alumno('perfil-gus', 'gym-2', 'Gus')],
      alDia: ['perfil-beto'],
    });

    logueado.mockImplementation((mensaje: unknown) => {
      pasos.push(`log:${String(mensaje)}`);
      return undefined;
    });

    await processor.process(job);

    expect(pasos).toEqual([
      'marca:gym-1',
      'log:Box Fuego: 1 recordatorios de pago sobre 2 alumnos con pack',
      'aviso:perfil-ana',
      'marca:gym-1,gym-2',
      'log:Box Hielo: 1 recordatorios de pago sobre 1 alumnos con pack',
      'aviso:perfil-gus',
      expect.stringContaining('Recordatorio de pago: 2 avisos en 2 gimnasios'),
    ]);
  });

  // --------------------------------------------------------------------------
  // LA MARCA POR GIMNASIO. `attempts: 1` NO impide una segunda ejecucion: el
  // camino de job atascado de BullMQ re-encola sin mirar `attempts`, y con un
  // repetible ni siquiera tiene tope (`moveStalledJobsToWait-9.js`). Un deploy a
  // las 09:00 basta. Sin marca, la tanda entera sale dos veces.
  // --------------------------------------------------------------------------

  it('en una segunda ejecucion del mismo job, los gimnasios ya marcados se saltan', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
      // Asi llega el job cuando BullMQ lo devuelve a la cola por atasco: con lo
      // que el worker anterior alcanzo a escribirse a si mismo.
      job: { gimnasiosHechos: ['gym-1'] },
    });

    const resultado = await processor.process(job);

    // Ana NO recibe un segundo correo; Gus, que se quedo sin procesar, si.
    expect(destinatarios(avisar)).toEqual(['gus@correo.test']);
    expect(resultado).toEqual({ avisados: 1 });
  });

  it('con todos los gimnasios ya marcados no se manda absolutamente nada', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
      job: { gimnasiosHechos: ['gym-1', 'gym-2'] },
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('la marca se escribe ANTES de avisar, y el test lo prueba con un fallo inyectado', async () => {
    // El test de orden por si solo no alcanza: ya paso en las tasks anteriores
    // que el `pasos` esperado sobrevivia a invertir las dos lineas. Con
    // `updateData` reventando, el orden se vuelve observable por sus
    // CONSECUENCIAS: si la marca va antes, no salio ni un correo y el job
    // propaga el error; si fuera despues, el correo ya estaria mandado y ademas
    // sin marcar, o sea repetido en la siguiente ejecucion.
    const { processor, job, avisar, pasos } = crearEscenario({
      perfiles: [ANA, BETO],
      fallosAlMarcar: 1,
    });

    await expect(processor.process(job)).rejects.toThrow('Redis rechazo la actualizacion del job');

    expect(avisar).not.toHaveBeenCalled();
    expect(pasos).toEqual(['marca-fallida']);
  });

  it('marcar un gimnasio no pisa lo que el job ya traia marcado', async () => {
    const { processor, job } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
      job: { ahoraISO: '2026-10-07T00:00:00.000Z', gimnasiosHechos: ['gym-1'] },
    });

    await processor.process(job);

    // La lista crece, y el resto del payload sigue ahi: se escribe sobre
    // `job.data`, no en su lugar.
    expect(job.data).toEqual({
      ahoraISO: '2026-10-07T00:00:00.000Z',
      gimnasiosHechos: ['gym-1', 'gym-2'],
    });
  });

  // --------------------------------------------------------------------------
  // El aviso se PIERDE si el SMTP falla, y el job termina OK igual.
  // --------------------------------------------------------------------------

  it('un envio que no sale no tumba la tanda: `avisar` no lanza, y el job cuenta intentos', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [ANA, BETO] });
    // Asi se comporta `MensajeroService.avisar` con el SMTP caido: se traga el
    // error, deja un `logger.warn` y devuelve. El aviso se pierde y el contador
    // dice 2, porque cuenta intentos y no entregas. Queda fijado aqui para que
    // nadie lea "avisados: 2" como "llegaron 2".
    avisar.mockResolvedValue(undefined);

    const resultado = await processor.process(job);

    expect(resultado).toEqual({ avisados: 2 });
  });
});
