import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ComprobantesService } from '../comprobantes/comprobantes.service';
import type { CrearPagoDto } from '../pagos/dto/crear-pago.dto';
import { PagosService } from '../pagos/pagos.service';
import { CacheDeStats, type ClienteDeCache } from './cache-de-stats';
import { ConsultaMensualDto } from './dto/consulta-mensual.dto';
import { StatsDatos } from './stats.datos';
import { StatsService } from './stats.service';

const ACTOR = { sub: 'admin-1', tenantId: 'gym-1', rol: 'ADMIN_SALON' } as never;

/** Medianoche UTC de ese dia. Las columnas `@db.Date` llegan asi. */
const dia = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/** Un instante con hora, para los `createdAt`, que son timestamps y no fechas. */
const instante = (iso: string): Date => new Date(iso);

// ---------------------------------------------------------------------------
// EL DOBLE DE PRISMA DE TODOS LOS REPORTES
//
// Se define UNA sola vez, aqui, y las Tasks 6, 7 y 8 lo reutilizan. Un doble
// por tarea garantizaria que acaben filtrando distinto, y entonces cada tarea
// estaria probando su propia idea de lo que la base devuelve.
// ---------------------------------------------------------------------------

/**
 * Las tablas que los reportes leen.
 *
 * DOS CORRECCIONES SOBRE LA FORMA QUE TRAIA EL PLAN, las dos contra el schema:
 *
 * - `nombreCompleto` y `email` NO estan en `Perfil`: viven en `Usuario`, y
 *   `Perfil` solo guarda el `usuarioId`. El plan los ponia en `perfiles`, lo
 *   que habria hecho que los reportes de la Task 7 y la 8 se escribieran contra
 *   una tabla que no existe.
 * - El `monto` de un pago y el `precio` de un pack son `Decimal`, no `string`.
 *   Aqui se declaran como string por comodidad de quien escribe un caso, y
 *   `prismaFalso` los envuelve en un Decimal falso al salir: con `toFixed` y
 *   tambien con `toNumber`, porque la unica forma de comprobar que el codigo NO
 *   usa `toNumber` es que el doble lo ofrezca.
 */
export interface Tablas {
  pagos: {
    id: string;
    perfilId: string;
    monto: string;
    metodo: string;
    esSena: boolean;
    anuladoEn: Date | null;
    createdAt: Date;
    cubreDesde: Date;
    cubreHasta: Date;
  }[];
  turnos: {
    id: string;
    salaId: string;
    fecha: Date;
    horaInicio: string;
    horaFin: string;
    cupo: number;
  }[];
  reservas: {
    id: string;
    turnoId: string;
    perfilId: string;
    canceladaEn: Date | null;
    cancelacionTipo: string | null;
    asistio: boolean | null;
  }[];
  usuarios: { id: string; rol: string; nombreCompleto: string; email: string; activo: boolean }[];
  perfiles: { id: string; usuarioId: string; packId: string | null }[];
  packs: { id: string; nombre: string; precio: string | null }[];
  salas: { id: string; nombre: string }[];
  /**
   * Solo lo que `ComprobantesService.aprobar` mira. Esta aqui porque aprobar un
   * comprobante CREA UN PAGO, asi que es una de las escrituras que la caja ve.
   */
  comprobantes: {
    id: string;
    tenantId: string;
    perfilId: string;
    claveArchivo: string;
    nombreOriginal: string;
    tipoMime: string;
    subidoEn: Date | null;
    estado: string;
    revisadoPor: string | null;
    revisadoEn: Date | null;
    nota: string | null;
    createdAt: Date;
  }[];
}

/** Lo poco que el codigo usa del `Decimal` de Prisma, y el metodo prohibido. */
interface DecimalFalso {
  toFixed(digitos: number): string;
  toNumber(): number;
}

const decimal = (texto: string): DecimalFalso => ({
  toFixed: (digitos: number) => Number(texto).toFixed(digitos),
  toNumber: () => Number(texto),
});

/** Comparable con `<` y `>`: las fechas por su tiempo, lo demas tal cual. */
const comparable = (valor: unknown): number | string =>
  valor instanceof Date ? valor.getTime() : (valor as number | string);

