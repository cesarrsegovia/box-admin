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

/**
 * EL MOROSO CENTINELA. Sus datos personales son deliberadamente raros —nada que
 * pueda aparecer por casualidad en un mensaje de log— y el test que vigila el
 * log los lee DE AQUI, nunca escritos a mano: si alguien cambia el fixture, el
 * centinela se mueve con el en vez de quedarse comprobando un dato que ya no
 * existe.
 */
const MOROSO_CENTINELA = alumno('perfil-centinela', 'gym-1', 'Zoraida Quispe', {
  usuario: {
    rol: 'ALUMNO',
    activo: true,
    nombreCompleto: 'Zoraida Quispe',
    email: 'zoraida.quispe@correo.test',
  },
});

interface Escenario {
  tenants?: Fila[];
  perfiles?: Fila[];
  /** Los que `PagosService` dice que estan al dia. */
  alDia?: string[];
  job?: Partial<DatosDiarios & { gimnasiosHechos?: string[] }>;
  /** Cuantas veces revienta `updateData` antes de funcionar. */
  fallosAlMarcar?: number;
  /**
   * Anota cada pausa en `pasos`, y la hace resolver en un tick POSTERIOR.
   *
   * Apagado por defecto porque ensucia el `pasos` del test de orden del log.
   * Encendido es lo unico que distingue "se espera la pausa" de "se lanza y se
   * sigue de largo": con una pausa que resuelve al instante las dos versiones
   * producen exactamente la misma secuencia.
   */
  registrarPausas?: boolean;
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

  const processor = new RecordatorioPagoProcessor(
    { db } as unknown as PrismaService,
    { perfilesAlDia } as unknown as PagosService,
    { avisar } as unknown as MensajeroService,
  );

  /**
   * EL RITMO, SIN ESPERAR DE VERDAD.
   *
   * `pausar` es el unico sitio del processor que toca el reloj, y esta aislado
   * justamente para esto: un test que mande tres correos no puede costar tres
   * pausas de produccion. Se sustituye por un doble que anota los MILISEGUNDOS
   * pedidos —eso es lo que fija el valor por defecto— y resuelve solo.
   *
   * Que la pausa de verdad espere de verdad se comprueba aparte, con relojes
   * falsos, en el test del final: sustituirla aqui sin ese otro test dejaria
   * pasar un `pausar` que devuelve `Promise.resolve()` y no pausa nada.
   */
  const pausas: number[] = [];
  const pausar = jest
    .spyOn(processor as unknown as { pausar: (ms: number) => Promise<void> }, 'pausar')
    .mockImplementation((ms: number) => {
      pausas.push(ms);
      if (!escenario.registrarPausas) return Promise.resolve();

      pasos.push(`pausa-ini:${ms}`);
      return new Promise<void>((resolve) =>
        setImmediate(() => {
          pasos.push('pausa-fin');
          resolve();
        }),
      );
    });

  return {
    processor,
    job: job as unknown as JobDelProcessor,
    avisar,
    perfilesAlDia,
    pasos,
    pausas,
    pausar,
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

// ----------------------------------------------------------------------------
// EL RITMO DEL ENVIO MASIVO.
//
// Este es el unico camino del sistema que manda cientos de correos seguidos sin
// que nadie lo mire, y los mandaba pegados: 500 `avisar` consecutivos contra el
// mismo SMTP sin una sola pausa. Los proveedores frenan o bloquean por eso.
//
// RITMO Y NO TOPE, y es la decision que estos tests fijan: un tope dejaria a
// algun moroso sin su recordatorio, y no avisarle es peor que tardar. La tanda
// puede durar mas; lo que no puede es acortarse.
// ----------------------------------------------------------------------------
describe('RecordatorioPagoProcessor — ritmo entre envios', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('pausa UNA VEZ POR ENVIO, no una sola vez para toda la tanda', async () => {
    // Tres morosos, tres pausas. Es el caso que distingue "ritmo" de "una pausa
    // y despues la avalancha de siempre": con un solo destinatario las dos
    // implementaciones dan exactamente el mismo numero.
    const { processor, job, avisar, pausas } = crearEscenario({
      perfiles: [ANA, BETO, CARLA],
    });

    await processor.process(job);

    expect(avisar).toHaveBeenCalledTimes(3);
    expect(pausas).toHaveLength(3);
  });

  it('el valor por defecto de la pausa son 200 ms', async () => {
    // El 200 va ESCRITO, no importado de la constante: comparar la salida contra
    // la misma constante que la produce es un test que no puede fallar — cambias
    // el default y el test cambia con el.
    //
    // 200 ms = 5 envios por segundo. Una tanda de 500 morosos tarda ~100 s, que
    // sigue siendo una tanda corta para un cron de madrugada, y queda por debajo
    // del ritmo que frenan los proveedores de correo compartidos.
    const { processor, job, pausas } = crearEscenario({ perfiles: [ANA, BETO] });

    await processor.process(job);

    expect(pausas).toEqual([200, 200]);
  });

  it('ESPERA la pausa antes del siguiente envio: no la lanza y sigue de largo', async () => {
    // La mutacion que este test existe para atrapar es quitar el `await` de la
    // pausa. Se sigue llamando una vez por envio —el contador de arriba no se
    // entera— y el SMTP recibe los 500 correos pegados igual que antes.
    //
    // Con la pausa resolviendo en un tick posterior, la diferencia es visible en
    // el ORDEN: esperada, cada envio va despues de la pausa anterior; sin
    // esperar, salen los tres avisos de corrido y las pausas terminan al final.
    const { processor, job, pasos } = crearEscenario({
      perfiles: [ANA, BETO, CARLA],
      registrarPausas: true,
    });

    await processor.process(job);

    expect(pasos).toEqual([
      'marca:gym-1',
      'aviso:perfil-ana',
      'pausa-ini:200',
      'pausa-fin',
      'aviso:perfil-beto',
      'pausa-ini:200',
      'pausa-fin',
      'aviso:perfil-carla',
      'pausa-ini:200',
      'pausa-fin',
    ]);
  });

  it('el ritmo no se rompe en el salto de un gimnasio al siguiente', async () => {
    // La pausa va DESPUES de cada envio y no entre envios del mismo gimnasio: de
    // la otra forma, el ultimo correo de un gimnasio y el primero del siguiente
    // salen pegados, y con treinta gimnasios de un alumno cada uno el ritmo no
    // existe.
    const { processor, job, pausas } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [ANA, alumno('perfil-gus', 'gym-2', 'Gus')],
      registrarPausas: true,
    });

    await processor.process(job);

    expect(pausas).toEqual([200, 200]);
  });

