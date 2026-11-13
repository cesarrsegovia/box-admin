import { Logger } from '@nestjs/common';
import { getTenantContext } from '../../common/tenant/tenant-context';
import type { MensajeroService } from '../../comunicacion/mensajero.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { VencimientoPackProcessor } from './vencimiento-pack.processor';

type Fila = Record<string, any>;
/** El job tal como lo pide el processor. */
type JobDelProcessor = Parameters<VencimientoPackProcessor['process']>[0];

/** El reloj del job: un lunes a media manana. La ventana empieza a medianoche. */
const AHORA = '2026-10-05T08:30:00.000Z';

const FUEGO = {
  id: 'gym-1',
  nombre: 'Box Fuego',
  activo: true,
  slug: 'box-fuego',
  diasAvisoVencimiento: 7,
};
const HIELO = {
  id: 'gym-2',
  nombre: 'Box Hielo',
  activo: true,
  slug: 'box-hielo',
  diasAvisoVencimiento: 7,
};
const CERRADO = {
  id: 'gym-3',
  nombre: 'Box Cerrado',
  activo: false,
  slug: 'box-cerrado',
  diasAvisoVencimiento: 7,
};

/** El mismo gimnasio con una ventana mas larga: 14 dias en vez de 7. */
const FUEGO_QUINCENAL = { ...FUEGO, diasAvisoVencimiento: 14 };

/**
 * Y con la ventana en 0. NO significa "no avisar": significa "avisar el mismo
 * dia que vence", porque la ventana `[hoy, hoy + dias]` es inclusiva por los dos
 * lados. Es una decision implicita que no estaba escrita en ningun sitio.
 */
const FUEGO_MISMO_DIA = { ...FUEGO, diasAvisoVencimiento: 0 };

function alumno(
  id: string,
  tenantId: string,
  nombre: string,
  vence: string | null,
  extra: Fila = {},
): Fila {
  return {
    id,
    tenantId,
    // Columna @db.Date: Prisma la devuelve a medianoche UTC.
    vigenciaHasta: vence === null ? null : new Date(`${vence}T00:00:00.000Z`),
    usuario: {
      rol: 'ALUMNO',
      activo: true,
      nombreCompleto: nombre,
      email: `${nombre.toLowerCase()}@correo.test`,
    },
    ...extra,
  };
}

const VENCE_EN_5 = alumno('perfil-ana', 'gym-1', 'Ana', '2026-10-10');
const VENCE_HOY = alumno('perfil-beto', 'gym-1', 'Beto', '2026-10-05');
const VENCE_MANANA = alumno('perfil-fran', 'gym-1', 'Fran', '2026-10-06');
const VENCIO_AYER = alumno('perfil-carla', 'gym-1', 'Carla', '2026-10-04');
const VENCE_EN_10 = alumno('perfil-dani', 'gym-1', 'Dani', '2026-10-15');
const VENCE_EN_30 = alumno('perfil-eva', 'gym-1', 'Eva', '2026-11-04');
const SIN_VIGENCIA = alumno('perfil-gus', 'gym-1', 'Gus', null);

const DE_BAJA = alumno('perfil-baja', 'gym-1', 'Hugo', '2026-10-10', {
  usuario: { rol: 'ALUMNO', activo: false, nombreCompleto: 'Hugo', email: 'hugo@correo.test' },
});

const PROFE = alumno('perfil-profe', 'gym-1', 'Ivan', '2026-10-10', {
  usuario: { rol: 'PROFESOR', activo: true, nombreCompleto: 'Ivan', email: 'ivan@correo.test' },
});

interface Escenario {
  tenants?: Fila[];
  perfiles?: Fila[];
  ahoraISO?: string;
  /**
   * Marcas que YA estaban en `AvisoDiario`. Sin `tipo` ni `dia`, valen los de
   * esta ejecucion: un job que vuelve a correr el mismo dia.
   */
  marcas?: { perfilId: string; tipo?: string; dia?: string }[];
  /** Perfiles cuyo `create` de la marca revienta con un error que no es P2002. */
  fallosAlMarcar?: string[];
}

/**
 * Monta el processor con sus dos dobles.
 *
 * El de PRISMA emula la EXTENSION de aislamiento —exige contexto y filtra por
 * tenant— y aplica el WHERE de verdad, incluido el RANGO sobre `vigenciaHasta`.
 * Sin el rango de verdad, cambiar la ventana no cambiaria nada y los tests de
 * dentro/fuera no comprobarian nada.
 */