/**
 * Filtra de verdad: compara campo a campo e implementa `gte`, `lte`, `gt`,
 * `lt`, `not` e `in`.
 *
 * ES EL PUNTO ENTERO DEL DOBLE. Uno que devolviera siempre la tabla entera
 * dejaria pasar cualquier error de `where`, y entonces las mutaciones que
 * quitan un termino —`anuladoEn: null`, el rango del mes— no romperian nada y
 * los tests pareceran cubrirlo todo sin cubrir nada.
 *
 * `lt` y `gt` no estaban en el plan y hacen falta: el rango del mes es
 * SEMIABIERTO. Ver el docblock de `StatsDatos.pagosDelMes`.
 */
function cumple(fila: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([campo, esperado]) => {
    const valor = fila[campo];

    if (esperado !== null && typeof esperado === 'object' && !(esperado instanceof Date)) {
      const op = esperado as {
        gte?: unknown;
        lte?: unknown;
        gt?: unknown;
        lt?: unknown;
        not?: unknown;
        in?: unknown[];
      };
      if (op.gte !== undefined && !(comparable(valor) >= comparable(op.gte))) return false;
      if (op.lte !== undefined && !(comparable(valor) <= comparable(op.lte))) return false;
      if (op.gt !== undefined && !(comparable(valor) > comparable(op.gt))) return false;
      if (op.lt !== undefined && !(comparable(valor) < comparable(op.lt))) return false;
      if (op.not !== undefined && valor === op.not) return false;
      if (op.in !== undefined && !op.in.includes(valor)) return false;
      return true;
    }

    if (valor instanceof Date && esperado instanceof Date) {
      return valor.getTime() === esperado.getTime();
    }

    return valor === esperado;
  });
}

type Consulta = { where?: Record<string, unknown> } | undefined;

function tabla<T extends Record<string, unknown>>(
  filas: T[],
  decimales: string[] = [],
  defectos: Record<string, unknown> = {},
) {
  const vestir = (fila: T): Record<string, unknown> => {
    const copia: Record<string, unknown> = { ...fila };
    for (const campo of decimales) {
      const crudo = copia[campo];
      copia[campo] = typeof crudo === 'string' ? decimal(crudo) : null;
    }
    return copia;
  };

  const filtrar = (consulta: Consulta): Record<string, unknown>[] =>
    filas.filter((fila) => cumple(fila, consulta?.where ?? {})).map(vestir);

  return {
    findMany: jest.fn((consulta?: Consulta) => Promise.resolve(filtrar(consulta))),
    findFirst: jest.fn((consulta?: Consulta) => Promise.resolve(filtrar(consulta)[0] ?? null)),
    // ESCRIBE DE VERDAD en el mismo array que lee `findMany`. Es lo que permite
    // que el caso de la invalidacion sea el de verdad: se pide la caja, se
    // registra un pago y se vuelve a pedir. Un `create` que no dejara la fila
    // visible daria el mismo '0.00' con el cache invalidado y sin invalidar, y
    // entonces el test no distinguiria los dos comportamientos.
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const fila = { id: `fila-${filas.length + 1}`, ...defectos, ...data } as unknown as T;
      filas.push(fila);
      return Promise.resolve(vestir(fila));
    }),
    update: jest.fn(({ where, data }: { where: Record<string, unknown>; data: Partial<T> }) => {
      const fila = filas.find((candidata) => cumple(candidata, where));
      if (!fila) return Promise.resolve(null);
      Object.assign(fila, data);
      return Promise.resolve(vestir(fila));
    }),
  };
}

/**
 * Lo que Postgres pone en un `Pago` que el service no manda.
 *
 * El `createdAt` es FIJO y no `new Date()` a proposito: la caja se pide por mes,
 * asi que con el reloj real el caso de la invalidacion pasaria o no segun el dia
 * en que se corra la suite.
 */
const DEFECTOS_DE_PAGO = {
  createdAt: instante('2026-10-15T12:00:00.000Z'),
  anuladoEn: null,
  anuladoPor: null,
};