  it('RITMO, NO TOPE: con una tanda grande se le escribe a TODOS', async () => {
    // La decision esta tomada y este test la fija: nada de `slice`, nada de
    // "maximo N por ejecucion". Un tope deja a un moroso sin aviso, y eso es
    // peor que una tanda lenta.
    const muchos = Array.from({ length: 500 }, (_, i) =>
      alumno(`perfil-${i}`, 'gym-1', `Alumno${i}`),
    );
    const { processor, job, avisar, pausas } = crearEscenario({ perfiles: muchos });

    const resultado = await processor.process(job);

    expect(resultado).toEqual({ avisados: 500 });
    expect(avisar).toHaveBeenCalledTimes(500);
    expect(pausas).toHaveLength(500);
  });

  it('un gimnasio sin morosos no pausa por nada', async () => {
    const { processor, job, pausas } = crearEscenario({
      alDia: ['perfil-ana', 'perfil-beto', 'perfil-carla'],
    });

    await processor.process(job);

    expect(pausas).toEqual([]);
  });

  it('la pausa de verdad espera de verdad: no resuelve hasta que pasan los ms', async () => {
    // Sin este test, el doble de `pausar` de los otros se vuelve una trampa: un
    // `pausar` que devolviera `Promise.resolve()` —o que esperara 1 ms en vez de
    // los que le piden— pasaria todo lo de arriba en verde y no frenaria nada en
    // produccion. Aqui se usa el metodo REAL, con relojes falsos para no esperar.
    jest.useFakeTimers();
    const processor = new RecordatorioPagoProcessor(
      {} as unknown as PrismaService,
      {} as unknown as PagosService,
      {} as unknown as MensajeroService,
    );

    let resuelta = false;
    const pausa = (processor as unknown as { pausar: (ms: number) => Promise<void> })
      .pausar(200)
      .then(() => {
        resuelta = true;
      });

    await Promise.resolve();
    expect(resuelta).toBe(false);

    jest.advanceTimersByTime(199);
    await Promise.resolve();
    expect(resuelta).toBe(false);

    jest.advanceTimersByTime(1);
    await pausa;
    expect(resuelta).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// LO QUE EL LOG NO PUEDE DECIR.
//
// Este processor maneja el nombre y el email de TODOS los morosos del sistema,
// y es el unico que recorre todos los gimnasios. Una linea de depuracion con el
// destinatario dentro —la que cualquiera escribe mientras calibra la pausa— son
// los datos personales de cada alumno moroso en el log del worker, una linea por
// persona, todas las noches.
//
// LA DEFENSA ANTERIOR ESTABA ATADA A QUE METODO DEL LOGGER SE USARA. Los tests
// de arriba espian `log`, `warn` y `error`: un `logger.debug` con el email
// dentro los atravesaba entero —60 unitarios y 8 e2e— sin despeinarse, y en los
// e2e la salida del Logger de Nest no aparece en absoluto, asi que tampoco habia
// donde verlo. Verde por casualidad ortografica: dependia de una palabra.
//
// POR ESO LOS METODOS SE DESCUBREN Y NO SE ENUMERAN. Hoy son seis (`log`,
// `error`, `warn`, `debug`, `verbose`, `fatal`); el dia que Nest agregue el
// septimo, queda cubierto sin que nadie se acuerde de venir aqui.
// ----------------------------------------------------------------------------
describe('RecordatorioPagoProcessor — datos personales en el log', () => {
  /** Todo lo dicho por CUALQUIER metodo del Logger, en el orden en que se dijo. */
  let todoLoDicho: string[];

  /** Un argumento de log puede no ser una cadena; el dato puede ir dentro. */
  function aTexto(dato: unknown): string {
    if (typeof dato === 'string') return dato;
    try {
      return JSON.stringify(dato) ?? String(dato);
    } catch {
      return String(dato);
    }
  }

  beforeEach(() => {
    todoLoDicho = [];

    // Se recorre el prototipo y se cubre TODO lo que sea un metodo de verdad.
    // `constructor` queda fuera por razones obvias, y los descriptores con
    // `get` tambien: `localInstance` es un getter, y espiarlo —o siquiera
    // leerlo— construye un logger en vez de capturar un mensaje.
    const prototipo = Logger.prototype as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const nombre of Object.getOwnPropertyNames(Logger.prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(Logger.prototype, nombre);
      if (nombre === 'constructor' || typeof descriptor?.value !== 'function') continue;

      jest.spyOn(prototipo, nombre).mockImplementation((...args: unknown[]) => {
        todoLoDicho.push(args.map(aTexto).join(' '));
        return undefined;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * EL SEGUNDO SELLO, y es el que usa el precedente de este paquete
   * (`reservas.service.spec.ts`, «NO escribe los nombres de los alumnos en el
   * log»): interceptar la SALIDA y no el Logger. Por stdout/stderr pasan
   * tambien `console.log` y cualquier libreria que imprima por su cuenta, que
   * el espia del Logger de arriba —por completo que sea— no ve.
   *
   * Hacen falta LOS DOS: con los metodos del Logger sustituidos, lo que el
   * Logger diga ya no llega a stdout, asi que el sello de la salida solo no
   * alcanzaria; y el del Logger solo se perderia un `console.log`.
   *
   * Se instala alrededor de la llamada y se retira en el `finally`: dejar
   * `process.stdout.write` sustituido mas tiempo del necesario se lleva por
   * delante el informe de Jest.
   */
  async function capturandoLaSalida(fn: () => Promise<unknown>): Promise<void> {
    const capturar = (chunk: unknown): boolean => {
      todoLoDicho.push(String(chunk));
      return true;
    };
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(capturar);
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(capturar);

    try {
      await fn();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  }

  it('no dice el nombre ni el email de ningun alumno, lo diga por donde lo diga', async () => {
    const { processor, job } = crearEscenario({ perfiles: [MOROSO_CENTINELA] });

    await capturandoLaSalida(() => processor.process(job));

    const texto = todoLoDicho.join('\n');

    // LA PREMISA, PRIMERO. Sin esto el test seria de los que no pueden fallar:
    // si el espia no capturara nada —porque cambio el nombre de la clase, o
    // porque alguien dejo de loguear— un "no contiene el email" pasaria solo y
    // para siempre. Se comprueba que el log de verdad esta ahi, y se comprueba
    // con un booleano para no volcar el log entero en el informe si falla.
    expect(todoLoDicho.length).toBeGreaterThan(0);
    expect(texto.includes('1 recordatorios de pago')).toBe(true);

    // ⚠️ NO SE USA `expect(texto).not.toContain(email)`: cuando ese falla, Jest
    // IMPRIME EL TEXTO RECIBIDO, o sea que el informe del fallo de una fuga la
    // vuelve a filtrar —al registro de CI, que lo guarda mas tiempo y lo lee mas
    // gente—. Esta forma publica solo la ETIQUETA del dato que se escapo.
    const centinelas: Record<string, string> = {
      'nombre completo del alumno': MOROSO_CENTINELA.usuario.nombreCompleto as string,
      'email del alumno': MOROSO_CENTINELA.usuario.email as string,
    };

    const filtrados = Object.entries(centinelas)
      .filter(([, valor]) => texto.includes(valor))
      .map(([etiqueta]) => etiqueta);

    expect(filtrados).toEqual([]);
  });

  it('lo que SI puede decir: el gimnasio y los numeros, que es el contador de la cabecera', async () => {
    // El contrapeso. Sin este test, la forma barata de pasar el de arriba es no
    // loguear nada — y ese contador por gimnasio ANTES del envio es lo unico que
    // permite ver el mismo dia que la consulta de morosos se rompio.
    const { processor, job } = crearEscenario({ perfiles: [MOROSO_CENTINELA] });

    await capturandoLaSalida(() => processor.process(job));

    const texto = todoLoDicho.join('\n');

    expect(texto.includes('Box Fuego')).toBe(true);
    expect(texto.includes('1 recordatorios de pago sobre 1 alumnos con pack')).toBe(true);
  });
});