function crearEscenario(escenario: Escenario = {}) {
  const tenants = escenario.tenants ?? [FUEGO];
  const perfiles = escenario.perfiles ?? [];

  const pasos: string[] = [];
  const contextoAlListarTenants: string[] = [];
  const tenantsConsultados: string[] = [];
  /** El rango con el que se consulto cada gimnasio. */
  const rangos: { gte: Date; lte: Date }[] = [];
  /** El `dia` con el que se intento cada marca, en ISO. */
  const diasMarcados: string[] = [];

  const diaDelJob = (escenario.ahoraISO ?? AHORA).slice(0, 10);
  const marcas = new Set(
    (escenario.marcas ?? []).map((marca) => {
      const tenantId = perfiles.find((p) => p.id === marca.perfilId)?.tenantId as string;
      const dia = new Date(`${marca.dia ?? diaDelJob}T00:00:00.000Z`).toISOString();
      return `${tenantId}|${marca.tipo ?? 'vencimiento-pack'}|${marca.perfilId}|${dia}`;
    }),
  );

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
      if (esperado !== null && typeof esperado === 'object') {
        const rango = esperado as { gte?: Date; lte?: Date };
        const valor = fila[campo] as Date | null;
        // Un rango sobre una columna nullable NO devuelve los nulos, igual que
        // en Postgres: `null >= fecha` no es verdadero, es desconocido.
        if (valor === null || valor === undefined) return false;
        if (rango.gte !== undefined && valor.getTime() < rango.gte.getTime()) return false;
        if (rango.lte !== undefined && valor.getTime() > rango.lte.getTime()) return false;
        return true;
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
        const visibles =
          ctx.kind === 'tenant' ? tenants.filter((t) => t.id === ctx.tenantId) : tenants;
        return visibles.filter((fila) => cumple(fila, where ?? {}));
      },
    },
    perfil: {
      async findMany({ where }: { where: Fila }): Promise<Fila[]> {
        const tenantId = tenantActual();
        tenantsConsultados.push(tenantId);
        if (where?.vigenciaHasta) rangos.push(where.vigenciaHasta as { gte: Date; lte: Date });
        return perfiles.filter((fila) => fila.tenantId === tenantId && cumple(fila, where ?? {}));
      },
    },
    // La marca por persona, con la clave unica de la base. Ver el doble gemelo
    // de `recordatorio-pago.processor.spec.ts`.
    avisoDiario: {
      async create({ data }: { data: Fila }): Promise<Fila> {
        const tenantId = tenantActual();
        const dia = (data.dia as Date).toISOString();
        pasos.push(`marca:${data.perfilId}`);
        diasMarcados.push(dia);

        if (escenario.fallosAlMarcar?.includes(data.perfilId as string)) {
          throw new Error('la base no respondio');
        }
        if (data.tenantId !== tenantId) {
          throw new Error(
            `marca con tenantId ${String(data.tenantId)} dentro del gimnasio ${tenantId}`,
          );
        }
        const clave = `${tenantId}|${data.tipo}|${data.perfilId}|${dia}`;
        if (marcas.has(clave)) {
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        marcas.add(clave);
        return data;
      },
    },
  };

  const avisar = jest.fn().mockImplementation((destinatario: Fila) => {
    pasos.push(`aviso:${destinatario.perfilId}`);
    return Promise.resolve();
  });

  // El JOB ya no guarda marca (vive en `AvisoDiario`): el `updateData` espiado
  // esta solo para poder decir que nadie lo llama.
  const job = {
    id: 'job-diario',
    data: { ahoraISO: escenario.ahoraISO ?? AHORA } as Fila,
    updateData: jest.fn(),
  };

  return {
    processor: new VencimientoPackProcessor(
      { db } as unknown as PrismaService,
      { avisar } as unknown as MensajeroService,
    ),
    job: job as unknown as JobDelProcessor,
    avisar,
    pasos,
    rangos,
    diasMarcados,
    updateData: job.updateData,
    contextoAlListarTenants,
    tenantsConsultados,
  };
}

function destinatarios(avisar: jest.Mock): string[] {
  return avisar.mock.calls.map((llamada) => (llamada[0] as Fila).email as string);
}