export function prismaFalso(tablas: Partial<Tablas> = {}) {
  const tablasFalsas = {
    pago: tabla(tablas.pagos ?? [], ['monto'], DEFECTOS_DE_PAGO),
    turno: tabla(tablas.turnos ?? []),
    reserva: tabla(tablas.reservas ?? []),
    usuario: tabla(tablas.usuarios ?? []),
    perfil: tabla(tablas.perfiles ?? []),
    pack: tabla(tablas.packs ?? [], ['precio']),
    sala: tabla(tablas.salas ?? []),
    comprobante: tabla(tablas.comprobantes ?? []),
  };

  // El doble de `$transaction` ejecuta el cuerpo y ya: aqui no hay rollback que
  // imitar. Alcanza para que `PagosService.crear` corra entero, que es lo unico
  // que este archivo le pide.
  return {
    ...tablasFalsas,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(tablasFalsas)),
  };
}

/** El cliente de cache en memoria, el mismo que usa `cache-de-stats.spec.ts`. */
function clienteFalso(): { cliente: ClienteDeCache; claves: Map<string, string> } {
  const claves = new Map<string, string>();

  return {
    claves,
    cliente: {
      get: async (clave) => claves.get(clave) ?? null,
      set: async (clave, valor) => {
        claves.set(clave, valor);
      },
      incr: async (clave) => {
        const siguiente = Number(claves.get(clave) ?? '0') + 1;
        claves.set(clave, String(siguiente));
        return siguiente;
      },
    },
  };
}

/** Un pago con lo minimo; el resto por defecto y no anulado. */
function pago(parcial: Partial<Tablas['pagos'][number]> = {}): Tablas['pagos'][number] {
  return {
    id: `pago-${Math.random()}`,
    perfilId: 'alumno-1',
    monto: '1000.00',
    metodo: 'TRANSFERENCIA',
    esSena: false,
    anuladoEn: null,
    createdAt: instante('2026-10-15T12:00:00.000Z'),
    cubreDesde: dia('2026-10-01'),
    cubreHasta: dia('2026-10-31'),
    ...parcial,
  };
}

/**
 * El service real sobre los datos reales, con Prisma y el reloj doblados.
 *
 * `StatsDatos` y `CacheDeStats` van DE VERDAD, al reves de lo que decia el
 * Step 3 del plan. Es lo unico coherente con el Step 2: un doble de `StatsDatos`
 * dejaria el `where` sin escribir, y entonces el doble de Prisma que el propio
 * plan manda escribir bien no probaria nada. Lo que si se dobla es
 * `LiquidacionService` —su calculo tiene su propia tabla de casos en
 * `calcular-importes.spec.ts`— y el cliente de Redis.
 */
function crear(tablas: Partial<Tablas> = {}, aPagarPorProfesor: Record<string, number> = {}) {
  const db = prismaFalso(tablas);
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) } as never;
  const { cliente, claves } = clienteFalso();
  // UN SOLO `CacheDeStats` para los dos servicios, que es lo que hace real al
  // caso de la invalidacion: con una instancia por servicio el `incr` de
  // `PagosService` caeria en un Map distinto del que lee la caja y el test
  // pasaria en verde incluso con la linea borrada. En produccion es el mismo
  // singleton, porque `CacheModule` es global.
  const cache = new CacheDeStats(cliente);
  const pagos = new PagosService({ db } as never, historial, cache);
  const datos = new StatsDatos({ db } as never, pagos);
  const liquidacion = {
    delMes: jest.fn((_actor: unknown, profesorId: string) =>
      Promise.resolve({
        importes: {
          aPagar: { centavos: aPagarPorProfesor[profesorId] ?? 0, texto: '' },
        },
      }),
    ),
  };

  return {
    db,
    claves,
    cache,
    liquidacion,
    pagos,
    servicio: new StatsService(datos, cache, liquidacion as never),
  };
}

/**
 * `ComprobantesService` de verdad, sobre el MISMO Prisma falso y el MISMO
 * cache que la caja. Se arma aparte y no dentro de `crear` porque solo un caso
 * lo necesita, pero comparte las dos piezas que hacen real al test.
 */
function crearComprobantes(
  db: ReturnType<typeof prismaFalso>,
  cache: CacheDeStats,
): ComprobantesService {
  const almacen = { urlDeDescarga: jest.fn().mockResolvedValue('https://almacen/x') };
  const historial = { registrar: jest.fn().mockResolvedValue(undefined) };

  return new ComprobantesService({ db } as never, almacen as never, historial as never, cache);
}