describe('VencimientoPackProcessor', () => {
  let logueado: jest.SpyInstance;

  beforeEach(() => {
    logueado = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // La ventana.
  // --------------------------------------------------------------------------

  it('avisa a quien vence DENTRO de la ventana', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_5] });

    const resultado = await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
    expect(resultado).toEqual({ avisados: 1 });
  });

  it('avisa a quien vence HOY MISMO', async () => {
    // La ventana arranca en la MEDIANOCHE de hoy, no en la hora del job: con
    // `ahora` a secas, quien vence hoy quedaria fuera por ocho horas y media, y
    // es justo a quien mas urge avisarle.
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_HOY] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['beto@correo.test']);
  });

  it('no avisa a quien ya vencio ayer', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCIO_AYER] });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('no avisa a quien vence dentro de treinta dias', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_30] });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('un perfil sin vigenciaHasta no recibe nada', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [SIN_VIGENCIA] });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('LA VENTANA LA MANDA EL TENANT, no una constante del processor', async () => {
    // El mismo alumno, la misma fecha, el mismo dia: lo unico que cambia es
    // `diasAvisoVencimiento`. Con 7 esta fuera; con 14, dentro. Una constante
    // en el processor ignoraria la configuracion del gimnasio en silencio.
    const conSiete = crearEscenario({ perfiles: [VENCE_EN_10] });
    await conSiete.processor.process(conSiete.job);
    expect(conSiete.avisar).not.toHaveBeenCalled();

    const conCatorce = crearEscenario({ tenants: [FUEGO_QUINCENAL], perfiles: [VENCE_EN_10] });
    await conCatorce.processor.process(conCatorce.job);
    expect(destinatarios(conCatorce.avisar)).toEqual(['dani@correo.test']);

    // Y el rango que llega a la consulta es exactamente hoy + los dias del tenant.
    expect(conSiete.rangos[0]).toEqual({
      gte: new Date('2026-10-05T00:00:00.000Z'),
      lte: new Date('2026-10-12T00:00:00.000Z'),
    });
    expect(conCatorce.rangos[0]).toEqual({
      gte: new Date('2026-10-05T00:00:00.000Z'),
      lte: new Date('2026-10-19T00:00:00.000Z'),
    });
  });

  it('con la ventana en 0, quien vence MANANA no recibe nada', async () => {
    // El borde exacto por arriba. Un `lte` que se volviera `lt` lo cambiaria en
    // silencio, y con ventana 0 no quedaria nadie a quien avisar nunca.
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO_MISMO_DIA],
      perfiles: [VENCE_MANANA],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  it('con la ventana en 0, quien vence HOY si recibe: 0 es "el mismo dia", no "no avisar"', async () => {
    const { processor, job, avisar, rangos } = crearEscenario({
      tenants: [FUEGO_MISMO_DIA],
      perfiles: [VENCE_HOY, VENCE_MANANA],
    });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['beto@correo.test']);
    // La ventana degenera en un solo dia, no en un rango vacio.
    expect(rangos[0]).toEqual({
      gte: new Date('2026-10-05T00:00:00.000Z'),
      lte: new Date('2026-10-05T00:00:00.000Z'),
    });
  });

  it('cada gimnasio usa SU ventana en la misma corrida', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, { ...HIELO, diasAvisoVencimiento: 14 }],
      perfiles: [VENCE_EN_10, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-15')],
    });

    await processor.process(job);

    // Dani (gym-1, ventana de 7) queda fuera; Gus (gym-2, ventana de 14) entra.
    expect(destinatarios(avisar)).toEqual(['gus@correo.test']);
  });

  it('la ruta del push lleva el slug del gimnasio DE ESA VUELTA, no el del primero', async () => {
    // Si el slug se calculara una vez fuera del bucle, al alumno del segundo
    // gimnasio la notificacion le abriria el gimnasio del primero: sin fuga de
    // datos —el layout compara el slug contra la cookie— pero con una
    // redireccion al login que no es el suyo.
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [VENCE_EN_5, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-08')],
    });

    await processor.process(job);

    expect(avisar.mock.calls[0]?.[3]).toBe('/box-fuego/mi-pack');
    expect(avisar.mock.calls[1]?.[3]).toBe('/box-hielo/mi-pack');
  });

  // --------------------------------------------------------------------------
  // A quien NO se le escribe.
  // --------------------------------------------------------------------------

  it('no avisa a un alumno dado de baja', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_5, DE_BAJA] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('no avisa a un profesor', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_5, PROFE] });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('un gimnasio dado de baja no recibe nada', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [CERRADO],
      perfiles: [alumno('perfil-zoe', 'gym-3', 'Zoe', '2026-10-10')],
    });

    await processor.process(job);

    expect(avisar).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Un job diario no tiene tenant.
  // --------------------------------------------------------------------------

  it('lista los gimnasios SIN contexto de tenant, y consulta cada uno DENTRO del suyo', async () => {
    const { processor, job, contextoAlListarTenants, tenantsConsultados } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [VENCE_EN_5, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-08')],
    });

    await processor.process(job);

    expect(contextoAlListarTenants).toEqual(['unscoped']);
    expect(tenantsConsultados).toEqual(['gym-1', 'gym-2']);
  });

  // --------------------------------------------------------------------------
  // Lo que se manda.
  // --------------------------------------------------------------------------

  it('manda el tipo VENCIMIENTO_PACK con la fecha LEGIBLE, y nada mas', async () => {
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_5] });

    await processor.process(job);

    const [destinatario, tipo, datos, url] = avisar.mock.calls[0] as [Fila, string, Fila, string];

    expect(destinatario).toEqual({
      perfilId: 'perfil-ana',
      email: 'ana@correo.test',
      nombre: 'Ana',
    });
    expect(tipo).toBe('VENCIMIENTO_PACK');
    // `toEqual` y no `objectContaining`: la forma EXACTA. Ni `clase` ni `hora`
    // en blanco — esta plantilla no los usa y `DatosDePlantilla` no los exige.
    expect(datos).toEqual({
      alumno: 'Ana',
      gimnasio: 'Box Fuego',
      fecha: 'sábado 10 de octubre',
    });
    // Y no "2026-10-10", que es lo que daria aFechaISO: el email lo lee un
    // alumno, no un sistema.
    expect(datos.fecha).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    // CON EL SLUG: la pantalla vive en `/<slug>/mi-pack`, y un `/mi-pack`
    // pelado abre un 404 con la aplicacion cerrada.
    expect(url).toBe('/box-fuego/mi-pack');
  });

  // --------------------------------------------------------------------------
  // Contar antes de mandar.
  // --------------------------------------------------------------------------

  it('loguea cuantos avisos va a mandar cada gimnasio ANTES de mandarlos', async () => {
    const { processor, job, pasos } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [VENCE_EN_5, VENCE_HOY, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-08')],
    });

    logueado.mockImplementation((mensaje: unknown) => {
      pasos.push(`log:${String(mensaje)}`);
      return undefined;
    });

    await processor.process(job);

    expect(pasos).toEqual([
      'log:Box Fuego: 2 avisos de vencimiento con ventana de 7 dias',
      'marca:perfil-ana',
      'aviso:perfil-ana',
      'marca:perfil-beto',
      'aviso:perfil-beto',
      'log:Box Hielo: 1 avisos de vencimiento con ventana de 7 dias',
      'marca:perfil-gus',
      'aviso:perfil-gus',
      expect.stringContaining('Vencimiento de pack: 3 avisos en 2 gimnasios'),
    ]);
  });

  // --------------------------------------------------------------------------
  // DEUDA ACEPTADA, fijada aqui a proposito.
  // --------------------------------------------------------------------------

  it('DEUDA CONOCIDA: el mismo pack recibe un aviso cada dia que sigue en la ventana', async () => {
    // Esto NO es el comportamiento deseado, es el aceptado: sin una columna de
    // "ya avisado" en Perfil, un pack que vence dentro de siete dias manda OCHO
    // correos —la ventana es inclusiva por los dos lados—. Esta hablado con
    // Cesar y va en una fase posterior. El test existe para que el dia que se
    // arregle, ROMPA — y no para bendecirlo.
    const hoy = crearEscenario({ perfiles: [VENCE_EN_5] });
    await hoy.processor.process(hoy.job);

    const manana = crearEscenario({ perfiles: [VENCE_EN_5], ahoraISO: '2026-10-06T08:30:00.000Z' });
    await manana.processor.process(manana.job);

    expect(hoy.avisar).toHaveBeenCalledTimes(1);
    expect(manana.avisar).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // LA MARCA POR PERSONA (`AvisoDiario`). `attempts: 1` NO impide una segunda
  // ejecucion: el camino de job atascado de BullMQ re-encola sin mirar
  // `attempts`. El porque entero esta en la cabecera de
  // `recordatorio-pago.processor.ts`.
  // --------------------------------------------------------------------------

  it('quien ya tiene la marca de hoy NO recibe el aviso, y los demas si', async () => {
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [VENCE_EN_5, VENCE_HOY, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-08')],
      // Asi esta la base cuando BullMQ devuelve el job a la cola por atasco.
      marcas: [{ perfilId: 'perfil-ana' }],
    });

    const resultado = await processor.process(job);

    // Ana NO recibe un segundo aviso; Beto, del MISMO gimnasio, y Gus si.
    expect(destinatarios(avisar)).toEqual(['beto@correo.test', 'gus@correo.test']);
    expect(resultado).toEqual({ avisados: 2 });
  });

  it('el recordatorio de pago de hoy no tapa el aviso de vencimiento', async () => {
    const { processor, job, avisar } = crearEscenario({
      perfiles: [VENCE_EN_5],
      marcas: [{ perfilId: 'perfil-ana', tipo: 'recordatorio-pago' }],
    });

    await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['ana@correo.test']);
  });

  it('un fallo al marcar a UNA persona no aborta la tanda: esa se salta, las demas reciben', async () => {
    const errores = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { processor, job, avisar } = crearEscenario({
      tenants: [FUEGO, HIELO],
      perfiles: [VENCE_EN_5, VENCE_HOY, alumno('perfil-gus', 'gym-2', 'Gus', '2026-10-08')],
      fallosAlMarcar: ['perfil-ana'],
    });

    const resultado = await processor.process(job);

    expect(destinatarios(avisar)).toEqual(['beto@correo.test', 'gus@correo.test']);
    expect(resultado).toEqual({ avisados: 2 });
    expect(errores).toHaveBeenCalledTimes(1);
    expect(String(errores.mock.calls[0]?.[0])).toContain('perfil-ana');
    expect(String(errores.mock.calls[0]?.[0])).toContain('la base no respondio');
  });

  it('la marca se inserta ANTES de mandar, persona por persona', async () => {
    const { processor, job, pasos } = crearEscenario({ perfiles: [VENCE_EN_5, VENCE_HOY] });

    await processor.process(job);

    expect(pasos).toEqual([
      'marca:perfil-ana',
      'aviso:perfil-ana',
      'marca:perfil-beto',
      'aviso:perfil-beto',
    ]);
  });

  it('la marca lleva el DIA DEL JOB, no el del reloj', async () => {
    const { processor, job, diasMarcados } = crearEscenario({
      perfiles: [VENCE_EN_5],
      ahoraISO: '2026-10-07T23:30:00.000Z',
    });

    await processor.process(job);

    expect(diasMarcados).toEqual(['2026-10-07T00:00:00.000Z']);
  });

  it('ya no escribe nada en el payload del job', async () => {
    const { processor, job, updateData } = crearEscenario({ perfiles: [VENCE_EN_5] });

    await processor.process(job);

    expect(updateData).not.toHaveBeenCalled();
    expect(job.data).toEqual({ ahoraISO: AHORA });
  });

  // --------------------------------------------------------------------------
  // El aviso se PIERDE si el SMTP falla, y el job termina OK igual.
  // --------------------------------------------------------------------------

  it('un envio que no sale no tumba la tanda: `avisar` no lanza, y el job cuenta intentos', async () => {
    // Asi se comporta `MensajeroService.avisar` con el SMTP caido: se traga el
    // error, deja un `logger.warn` y devuelve. El aviso se pierde y el contador
    // dice 2, porque cuenta intentos y no entregas. Y como las dos personas ya
    // quedaron marcadas, esos avisos NO se reintentan hoy: salen manana, si el pack
    // sigue en la ventana. Queda fijado para que nadie lea "avisados: 2" como
    // "llegaron 2".
    const { processor, job, avisar } = crearEscenario({ perfiles: [VENCE_EN_5, VENCE_HOY] });
    avisar.mockResolvedValue(undefined);

    const resultado = await processor.process(job);

    expect(resultado).toEqual({ avisados: 2 });
  });
});