/** Un comprobante subido y sin revisar: el unico estado que se puede aprobar. */
const COMPROBANTE_PENDIENTE: Tablas['comprobantes'][number] = {
  id: 'comp-1',
  tenantId: 'gym-1',
  perfilId: 'alumno-1',
  claveArchivo: 'comp-1.pdf',
  nombreOriginal: 'transferencia.pdf',
  tipoMime: 'application/pdf',
  subidoEn: instante('2026-10-15T10:00:00.000Z'),
  estado: 'PENDIENTE',
  revisadoPor: null,
  revisadoEn: null,
  nota: null,
  createdAt: instante('2026-10-15T09:00:00.000Z'),
};

/** Una profesora con su usuario y su perfil, listos para la liquidacion. */
function profesora(id: string): Pick<Tablas, 'usuarios' | 'perfiles'> {
  return {
    usuarios: [
      { id: `u-${id}`, rol: 'PROFESOR', nombreCompleto: id, email: `${id}@x.io`, activo: true },
    ],
    perfiles: [{ id, usuarioId: `u-${id}`, packId: null }],
  };
}

const OCTUBRE = { anio: 2026, mes: 10 };

describe('StatsService.caja', () => {
  it('las cortesias NO entran en el cobrado, van al bonificado', async () => {
    const { servicio } = crear({
      pagos: [
        pago({ monto: '1000.00', metodo: 'TRANSFERENCIA' }),
        pago({ monto: '500.00', metodo: 'CORTESIA' }),
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    // Una cortesia es un metodo de pago normal y su monto no tiene por que ser
    // cero. Sumarla haria que un mes de regalar cuotas pareciera facturacion.
    expect(caja.cobrado.texto).toBe('1000.00');
    expect(caja.bonificado.texto).toBe('500.00');
  });

  it('el margen es cobrado menos costo de profesoras', async () => {
    const { servicio } = crear(
      { pagos: [pago({ monto: '1000.00' })], ...profesora('prof-1') },
      { 'prof-1': 40_000 },
    );

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.costoProfesoras.texto).toBe('400.00');
    expect(caja.margen.texto).toBe('600.00');
  });

  it('el margen se pone en rojo si las profesoras cuestan mas que lo cobrado', async () => {
    // No es un error ni un caso imposible: es un mes flojo con las clases
    // dadas. Antes de la Task 4, `aTexto` devolvia "0.-1" para un negativo.
    const { servicio } = crear(
      { pagos: [pago({ monto: '100.00' })], ...profesora('prof-1') },
      { 'prof-1': 40_000 },
    );

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.margen.centavos).toBe(-30_000);
    expect(caja.margen.texto).toBe('-300.00');
  });

  it('desglosa el cobrado por metodo, sin la cortesia', async () => {
    const { servicio } = crear({
      pagos: [
        pago({ monto: '1000.00', metodo: 'TRANSFERENCIA' }),
        pago({ monto: '250.00', metodo: 'EFECTIVO' }),
        pago({ monto: '750.00', metodo: 'EFECTIVO' }),
        pago({ monto: '500.00', metodo: 'CORTESIA' }),
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.porMetodo).toEqual([
      { metodo: 'EFECTIVO', importe: { centavos: 100_000, texto: '1000.00' } },
      { metodo: 'TRANSFERENCIA', importe: { centavos: 100_000, texto: '1000.00' } },
    ]);
    expect(caja.porMetodo.map((fila) => fila.metodo)).not.toContain('CORTESIA');
  });

  it('un pago anulado no cuenta', async () => {
    const { servicio, db } = crear({
      pagos: [
        pago({ monto: '1000.00' }),
        pago({ monto: '9999.00', anuladoEn: instante('2026-10-20T10:00:00.000Z') }),
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.cobrado.texto).toBe('1000.00');
    // Y se exige ademas el termino del `where`: el doble filtra campo a campo,
    // asi que un filtro que el service no mande no se nota en el resultado si
    // el caso no trae la fila que lo delataria.
    const consulta = db.pago.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> };
    expect(consulta.where.anuladoEn).toBeNull();
  });

  it('solo cuenta los pagos del mes pedido, incluido el ultimo dia entero', async () => {
    const { servicio } = crear({
      pagos: [
        // El ultimo instante de septiembre: es la caja de septiembre.
        pago({ monto: '111.00', createdAt: instante('2026-09-30T23:59:59.999Z') }),
        // El dia 31 a las once de la noche. Con un `lte` contra la MEDIANOCHE
        // del ultimo dia —que es lo que devuelve `ultimoDiaDelMesUtc`— este
        // cobro desaparecia en silencio.
        pago({ monto: '1000.00', createdAt: instante('2026-10-31T23:00:00.000Z') }),
        // El primer instante de noviembre: ya no es de octubre.
        pago({ monto: '222.00', createdAt: instante('2026-11-01T00:00:00.000Z') }),
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.cobrado.texto).toBe('1000.00');
  });

  it('el primer instante del mes ya cuenta', async () => {
    // El borde de abajo, que el caso anterior no cubria: sin este, cambiar el
    // `gte` por un `gt` no rompia nada y el dia 1 a las 00:00 —que es cuando
    // cae un cobro cargado por un script de cierre— desaparecia.
    const { servicio } = crear({
      pagos: [pago({ monto: '1000.00', createdAt: instante('2026-10-01T00:00:00.000Z') })],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.cobrado.texto).toBe('1000.00');
  });

  it('un mes sin movimiento no revienta: ceros en los cuatro de caja', async () => {
    // El fixture TIENE un alumno con pack a proposito. Sin el, este caso
    // afirmaba `pendienteEstimado: "0.00"` sobre una base vacia y pasaba en
    // verde con el pendiente calculado a dia de hoy, que es justo el bug que se
    // le escapo a la primera version.
    const { servicio } = crear({
      perfiles: [{ id: 'debe', usuarioId: 'u-1', packId: 'pack-8' }],
      packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
    });

    const caja = await servicio.caja(ACTOR, { anio: 2099, mes: 1 });

    expect(caja.cobrado.texto).toBe('0.00');
    expect(caja.bonificado.texto).toBe('0.00');
    expect(caja.costoProfesoras.texto).toBe('0.00');
    expect(caja.margen.texto).toBe('0.00');
    expect(caja.porMetodo).toEqual([]);
    // Y el quinto numero NO es cero, y tiene que no serlo: en enero de 2099 no
    // pago nadie todavia, asi que todo el que tiene pack esta pendiente. Un
    // cero ahi seria "nadie debe nada en 2099", que es lo contrario.
    expect(caja.pendienteEstimado.texto).toBe('8500.00');
  });

  /**
   * EL CASO QUE CAZA EL `.toNumber()`.
   *
   * Un `Decimal(10, 2)` cabe entero en un double, asi que `monto.toNumber()`
   * por si solo no pierde nada y una mutacion literal no rompe ningun test. Lo
   * que rompe es lo que viene DESPUES: en cuanto alguien multiplica por cien
   * para pasar a centavos, `0.29 * 100` da 28.999999999999996 y `1.15 * 100`
   * da 114.99999999999999. Un truncado se come un centavo en cada uno.
   *
   * Por eso los montos de este caso son esos dos exactamente: con `.toFixed(2)`
   * y `aCentavos` —que trabaja sobre digitos y nunca sobre un float— el total
   * es 344 centavos clavados.
   */
  it('los centavos del monto no se pierden al convertirlo', async () => {
    const { servicio } = crear({
      pagos: [
        pago({ monto: '0.29', metodo: 'EFECTIVO' }),
        pago({ monto: '1.15', metodo: 'EFECTIVO' }),
        pago({ monto: '2.00', metodo: 'EFECTIVO' }),
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    expect(caja.cobrado.centavos).toBe(344);
    expect(caja.cobrado.texto).toBe('3.44');
  });

  it('el costo de profesoras sale de la liquidacion de cada una, sumada', async () => {
    const { servicio, liquidacion } = crear(
      {
        usuarios: [
          { id: 'u-1', rol: 'PROFESOR', nombreCompleto: 'Ana', email: 'a@x.io', activo: true },
          { id: 'u-2', rol: 'PROFESOR', nombreCompleto: 'Bea', email: 'b@x.io', activo: false },
          { id: 'u-3', rol: 'ALUMNO', nombreCompleto: 'Caro', email: 'c@x.io', activo: true },
        ],
        perfiles: [
          { id: 'prof-1', usuarioId: 'u-1', packId: null },
          { id: 'prof-2', usuarioId: 'u-2', packId: null },
          { id: 'alumno-1', usuarioId: 'u-3', packId: null },
        ],
      },
      { 'prof-1': 100_000, 'prof-2': 25_000 },
    );

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    // Bea esta dada de baja y se le paga igual: trabajo este mes. Caro es
    // alumna y no aparece.
    expect(caja.costoProfesoras.texto).toBe('1250.00');
    expect(liquidacion.delMes).toHaveBeenCalledTimes(2);
    expect(liquidacion.delMes).toHaveBeenCalledWith(ACTOR, 'prof-1', 2026, 10);
  });

  it('el pendiente estimado suma solo a los que tienen pack y no estan al dia', async () => {
    const { servicio } = crear({
      pagos: [
        // Al dia: su pago cubre hasta muy adelante.
        pago({ perfilId: 'al-dia', cubreDesde: dia('2020-01-01'), cubreHasta: dia('2099-12-31') }),
      ],
      usuarios: [],
      perfiles: [
        // Su pack cuesta OTRA COSA que el de quien debe, a proposito: con los
        // dos al mismo precio, invertir el filtro de "al dia" daba exactamente
        // el mismo total y el caso pasaba en verde con la regla del reves.
        { id: 'al-dia', usuarioId: 'u-1', packId: 'pack-libre' },
        { id: 'debe', usuarioId: 'u-2', packId: 'pack-8' },
        { id: 'debe-sin-precio', usuarioId: 'u-3', packId: 'pack-consultar' },
        // Sin pack no contrato nada, asi que no debe nada.
        { id: 'sin-pack', usuarioId: 'u-4', packId: null },
      ],
      packs: [
        { id: 'pack-8', nombre: '8 clases', precio: '8500.00' },
        { id: 'pack-libre', nombre: 'Libre', precio: '12300.00' },
        { id: 'pack-consultar', nombre: 'A consultar', precio: null },
      ],
    });

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    // Solo `debe`. `debe-sin-precio` aporta cero, no un NaN; `al-dia` no aporta
    // sus 12300 y `sin-pack` no aparece.
    expect(caja.pendienteEstimado.centavos).toBe(850_000);
    expect(caja.pendienteEstimado.texto).toBe('8500.00');
  });

  /**
   * EL PENDIENTE ES DEL MES PEDIDO, NO DE HOY.
   *
   * Sin pasarle la fecha de cierre, `perfilesAlDia` cae en su default
   * `new Date()` y este numero pasa a ser "quien debe hoy" guardado dentro de
   * un reporte indexado por `anio/mes` y cacheado bajo `caja:2026-10`. Se veia
   * pidiendo el mismo mes dos dias distintos y recibiendo numeros distintos, o
   * —peor— pidiendo marzo de 2020 y enero de 2099 y recibiendo el mismo.
   *
   * El reloj se mueve con `setSystemTime` entre las dos llamadas, y cada una
   * usa su propio service para que el cache en memoria no sirva la primera
   * respuesta y tape la diferencia.
   */
  describe('el pendiente se evalua al cierre del mes pedido, no con el reloj', () => {
    const PADRON = {
      pagos: [
        // Cubre octubre de 2026 y nada mas. Visto desde dentro de ese mes esta
        // al dia; visto desde 2027 ya no, pero la caja de octubre no cambia.
        pago({ perfilId: 'cubre-octubre', cubreDesde: dia('2026-10-01'), cubreHasta: dia('2026-10-31') }),
      ],
      perfiles: [{ id: 'cubre-octubre', usuarioId: 'u-1', packId: 'pack-8' }],
      packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
    };

    afterEach(() => {
      jest.useRealTimers();
    });

    it('el mismo mes con dos relojes distintos da el mismo numero', async () => {
      jest.useFakeTimers();

      jest.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
      const dentroDelMes = await crear(PADRON).servicio.caja(ACTOR, OCTUBRE);

      jest.setSystemTime(new Date('2027-05-20T09:00:00.000Z'));
      const mesesDespues = await crear(PADRON).servicio.caja(ACTOR, OCTUBRE);

      expect(dentroDelMes.pendienteEstimado).toEqual(mesesDespues.pendienteEstimado);
      // Y el numero correcto es cero: al cerrar octubre, su pago lo cubria.
      expect(dentroDelMes.pendienteEstimado.texto).toBe('0.00');
    });

    it('un mes futuro no es "no debe nadie": todavia no pago ninguno', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));

      const caja = await crear(PADRON).servicio.caja(ACTOR, { anio: 2027, mes: 3 });

      // Hoy esta al dia, pero marzo de 2027 no lo paga su pago de octubre.
      expect(caja.pendienteEstimado.texto).toBe('8500.00');
    });
  });

  it('el cache se indexa por el tenant del actor, nunca por un parametro', async () => {
    const { servicio, claves } = crear({ pagos: [pago({ monto: '1000.00' })] });

    await servicio.caja(ACTOR, OCTUBRE);

    // Si el service se equivocara de tenant, el cache guardaria feliz el numero
    // de un gimnasio bajo la clave de otro: no tiene forma de comprobarlo.
    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:caja:2026-10']);
  });

  it('la segunda llamada no vuelve a consultar la base', async () => {
    const { servicio, db } = crear({ pagos: [pago({ monto: '1000.00' })] });

    await servicio.caja(ACTOR, OCTUBRE);
    const segunda = await servicio.caja(ACTOR, OCTUBRE);

    expect(segunda.cobrado.texto).toBe('1000.00');
    expect(db.pago.findMany).toHaveBeenCalledTimes(1);
  });
});

/**
 * EL CASO QUE JUSTIFICA LA TASK 5 ENTERA.
 *
 * Es la llamada de soporte escrita como test: "cargue el cobro y la caja no lo
 * muestra". Sin la invalidacion, el caso de arriba —`la segunda llamada no
 * vuelve a consultar la base`— es exactamente el bug: la caja sigue sirviendo
 * el numero de antes durante cinco minutos, y a los cinco minutos ya nadie se
 * acuerda de que habia un cache; lo que queda es un panel marcado como poco
 * confiable para siempre.
 *
 * Va con el `CacheDeStats` REAL y su contador, no con un doble que diga que si:
 * un `expect(cache.invalidar).toHaveBeenCalled()` comprueba que se llamo a un
 * metodo, no que el numero cambie. Lo que este caso afirma es el numero.
 */
describe('StatsService.caja despues de una escritura', () => {
  const ALTA: CrearPagoDto = {
    perfilId: 'alumno-1',
    monto: '25000.00',
    metodo: 'EFECTIVO',
    cubreDesde: '2026-10-01',
    cubreHasta: '2026-10-31',
  };

  /** El alumno tiene que existir: `PagosService.crear` da 404 sin perfil. */
  const SOLO_UN_ALUMNO = {
    perfiles: [{ id: 'alumno-1', usuarioId: 'u-1', packId: null }],
  };

  it('un pago recien registrado se ve en la caja, sin esperar al TTL', async () => {
    const { servicio, pagos } = crear(SOLO_UN_ALUMNO);

    const antes = await servicio.caja(ACTOR, OCTUBRE);
    expect(antes.cobrado.texto).toBe('0.00');

    await pagos.crear(ACTOR, ALTA);

    const despues = await servicio.caja(ACTOR, OCTUBRE);

    expect(despues.cobrado.texto).toBe('25000.00');
  });

  it('la invalidacion es el contador de version, no un borrado de claves', async () => {
    const { servicio, pagos, claves } = crear(SOLO_UN_ALUMNO);

    await servicio.caja(ACTOR, OCTUBRE);
    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:caja:2026-10']);

    await pagos.crear(ACTOR, ALTA);

    // La clave vieja SIGUE AHI, huerfana: nadie la vuelve a leer porque la
    // version ya es otra, y el TTL se la lleva. Es el punto entero del diseno —
    // un reporte que se agregue manana queda invalidado sin que nadie tenga que
    // acordarse de sumarlo a ninguna lista.
    expect(claves.get('stats:gym-1:version')).toBe('1');
    expect(claves.has('stats:gym-1:v0:caja:2026-10')).toBe(true);

    await servicio.caja(ACTOR, OCTUBRE);

    expect(claves.has('stats:gym-1:v1:caja:2026-10')).toBe(true);
  });

  it('poner a un alumno al dia baja el pendiente estimado sin esperar al TTL', async () => {
    // El sexto sitio, por la otra puerta: `fijarEstado` no toca `cobrado`, pero
    // una cortesia que cubre hoy saca al alumno de los que deben. Sin invalidar,
    // la caja seguiria diciendo que debe 8500 cinco minutos despues de que el
    // admin lo puso al dia a mano.
    const { servicio, pagos } = crear({
      perfiles: [{ id: 'alumno-1', usuarioId: 'u-1', packId: 'pack-8' }],
      packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
    });

    const antes = await servicio.caja(ACTOR, OCTUBRE);
    expect(antes.pendienteEstimado.centavos).toBe(850_000);

    await pagos.fijarEstado(ACTOR, 'alumno-1', { alDia: true, cubreHasta: '2099-12-31' });

    const despues = await servicio.caja(ACTOR, OCTUBRE);

    expect(despues.pendienteEstimado.centavos).toBe(0);
  });

  it('aprobar un comprobante tambien se ve en la caja al instante', async () => {
    // `ComprobantesService.aprobar` crea el pago en su propia transaccion, pero
    // sobre la MISMA tabla: para la caja es un cobro como cualquier otro. Se
    // arma aqui con el cache compartido para que el caso sea el de verdad —se
    // pide la caja, se aprueba, se vuelve a pedir— y no un `toHaveBeenCalled`.
    const { servicio, db, cache } = crear({
      perfiles: [{ id: 'alumno-1', usuarioId: 'u-1', packId: null }],
      comprobantes: [COMPROBANTE_PENDIENTE],
    });
    const comprobantes = crearComprobantes(db, cache);

    const antes = await servicio.caja(ACTOR, OCTUBRE);
    expect(antes.cobrado.texto).toBe('0.00');

    await comprobantes.aprobar(ACTOR, 'comp-1', { monto: '25000.00', cubreHasta: '2099-12-31' });

    const despues = await servicio.caja(ACTOR, OCTUBRE);

    expect(despues.cobrado.texto).toBe('25000.00');
  });

  it('anular un pago tambien lo saca de la caja al instante', async () => {
    const { servicio, pagos } = crear(SOLO_UN_ALUMNO);

    const creado = await pagos.crear(ACTOR, ALTA);
    expect((await servicio.caja(ACTOR, OCTUBRE)).cobrado.texto).toBe('25000.00');

    await pagos.anular(ACTOR, creado.id);

    expect((await servicio.caja(ACTOR, OCTUBRE)).cobrado.texto).toBe('0.00');
  });
});

/**
 * EL PARAMETRO QUE NO EXISTE.
 *
 * La spec pedia `/stats/caja?mes=&anio=&salaId=`. El `salaId` se quito: un
 * `Pago` no tiene sala, repartirlo entre salas seria la atribucion de ingresos
 * que la seccion 3 descarto, y acotar solo el costo daria un margen que mezcla
 * el costo de una sala con lo cobrado de todas. El porque entero esta en el
 * docblock de `StatsService.caja`.
 *
 * Aceptarlo e ignorarlo era la version anterior de esto y era peor: un
 * parametro que se acepta y no hace nada es una mentira con codigo 200.
 *
 * Este caso fija que mandarlo da 400 y no 200, que es lo unico que separa "no
 * se puede preguntar eso" de "pregunte y me contestaron". Se prueba contra el
 * ValidationPipe real con la MISMA configuracion que `main.ts`, porque la
 * garantia no esta en el DTO sino en `forbidNonWhitelisted`.
 */
describe('ConsultaMensualDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const comoQuery = { type: 'query' as const, metatype: ConsultaMensualDto };

  it('transforma los strings de la query en numeros', async () => {
    await expect(pipe.transform({ anio: '2026', mes: '10' }, comoQuery)).resolves.toEqual({
      anio: 2026,
      mes: 10,
    });
  });

  it('400 si se manda un salaId: la caja no se puede partir por sala', async () => {
    await expect(
      pipe.transform({ anio: '2026', mes: '10', salaId: 'sala-1' }, comoQuery),
    ).rejects.toThrow(BadRequestException);
  });

  it('400 si el mes no existe', async () => {
    await expect(pipe.transform({ anio: '2026', mes: '13' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });
});
