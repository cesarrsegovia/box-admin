import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ComprobantesService } from '../comprobantes/comprobantes.service';
import type { CrearPagoDto } from '../pagos/dto/crear-pago.dto';
import { PagosService } from '../pagos/pagos.service';
import { CacheDeStats, type ClienteDeCache } from './cache-de-stats';
import { ConsultaMensualDto } from './dto/consulta-mensual.dto';
import { ConsultaOperativaDto } from './dto/consulta-operativa.dto';
import { ConsultaPagosPendientesDto } from './dto/consulta-pagos-pendientes.dto';
import { ConsultaRangoDto } from './dto/consulta-rango.dto';
import { ConsultaTurnosLibresDto } from './dto/consulta-turnos-libres.dto';
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
  /**
   * `cupoBase` es opcional porque casi ningun caso lo necesita, pero EXISTE en
   * el schema y tiene que existir aqui: es el cupo de la SALA, el valor por
   * defecto con el que se crea un turno. Esta en el doble para que la mutacion
   * "la ocupacion usa el cupo de la sala" se pueda escribir y correr; sin el,
   * esa mutacion no seria "no rompio nada", seria "no se pudo intentar".
   */
  salas: { id: string; nombre: string; cupoBase?: number | null }[];
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
      // El vencimiento de la clave de version no cambia nada de lo que este
      // archivo prueba; vive en `cache-de-stats.spec.ts`.
      expire: async () => 1,
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

/**
 * Los `usuarios` de unos perfiles de alumno: rol ALUMNO y en alta.
 *
 * HACE FALTA EN TODO FIXTURE QUE TENGA ALUMNOS, y antes de la revision de la
 * Task 8 no hacia falta en los de la caja ni en los de la cobranza: ese es
 * justamente el bug que se corrigio. `perfilesConPack()` no miraba el rol ni el
 * `activo`, asi que un `Perfil` suelto, sin ningun `Usuario` detras, contaba
 * como alumno que debe. La misma persona era "no es alumno" para la composicion
 * y "alumno que debe" para los otros tres reportes.
 */
function alumnosEnAlta(...usuarioIds: string[]): Tablas['usuarios'] {
  return usuarioIds.map((id, indice) => ({
    id,
    rol: 'ALUMNO',
    nombreCompleto: `Alumno ${indice + 1}`,
    email: `${id}@x.io`,
    activo: true,
  }));
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
      usuarios: alumnosEnAlta('u-1'),
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
      usuarios: alumnosEnAlta('u-1', 'u-2', 'u-3', 'u-4'),
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
        pago({
          perfilId: 'cubre-octubre',
          cubreDesde: dia('2026-10-01'),
          cubreHasta: dia('2026-10-31'),
        }),
      ],
      usuarios: alumnosEnAlta('u-1'),
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
      usuarios: alumnosEnAlta('u-1'),
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

// ---------------------------------------------------------------------------
// TASK 6: /stats/operativo
//
// LO DIFICIL DE ESTE REPORTE NO SON LAS CONSULTAS, SON LAS DEFINICIONES. Un
// porcentaje mal definido no da error: da un numero plausible y equivocado, y
// el admin toma decisiones con el. Por eso casi todos los casos de aqui abajo
// afirman ademas lo que el numero NO tiene que ser.
// ---------------------------------------------------------------------------

/** Un turno de octubre en la sala principal; el cupo es lo que cada caso mueve. */
function turno(parcial: Partial<Tablas['turnos'][number]> = {}): Tablas['turnos'][number] {
  return {
    id: 'turno-1',
    salaId: 'sala-1',
    fecha: dia('2026-10-05'),
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 10,
    ...parcial,
  };
}

/** Una reserva viva, sin lista pasada: el estado en el que nacen todas. */
function reserva(parcial: Partial<Tablas['reservas'][number]> = {}): Tablas['reservas'][number] {
  return {
    id: `res-${Math.random()}`,
    turnoId: 'turno-1',
    perfilId: 'alumno-1',
    canceladaEn: null,
    cancelacionTipo: null,
    asistio: null,
    ...parcial,
  };
}

/** La sala de los fixtures, con el cupo que la ocupacion NO tiene que usar. */
const SALA_PRINCIPAL: Tablas['salas'][number] = { id: 'sala-1', nombre: 'Principal', cupoBase: 10 };

/** Tres alumnos en alta, sin pack: los reportes de clases no miran el pack. */
const PADRON_DE_ALUMNOS = {
  usuarios: [
    { id: 'u-1', rol: 'ALUMNO', nombreCompleto: 'Ana', email: 'ana@x.io', activo: true },
    { id: 'u-2', rol: 'ALUMNO', nombreCompleto: 'Bruno', email: 'bruno@x.io', activo: true },
    { id: 'u-3', rol: 'ALUMNO', nombreCompleto: 'Carla', email: 'carla@x.io', activo: true },
  ],
  perfiles: [
    { id: 'a-1', usuarioId: 'u-1', packId: null },
    { id: 'a-2', usuarioId: 'u-2', packId: null },
    { id: 'a-3', usuarioId: 'u-3', packId: null },
  ],
};

describe('StatsService.operativo: ocupacion', () => {
  it('la ocupacion usa el cupo DEL TURNO', async () => {
    // Dos turnos de la MISMA sala con cupos distintos. Es el caso que separa
    // las dos definiciones: por turno el denominador es 10 + 2 = 12; por sala
    // seria 10 + 10 = 20, y el porcentaje saldria 20% en vez de 33,33%.
    const { servicio } = crear({
      salas: [SALA_PRINCIPAL],
      turnos: [turno({ id: 'turno-1', cupo: 10 }), turno({ id: 'turno-2', cupo: 2 })],
      reservas: [
        reserva({ turnoId: 'turno-1' }),
        reserva({ turnoId: 'turno-1' }),
        reserva({ turnoId: 'turno-2' }),
        reserva({ turnoId: 'turno-2' }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.ocupacion).toEqual({
      numerador: 4,
      denominador: 12,
      porcentaje: 33.33,
    });
    // Y lo que NO puede ser: el cupo de la sala daria exactamente esto.
    expect(operativo.actual.ocupacion.porcentaje).not.toBe(20);
  });

  it('las canceladas no ocupan lugar ni cuentan como falta', async () => {
    // Un lugar que se libero no esta ocupado, y quien cancelo no falto. La
    // cancelada lleva `asistio: false` a proposito: cancelo DESPUES de que le
    // pasaran lista, que es el unico caso en que la marca sobrevive a la
    // cancelacion y el unico que distingue las dos definiciones.
    const { servicio } = crear({
      turnos: [turno({ cupo: 10 })],
      reservas: [
        reserva({ asistio: true }),
        reserva({ asistio: true }),
        reserva({
          asistio: false,
          canceladaEn: instante('2026-10-04T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.ocupacion.numerador).toBe(2);
    expect(operativo.actual.ocupacion.porcentaje).toBe(20);
    expect(operativo.actual.asistencia).toEqual({
      numerador: 2,
      denominador: 2,
      porcentaje: 100,
    });
  });

  it('un turno al que no se anoto nadie SI cuenta en la ocupacion', async () => {
    // Una clase vacia ocurrio y nadie la uso: eso es 0% de ese turno, no un
    // turno que se descarta. Descartarlo subiria la ocupacion del gimnasio cada
    // vez que una clase se vacia, que es lo contrario de lo que paso.
    const { servicio } = crear({
      turnos: [turno({ id: 'turno-1', cupo: 10 }), turno({ id: 'turno-vacio', cupo: 10 })],
      reservas: [reserva({ turnoId: 'turno-1' }), reserva({ turnoId: 'turno-1' })],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.ocupacion).toEqual({ numerador: 2, denominador: 20, porcentaje: 10 });
  });
});

describe('StatsService.operativo: asistencia', () => {
  it('la asistencia NO cuenta las reservas de turnos sin lista pasada', async () => {
    // EL CASO MAS PELIGROSO DEL REPORTE. En turno-1 se paso lista: una presente
    // y una ausente. En turno-2 nadie la paso: dos reservas con `asistio: null`,
    // que no es "no vinieron" sino "no se sabe".
    //
    // La asistencia es 1/2 = 50%. Con el denominador ingenuo —todas las
    // reservas vivas— seria 1/4 = 25%, un numero plausible y equivocado.
    const { servicio } = crear({
      turnos: [turno({ id: 'turno-1' }), turno({ id: 'turno-2' })],
      reservas: [
        reserva({ turnoId: 'turno-1', asistio: true }),
        reserva({ turnoId: 'turno-1', asistio: false }),
        reserva({ turnoId: 'turno-2', asistio: null }),
        reserva({ turnoId: 'turno-2', asistio: null }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.asistencia).toEqual({
      numerador: 1,
      denominador: 2,
      porcentaje: 50,
    });
    expect(operativo.actual.asistencia.porcentaje).not.toBe(25);
  });

  it('un mes sin ninguna lista pasada no dice 0%, dice que no se sabe', async () => {
    // El mes TUVO movimiento —dos reservas sobre un cupo de diez— y eso es lo
    // que hace util al caso: un 0% de asistencia junto a una ocupacion del 20%
    // se lee como "se anotaron y no vino ninguno", que es la conclusion con la
    // que un admin empieza a llamar gente. La verdad es que nadie paso lista.
    const { servicio } = crear({
      turnos: [turno({ cupo: 10 })],
      reservas: [reserva({ asistio: null }), reserva({ asistio: null })],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.asistencia.denominador).toBe(0);
    expect(operativo.actual.asistencia.porcentaje).toBeNull();
    // Y NO un cero, que es lo que se veria igual en el panel y significa otra cosa.
    expect(operativo.actual.asistencia.porcentaje).not.toBe(0);
    expect(operativo.actual.ocupacion.porcentaje).toBe(20);
  });

  it('el operativo y el reporte por alumno dan EL MISMO porcentaje', async () => {
    // EL CASO QUE UNIFICA LAS DOS DEFINICIONES, y que antes de la revision de la
    // Task 8 fallaba: los dos docblocks afirmaban usar "la MISMA definicion" y
    // daban numeros distintos sobre exactamente los mismos datos.
    //
    // Un turno con lista pasada y TRES reservas: A vino, B falto, y C entro
    // DESPUES de que la profesora pasara lista —por `reasignar`, por la lista de
    // espera, por un alta a mano— asi que se quedo con `asistio: null` para
    // siempre. El turno sigue teniendo lista pasada.
    //
    // Con el denominador por TURNO, el operativo metia a C como si hubiera
    // faltado: 1 de 3 = 33,33%. Por alumno, C sale con `porcentaje: null`
    // —"no se sabe"—, o sea que el codigo YA SABIA que su caso no se podia
    // contestar y en el agregado lo contaba como ausencia igual.
    //
    // El numero correcto es 1 de 2 = 50%. El arreglo es ademas mas simple que lo
    // que habia: el denominador son las reservas con `asistio !== null`, y
    // punto; no hace falta saber si el turno tuvo lista pasada.
    const DATOS = {
      ...PADRON_DE_ALUMNOS,
      turnos: [turno({ id: 't-1' })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true }),
        reserva({ turnoId: 't-1', perfilId: 'a-2', asistio: false }),
        reserva({ turnoId: 't-1', perfilId: 'a-3' }),
      ],
    };

    const operativo = await crear(DATOS).servicio.operativo(ACTOR, OCTUBRE);
    const porAlumno = await crear(DATOS).servicio.asistencia(ACTOR, {
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });

    expect(operativo.actual.asistencia).toEqual({
      numerador: 1,
      denominador: 2,
      porcentaje: 50,
    });
    // Y el agregado de las tres filas por alumno da exactamente eso: 1 presente
    // sobre 1 presente + 1 ausente. El tercero no suma ni arriba ni abajo.
    const presentes = porAlumno.alumnos.reduce((total, fila) => total + fila.presentes, 0);
    const marcadas = porAlumno.alumnos.reduce(
      (total, fila) => total + fila.presentes + fila.ausentes,
      0,
    );
    expect({ presentes, marcadas }).toEqual({ presentes: 1, marcadas: 2 });
    expect(porAlumno.alumnos.map((fila) => fila.porcentaje)).toEqual([100, 0, null]);
  });

  it('basta con que UNA reserva viva tenga la marca para que el turno cuente', async () => {
    // La misma regla que `MisClasesService` publica como `listaPasada`: pasar
    // lista escribe todas las reservas del turno de golpe, presentes y
    // ausentes. Exigir que las tengan TODAS dejaria fuera turnos con la lista
    // perfectamente pasada en cuanto Prisma devolviera una fila a medio migrar.
    const { servicio } = crear({
      turnos: [turno()],
      reservas: [reserva({ asistio: true }), reserva({ asistio: false })],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.asistencia).toEqual({ numerador: 1, denominador: 2, porcentaje: 50 });
  });
});

describe('StatsService.operativo: cancelacion', () => {
  it('separa la cancelacion recuperable de la definitiva', async () => {
    // Una de cada una sobre cuatro reservas: 25% y 25%, nunca un 50% junto.
    // Mezclarlas esconde lo unico accionable que tienen: la recuperable es
    // alguien que reprograma, la definitiva es alguien que se esta yendo.
    const { servicio } = crear({
      turnos: [turno({ cupo: 10 })],
      reservas: [
        reserva(),
        reserva(),
        reserva({
          canceladaEn: instante('2026-10-04T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
        reserva({
          canceladaEn: instante('2026-10-04T11:00:00.000Z'),
          cancelacionTipo: 'DEFINITIVA',
        }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.cancelacionRecuperable).toEqual({
      numerador: 1,
      denominador: 4,
      porcentaje: 25,
    });
    expect(operativo.actual.cancelacionDefinitiva).toEqual({
      numerador: 1,
      denominador: 4,
      porcentaje: 25,
    });
    // Sumarlas en una sola metrica daria 50 en las dos: el 2/4 de "se cancelo
    // el cincuenta por ciento", que es cierto y no sirve para nada.
    expect(operativo.actual.cancelacionRecuperable.porcentaje).not.toBe(50);
    expect(operativo.actual.cancelacionDefinitiva.porcentaje).not.toBe(50);
  });

  it('el denominador de la cancelacion son TODAS las reservas, no solo las vivas', async () => {
    // "De todo lo que se anoto, cuanto se cayo". Con solo las vivas en el
    // denominador, un mes en el que cancelaron todos daria 1/0 y despues 100%
    // sobre una base que ya no existe.
    const { servicio } = crear({
      turnos: [turno({ cupo: 10 })],
      reservas: [
        reserva(),
        reserva({
          canceladaEn: instante('2026-10-04T10:00:00.000Z'),
          cancelacionTipo: 'DEFINITIVA',
        }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.cancelacionDefinitiva.denominador).toBe(2);
    expect(operativo.actual.cancelacionDefinitiva.porcentaje).toBe(50);
  });
});

describe('StatsService.operativo: cobranza', () => {
  const PADRON = {
    pagos: [
      pago({ perfilId: 'al-dia', cubreDesde: dia('2026-10-01'), cubreHasta: dia('2026-10-31') }),
    ],
    usuarios: alumnosEnAlta('u-1', 'u-2', 'u-3'),
    perfiles: [
      { id: 'al-dia', usuarioId: 'u-1', packId: 'pack-8' },
      { id: 'debe', usuarioId: 'u-2', packId: 'pack-8' },
      // Sin pack no contrato nada: no esta ni al dia ni debiendo, no entra.
      { id: 'sin-pack', usuarioId: 'u-3', packId: null },
    ],
    packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
  };

  it('la cobranza usa estaAlDia, no una columna', async () => {
    const { servicio, pagos } = crear(PADRON);
    const espia = jest.spyOn(pagos, 'perfilesAlDia');

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    // Dos con pack, uno cubierto: 50%. El de sin pack no entra en ninguno de
    // los dos lados, ni arriba ni abajo.
    expect(operativo.actual.cobranza).toEqual({ numerador: 1, denominador: 2, porcentaje: 50 });
    // Y pasa por `PagosService.perfilesAlDia`, que desde la 5A es la unica
    // implementacion de la regla. Una consulta propia aqui seria una segunda
    // verdad sobre quien debe plata, y la que discrepe es la que nadie mira.
    expect(espia).toHaveBeenCalled();
  });

  it('la cobranza de cada mes se evalua al CIERRE de ese mes, no con el reloj', async () => {
    // Sin la fecha de cierre, `perfilesAlDia` cae en su default `new Date()` y
    // los CUATRO meses del reporte devuelven el mismo numero. Una serie
    // trimestral con la cobranza clavada en los cuatro puntos no se lee como un
    // bug: se lee como "la cobranza no se mueve".
    //
    // El reloj se fija lejos de todo para que el default sea distinguible: con
    // el, los cuatro meses darian 0%.
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2030-01-15T09:00:00.000Z'));

    try {
      const { servicio } = crear({
        pagos: [
          pago({
            perfilId: 'solo-septiembre',
            cubreDesde: dia('2026-09-01'),
            cubreHasta: dia('2026-09-30'),
          }),
        ],
        usuarios: alumnosEnAlta('u-1'),
        perfiles: [{ id: 'solo-septiembre', usuarioId: 'u-1', packId: 'pack-8' }],
        packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
      });

      const operativo = await servicio.operativo(ACTOR, OCTUBRE);

      // Julio y agosto: su pago todavia no empezaba. Septiembre: cubierto.
      expect(operativo.trimestre.map((mes) => mes.cobranza.porcentaje)).toEqual([0, 0, 100]);
      // Octubre: su pago ya vencio al cerrar el mes.
      expect(operativo.actual.cobranza.porcentaje).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('un gimnasio sin nadie con pack no dice 0% de cobranza, dice que no se sabe', async () => {
    const { servicio } = crear({ turnos: [turno()] });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.cobranza).toEqual({
      numerador: 0,
      denominador: 0,
      porcentaje: null,
    });
  });
});

describe('StatsService.operativo: el trimestre', () => {
  it('el trimestre trae los TRES meses anteriores, del mas viejo al mas nuevo', async () => {
    const { servicio } = crear();

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.anio).toBe(2026);
    expect(operativo.actual.mes).toBe(10);
    expect(operativo.trimestre.map((mes) => `${mes.anio}-${mes.mes}`)).toEqual([
      '2026-7',
      '2026-8',
      '2026-9',
    ]);
  });

  it('enero no es un caso aparte: el trimestre cruza de ano', async () => {
    const { servicio } = crear();

    const operativo = await servicio.operativo(ACTOR, { anio: 2026, mes: 1 });

    expect(operativo.trimestre.map((mes) => `${mes.anio}-${mes.mes}`)).toEqual([
      '2025-10',
      '2025-11',
      '2025-12',
    ]);
  });

  it('cada mes del trimestre trae SUS numeros, no una copia del mes pedido', async () => {
    // Sin esto, llamar cuatro veces a la funcion con el mismo mes pasa en verde:
    // los cuatro puntos del grafico serian el mismo numero y nadie lo notaria
    // hasta que alguien comparase la serie con la realidad.
    const { servicio } = crear({
      turnos: [
        turno({ id: 'de-septiembre', fecha: dia('2026-09-10'), cupo: 10 }),
        turno({ id: 'de-octubre', fecha: dia('2026-10-10'), cupo: 10 }),
      ],
      reservas: [
        reserva({ turnoId: 'de-septiembre' }),
        reserva({ turnoId: 'de-octubre' }),
        reserva({ turnoId: 'de-octubre' }),
        reserva({ turnoId: 'de-octubre' }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.ocupacion).toEqual({ numerador: 3, denominador: 10, porcentaje: 30 });
    // Julio y agosto no tuvieron turnos: denominador cero y `null`, no cero.
    expect(operativo.trimestre[0]?.ocupacion.porcentaje).toBeNull();
    expect(operativo.trimestre[1]?.ocupacion.porcentaje).toBeNull();
    expect(operativo.trimestre[2]?.ocupacion).toEqual({
      numerador: 1,
      denominador: 10,
      porcentaje: 10,
    });
  });

  it('el turno del ultimo dia del mes es de ese mes, no del siguiente', async () => {
    const { servicio } = crear({
      turnos: [
        turno({ id: 'ultimo-de-octubre', fecha: dia('2026-10-31'), cupo: 4 }),
        turno({ id: 'primero-de-noviembre', fecha: dia('2026-11-01'), cupo: 100 }),
      ],
      reservas: [reserva({ turnoId: 'ultimo-de-octubre' })],
    });

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(operativo.actual.ocupacion).toEqual({ numerador: 1, denominador: 4, porcentaje: 25 });
  });
});

describe('StatsService.operativo: el salaId', () => {
  it('acota a la sala pedida las metricas que cuentan clases', async () => {
    const { servicio } = crear({
      salas: [SALA_PRINCIPAL, { id: 'sala-2', nombre: 'Funcional' }],
      turnos: [
        turno({ id: 'de-sala-1', salaId: 'sala-1', cupo: 10 }),
        turno({ id: 'de-sala-2', salaId: 'sala-2', cupo: 100 }),
      ],
      reservas: [
        reserva({ turnoId: 'de-sala-1' }),
        reserva({ turnoId: 'de-sala-2' }),
        reserva({ turnoId: 'de-sala-2' }),
      ],
    });

    const operativo = await servicio.operativo(ACTOR, { ...OCTUBRE, salaId: 'sala-1' });

    // Solo sala-1: 1 reserva sobre un cupo de 10. Sin el filtro serian 3/110.
    expect(operativo.actual.ocupacion).toEqual({ numerador: 1, denominador: 10, porcentaje: 10 });
  });

  it('la cobranza NO se acota por sala, y es a proposito', async () => {
    // Estar al dia es una propiedad del alumno y de sus pagos, no de una clase,
    // y un alumno tiene acceso a varias salas a la vez: repartirlo exigiria
    // inventar la misma atribucion que la caja descarta. Queda cubierto con un
    // caso para que sea una decision y no un olvido que un dia alguien
    // "arregle" sin darse cuenta de lo que rompe.
    const comun = {
      pagos: [
        pago({ perfilId: 'al-dia', cubreDesde: dia('2026-10-01'), cubreHasta: dia('2026-10-31') }),
      ],
      usuarios: alumnosEnAlta('u-1', 'u-2'),
      perfiles: [
        { id: 'al-dia', usuarioId: 'u-1', packId: 'pack-8' },
        { id: 'debe', usuarioId: 'u-2', packId: 'pack-8' },
      ],
      packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
      salas: [SALA_PRINCIPAL],
      turnos: [turno({ salaId: 'sala-1' })],
    };

    const sinSala = await crear(comun).servicio.operativo(ACTOR, OCTUBRE);
    const conSala = await crear(comun).servicio.operativo(ACTOR, { ...OCTUBRE, salaId: 'sala-1' });

    expect(conSala.actual.cobranza).toEqual(sinSala.actual.cobranza);
    expect(conSala.actual.cobranza.porcentaje).toBe(50);
  });
});

describe('StatsService.operativo: el cache', () => {
  it('la clave lleva el mes y la sala, y el tenant del actor', async () => {
    const { servicio, claves } = crear({ turnos: [turno()] });

    await servicio.operativo(ACTOR, OCTUBRE);
    await servicio.operativo(ACTOR, { ...OCTUBRE, salaId: 'sala-1' });

    // Dos claves distintas: el gimnasio entero y una sala no son el mismo
    // reporte, y servir uno por el otro seria un numero equivocado con un 200.
    expect([...claves.keys()]).toEqual([
      'stats:gym-1:v0:operativo:2026-10:todas',
      'stats:gym-1:v0:operativo:2026-10:sala-1',
    ]);
  });

  it('la segunda llamada no vuelve a consultar la base', async () => {
    const { servicio, db } = crear({ turnos: [turno()], reservas: [reserva()] });

    await servicio.operativo(ACTOR, OCTUBRE);
    const consultasDeLaPrimera = db.turno.findMany.mock.calls.length;
    await servicio.operativo(ACTOR, OCTUBRE);

    expect(db.turno.findMany).toHaveBeenCalledTimes(consultasDeLaPrimera);
  });

  it('una reserva nueva se ve en el operativo sin esperar al TTL', async () => {
    // La misma llamada de soporte que la caja, por la otra puerta: "anote al
    // alumno y la ocupacion sigue diciendo lo de antes". `ReservasService`
    // comparte el contador de version, asi que no hay ninguna lista de claves
    // que mantener.
    const { servicio, cache, claves } = crear({ turnos: [turno()] });

    await servicio.operativo(ACTOR, OCTUBRE);
    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:operativo:2026-10:todas']);

    await cache.invalidar('gym-1');
    await servicio.operativo(ACTOR, OCTUBRE);

    expect(claves.has('stats:gym-1:v1:operativo:2026-10:todas')).toBe(true);
  });
});

describe('StatsService.operativo: un mes sin nada', () => {
  it('un mes futuro no es un error: cuatro "no se sabe" y una cobranza real', async () => {
    const { servicio } = crear({
      usuarios: alumnosEnAlta('u-1'),
      perfiles: [{ id: 'debe', usuarioId: 'u-1', packId: 'pack-8' }],
      packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
    });

    const operativo = await servicio.operativo(ACTOR, { anio: 2099, mes: 1 });

    for (const metrica of [
      operativo.actual.ocupacion,
      operativo.actual.asistencia,
      operativo.actual.cancelacionRecuperable,
      operativo.actual.cancelacionDefinitiva,
    ]) {
      expect(metrica).toEqual({ numerador: 0, denominador: 0, porcentaje: null });
    }

    // La cobranza SI tiene respuesta: en 2099 no pago nadie todavia, asi que
    // nadie esta al dia. Es 0 de 1, no un "no se sabe".
    expect(operativo.actual.cobranza).toEqual({ numerador: 0, denominador: 1, porcentaje: 0 });
  });
});

/**
 * EL PARAMETRO QUE AQUI SI EXISTE.
 *
 * La caja rechaza el `salaId` porque un `Pago` no tiene sala; el operativo lo
 * acepta porque un `Turno` si. Los dos casos viven juntos a proposito: la
 * asimetria es la decision, y una decision sin test es una opinion.
 */
describe('ConsultaOperativaDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const comoQuery = { type: 'query' as const, metatype: ConsultaOperativaDto };

  it('acepta el salaId y hereda la transformacion de anio y mes', async () => {
    await expect(
      pipe.transform({ anio: '2026', mes: '10', salaId: 'ckl1abc9' }, comoQuery),
    ).resolves.toEqual({ anio: 2026, mes: 10, salaId: 'ckl1abc9' });
  });

  it('el salaId es opcional', async () => {
    await expect(pipe.transform({ anio: '2026', mes: '10' }, comoQuery)).resolves.toEqual({
      anio: 2026,
      mes: 10,
    });
  });

  it('400 si el salaId trae un separador de clave de cache', async () => {
    // El `:` no se escapa al armar la clave. No puede suplantar otro reporte
    // —entra al final—, pero la regla "a la clave solo van valores validados"
    // se cumple en el borde o no se cumple.
    await expect(
      pipe.transform({ anio: '2026', mes: '10', salaId: 'a:caja:2026-10' }, comoQuery),
    ).rejects.toThrow(BadRequestException);
  });

  it('400 si el mes no existe, igual que en la caja', async () => {
    await expect(
      pipe.transform({ anio: '2026', mes: '13', salaId: 'sala1' }, comoQuery),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// TASK 7: /stats/turnos-libres y /stats/pagos-pendientes
//
// LOS DOS REPORTES SE EVALUAN "HOY", Y ES LA PRIMERA VEZ EN ESTA FASE QUE ESO
// ESTA BIEN. En la caja y en el operativo, un `new Date()` por defecto era un
// bug: metia "quien debe hoy" dentro de un reporte indexado por `anio/mes`, y
// la cobranza salia identica en los cuatro meses del trimestre. Aqui no hay
// periodo debajo del que esconderse —no se puede pedir "los turnos libres de
// marzo de 2024" ni "los morosos de marzo"— asi que hoy ES la pregunta. Lo que
// esta fase aprendio no es "nunca uses el reloj": es "decide la fecha a
// proposito y escribila". Por eso todos los casos de aqui abajo fijan el reloj
// y lo dicen, y hay uno que comprueba que el dia entra en la clave del cache.
// ---------------------------------------------------------------------------

/** Un usuario, que es donde viven el nombre y el email. Alumno y en alta. */
function usuario(parcial: Partial<Tablas['usuarios'][number]> = {}): Tablas['usuarios'][number] {
  return {
    id: 'u-1',
    rol: 'ALUMNO',
    nombreCompleto: 'Ana Perez',
    email: 'ana@gym.test',
    activo: true,
    ...parcial,
  };
}

/** El `where` de fecha con el que `turno.findMany` fue llamado la primera vez. */
function rangoPedido(db: ReturnType<typeof prismaFalso>): { gte: Date; lt: Date } {
  const consulta = db.turno.findMany.mock.calls[0][0] as {
    where: { fecha: { gte: Date; lt: Date } };
  };
  return consulta.where.fecha;
}

describe('StatsService.turnosLibres', () => {
  // 2 de octubre de 2026, por la manana. Todo lo de aqui abajo se lee contra
  // esta fecha; con el reloj real, "futuro" cambiaria de significado cada dia y
  // la suite empezaria a fallar sola en algun momento de 2027.
  const HOY = new Date('2026-10-02T09:00:00.000Z');

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(HOY);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('solo futuros y solo con lugar', async () => {
    const { servicio } = crear({
      salas: [SALA_PRINCIPAL],
      turnos: [
        // Pasado y con lugar: no entra. Lo que sobra en un reporte de "donde
        // meto a este alumno" no es ruido, es una clase a la que ya no llega.
        turno({ id: 'ayer', fecha: dia('2026-09-20'), cupo: 5 }),
        // Futuro y lleno: tampoco. Cupo 2 con 2 reservas vivas.
        turno({ id: 'lleno', fecha: dia('2026-10-10'), cupo: 2 }),
        // Futuro y con lugar: el unico que vuelve.
        turno({ id: 'hay-lugar', fecha: dia('2026-10-12'), cupo: 5 }),
      ],
      reservas: [
        reserva({ turnoId: 'lleno', perfilId: 'a-1' }),
        reserva({ turnoId: 'lleno', perfilId: 'a-2' }),
        reserva({ turnoId: 'hay-lugar', perfilId: 'a-1' }),
      ],
    });

    const { turnos: libres } = await servicio.turnosLibres(ACTOR, {});

    expect(libres.map((fila) => fila.turnoId)).toEqual(['hay-lugar']);
    expect(libres[0]).toEqual({
      turnoId: 'hay-lugar',
      salaId: 'sala-1',
      salaNombre: 'Principal',
      fecha: '2026-10-12',
      horaInicio: '18:00',
      horaFin: '19:00',
      cupo: 5,
      reservados: 1,
      libres: 4,
    });
  });

  it('una reserva cancelada vuelve a liberar el lugar', async () => {
    const { servicio } = crear({
      salas: [SALA_PRINCIPAL],
      turnos: [turno({ id: 'uno', fecha: dia('2026-10-10'), cupo: 2 })],
      reservas: [
        reserva({ turnoId: 'uno', perfilId: 'a-1' }),
        reserva({
          turnoId: 'uno',
          perfilId: 'a-2',
          canceladaEn: instante('2026-10-01T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
      ],
    });

    const { turnos: libres } = await servicio.turnosLibres(ACTOR, {});

    // Contar las canceladas como ocupadas esconderia justamente el lugar que se
    // acaba de liberar, que es el motivo entero de mirar este reporte.
    expect(libres[0].reservados).toBe(1);
    expect(libres[0].libres).toBe(1);
  });

  it('mesesAdelante por defecto es 3', async () => {
    // SE AFIRMA SOBRE EL `where` QUE RECIBIO EL DOBLE, no sobre el resultado:
    // con pocos turnos, tres meses y doce devolverian lo mismo y el caso no
    // probaria nada. Es una de las siete veces de esta fase en que un fixture no
    // distinguia los dos comportamientos.
    const { servicio, db } = crear({ salas: [SALA_PRINCIPAL], turnos: [turno()] });

    await servicio.turnosLibres(ACTOR, {});

    expect(rangoPedido(db)).toEqual({ gte: dia('2026-10-02'), lt: dia('2027-01-02') });
  });

  it('mesesAdelante se topea en 12', async () => {
    // Pedir 999 no recorre la tabla entera de turnos: el `where` se arma con 12.
    // Y no es un 400, que es la otra mitad de la decision: la respuesta correcta
    // a "dame dos anos" es "te doy uno".
    const { servicio, db } = crear({ salas: [SALA_PRINCIPAL], turnos: [turno()] });

    const reporte = await servicio.turnosLibres(ACTOR, { mesesAdelante: 999 });

    expect(rangoPedido(db)).toEqual({ gte: dia('2026-10-02'), lt: dia('2027-10-02') });
    // Y LO DICE. Recortar sin avisar deja a quien pidio 999 leyendo una lista
    // corta como "no hay mas turnos" en vez de como "no miramos mas alla".
    expect(reporte.mesesAdelante).toBe(12);
  });

  it('un mesesAdelante por debajo del tope se respeta tal cual', async () => {
    // El par del caso de arriba: sin el, un service que ignorara el parametro y
    // usara siempre 12 pasaria el del tope sin inmutarse.
    const { servicio, db } = crear({ salas: [SALA_PRINCIPAL], turnos: [turno()] });

    await servicio.turnosLibres(ACTOR, { mesesAdelante: 2 });

    expect(rangoPedido(db)).toEqual({ gte: dia('2026-10-02'), lt: dia('2026-12-02') });
  });

  it('el salaId acota, porque un Turno SI tiene sala', async () => {
    const DOS_SALAS = {
      salas: [SALA_PRINCIPAL, { id: 'estudio', nombre: 'Estudio' }],
      turnos: [
        turno({ id: 'en-principal', fecha: dia('2026-10-10') }),
        turno({ id: 'en-estudio', fecha: dia('2026-10-10'), salaId: 'estudio' }),
      ],
    };

    const todas = await crear(DOS_SALAS).servicio.turnosLibres(ACTOR, {});
    const soloEstudio = await crear(DOS_SALAS).servicio.turnosLibres(ACTOR, { salaId: 'estudio' });

    expect(todas.turnos.map((fila) => fila.turnoId)).toEqual(['en-estudio', 'en-principal']);
    expect(soloEstudio.turnos.map((fila) => fila.turnoId)).toEqual(['en-estudio']);
    expect(soloEstudio.turnos[0].salaNombre).toBe('Estudio');
  });

  it('salen en orden de agenda, no en el que vino de la base', async () => {
    // El orden es fijo y no "el que venga": la respuesta se serializa a JSON y
    // se guarda en el cache, asi que dos llamadas identicas tienen que dar el
    // mismo cuerpo byte a byte.
    const { servicio } = crear({
      salas: [SALA_PRINCIPAL],
      turnos: [
        turno({ id: 'c', fecha: dia('2026-10-20'), horaInicio: '08:00' }),
        turno({ id: 'b', fecha: dia('2026-10-10'), horaInicio: '19:00' }),
        turno({ id: 'a', fecha: dia('2026-10-10'), horaInicio: '08:00' }),
      ],
    });

    const { turnos: libres } = await servicio.turnosLibres(ACTOR, {});

    expect(libres.map((fila) => fila.turnoId)).toEqual(['a', 'b', 'c']);
  });

  it('la clave del cache lleva el dia, los meses y la sala', async () => {
    const { servicio, claves } = crear({ salas: [SALA_PRINCIPAL], turnos: [turno()] });

    await servicio.turnosLibres(ACTOR, { mesesAdelante: 6, salaId: 'sala1' });

    // EL DIA ESTA EN LA CLAVE a proposito: el reporte se evalua con el reloj, y
    // sin el dia la entrada de hoy seguiria sirviendo manana dentro del TTL.
    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:turnos-libres:2026-10-02:6:sala1']);
  });

  it('la segunda llamada no vuelve a consultar la base', async () => {
    const { servicio, db } = crear({ salas: [SALA_PRINCIPAL], turnos: [turno()] });

    await servicio.turnosLibres(ACTOR, {});
    const segunda = await servicio.turnosLibres(ACTOR, {});

    expect(segunda.turnos).toHaveLength(1);
    expect(db.turno.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('StatsService.pagosPendientes', () => {
  const HOY = new Date('2026-10-15T09:00:00.000Z');

  /**
   * Tres alumnos: uno cubierto, uno que debe, uno sin plan contratado.
   *
   * Es el MISMO padron que usa el caso de la cobranza del operativo, a
   * proposito: el desglose de este reporte y el `pendienteEstimado` de la caja
   * salen de la misma funcion pura `pendientesDe`, y mirar los dos sobre los
   * mismos datos es lo que hace visible si algun dia dejan de corresponderse.
   */
  const PADRON = {
    pagos: [
      pago({ perfilId: 'al-dia', cubreDesde: dia('2026-10-01'), cubreHasta: dia('2026-10-31') }),
    ],
    perfiles: [
      { id: 'al-dia', usuarioId: 'u-1', packId: 'pack-8' },
      { id: 'debe', usuarioId: 'u-2', packId: 'pack-8' },
      { id: 'sin-pack', usuarioId: 'u-3', packId: null },
    ],
    usuarios: [
      usuario({ id: 'u-1', nombreCompleto: 'Ana Perez', email: 'ana@gym.test' }),
      usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz', email: 'bruno@gym.test' }),
      usuario({ id: 'u-3', nombreCompleto: 'Carla Ruiz', email: 'carla@gym.test' }),
    ],
    packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(HOY);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('solo los que NO estan al dia', async () => {
    const { servicio } = crear(PADRON);

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes.map((fila) => fila.perfilId)).toEqual(['debe']);
    expect(pendientes[0].nombreCompleto).toBe('Bruno Diaz');
    expect(pendientes[0].email).toBe('bruno@gym.test');
    expect(pendientes[0].packNombre).toBe('8 clases');
  });

  it('el estimado es el precio del pack', async () => {
    const { servicio } = crear(PADRON);

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes[0].pendienteEstimado).toEqual({ centavos: 850000, texto: '8500.00' });
  });

  it('un pack sin precio aporta cero, nunca un NaN', async () => {
    // "A consultar" es un estado legitimo de un pack desde la Fase 1. No saber
    // cuanto debe alguien no puede romper el reporte de todos los demas.
    const { servicio } = crear({
      ...PADRON,
      packs: [{ id: 'pack-8', nombre: 'A consultar', precio: null }],
    });

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes.map((fila) => fila.pendienteEstimado)).toEqual([
      { centavos: 0, texto: '0.00' },
    ]);
    expect(Number.isNaN(pendientes[0].pendienteEstimado.centavos)).toBe(false);
    expect(pendientes[0].packNombre).toBe('A consultar');
  });

  it('un alumno sin pack no aparece', async () => {
    // No debe nada: no tiene plan contratado. Si apareciera, el reporte de
    // morosos se llenaria de gente que nunca se anoto a nada.
    const { servicio } = crear(PADRON);

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes.map((fila) => fila.perfilId)).not.toContain('sin-pack');
  });

  it('cuenta las cancelaciones DEL MES EN CURSO, no las de siempre', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' })],
      reservas: [
        reserva({
          turnoId: 't-1',
          perfilId: 'debe',
          canceladaEn: instante('2026-10-03T10:00:00.000Z'),
          cancelacionTipo: 'DEFINITIVA',
        }),
        reserva({
          turnoId: 't-1',
          perfilId: 'debe',
          canceladaEn: instante('2026-10-09T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
        // Del mes pasado: no cuenta. "Lo que mas cancelan" es una conducta de
        // ahora; arrastrar el historico haria que un alumno que se portaba mal
        // en marzo siguiera encabezando la lista en diciembre.
        reserva({
          turnoId: 't-1',
          perfilId: 'debe',
          canceladaEn: instante('2026-09-28T10:00:00.000Z'),
          cancelacionTipo: 'DEFINITIVA',
        }),
        // Viva: no es una cancelacion.
        reserva({ turnoId: 't-1', perfilId: 'debe' }),
      ],
    });

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes[0].cancelacionesDelMes).toBe(2);
  });

  it('el reloj SI mueve este reporte, y es correcto que lo mueva', async () => {
    // El inverso del caso de dos relojes de la caja, y vale la pena tenerlo
    // escrito: alli dos fechas distintas tenian que dar el MISMO numero, porque
    // el reporte prometia un mes. Aqui el reporte promete "ahora", asi que el
    // alumno cubierto hasta el 31 de octubre no debe el 15 de octubre y si debe
    // el 15 de noviembre. Un resultado identico en las dos fechas significaria
    // que la fecha de evaluacion quedo clavada en algun lado.
    jest.setSystemTime(new Date('2026-10-15T09:00:00.000Z'));
    const enOctubre = await crear(PADRON).servicio.pagosPendientes(ACTOR, {});

    jest.setSystemTime(new Date('2026-11-15T09:00:00.000Z'));
    const enNoviembre = await crear(PADRON).servicio.pagosPendientes(ACTOR, {});

    expect(enOctubre.map((fila) => fila.perfilId)).toEqual(['debe']);
    expect(enNoviembre.map((fila) => fila.perfilId)).toEqual(['al-dia', 'debe']);
  });

  it('la clave del cache lleva el dia en que se evaluo', async () => {
    const { servicio, claves } = crear(PADRON);

    await servicio.pagosPendientes(ACTOR, {});

    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:pagos-pendientes:2026-10-15']);
  });

  it('salen en orden alfabetico, no en el que vino de la base', async () => {
    const { servicio } = crear({
      ...PADRON,
      pagos: [],
      usuarios: [
        usuario({ id: 'u-1', nombreCompleto: 'Zoe Vega' }),
        usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz' }),
        usuario({ id: 'u-3', nombreCompleto: 'Carla Ruiz' }),
      ],
    });

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes.map((fila) => fila.nombreCompleto)).toEqual(['Bruno Diaz', 'Zoe Vega']);
  });
});

/**
 * UNA SOLA POBLACION PARA LOS CUATRO REPORTES QUE CUENTAN ALUMNOS.
 *
 * `alumnosActivos()` filtraba por rol y por `activo`; `perfilesConPack()` no
 * filtraba por ninguno de los dos, y `darDeBaja` no limpia el `packId`. La misma
 * persona era "no es alumno" para la composicion y "alumno que debe" para la
 * cobranza, el pendiente de la caja y los morosos. Nadie habia tomado esa
 * decision: estaba heredada.
 *
 * LO PEOR ERA LA COBRANZA, QUE DECAIA PARA SIEMPRE: cada ex-alumno se quedaba en
 * el denominador sin poder volver a estar al dia jamas, asi que el indicador
 * bajaba solo a medida que el gimnasio acumulaba historia. Un numero que baja
 * solo es exactamente el numero plausible y equivocado que la seccion 6 existe
 * para evitar.
 *
 * Los casos van juntos aqui, sobre un unico padron, porque lo que se fija es que
 * los TRES contesten lo mismo sobre la misma persona.
 */
describe('StatsService: los dados de baja salen de los cuatro reportes a la vez', () => {
  /** Dos alumnos con el mismo pack; uno de ellos dado de baja. Nadie pago. */
  const PADRON = {
    usuarios: [
      usuario({ id: 'u-1', nombreCompleto: 'Ana Perez' }),
      usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz', activo: false }),
    ],
    perfiles: [
      { id: 'en-alta', usuarioId: 'u-1', packId: 'pack-8' },
      // `darDeBaja` no le limpia el `packId`: sigue teniendo pack, pero ya no es
      // alumno del gimnasio.
      { id: 'se-fue', usuarioId: 'u-2', packId: 'pack-8' },
    ],
    packs: [{ id: 'pack-8', nombre: '8 clases', precio: '8500.00' }],
  };

  it('la cobranza no decae con los ex-alumnos', async () => {
    const { servicio } = crear(PADRON);

    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    // 0 de 1, no 0 de 2. Con el de baja dentro, el denominador crece con cada
    // persona que se va y el porcentaje baja solo para siempre.
    expect(operativo.actual.cobranza).toEqual({
      numerador: 0,
      denominador: 1,
      porcentaje: 0,
    });
  });

  it('el pendiente de la caja no arrastra deuda historica', async () => {
    const { servicio } = crear(PADRON);

    const caja = await servicio.caja(ACTOR, OCTUBRE);

    // 8500 y no 17000: el pendiente de un mes es lo que ESE mes quedo sin cobrar
    // de su gente, no una deuda acumulada de todo el que paso por el gimnasio.
    expect(caja.pendienteEstimado.texto).toBe('8500.00');
  });

  it('recepcion no llama a quien se fue', async () => {
    const { servicio } = crear(PADRON);

    const pendientes = await servicio.pagosPendientes(ACTOR, {});

    expect(pendientes.map((fila) => fila.perfilId)).toEqual(['en-alta']);
  });

  it('y la composicion dice lo mismo que los otros tres', async () => {
    const { servicio } = crear(PADRON);

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    // Este reporte ya filtraba bien; el caso esta aqui para que los cuatro
    // numeros se lean juntos y se vea que son el mismo.
    expect(composicion.totalAlumnos).toBe(1);
    expect(composicion.porPack).toEqual([
      { packId: 'pack-8', packNombre: '8 clases', alumnos: 1, porcentaje: 100 },
    ]);
  });

  it('una profesora con pack no entra en los morosos', async () => {
    // El filtro de rol no es redundante con el de pack. Hoy una profesora no
    // tiene pack y caeria sola, pero nada en el schema lo impide —`Perfil.packId`
    // es opcional para todos—, y el dia que alguien le asigne uno apareceria
    // aqui.
    const { servicio } = crear({
      ...PADRON,
      usuarios: [
        ...PADRON.usuarios,
        usuario({ id: 'u-9', rol: 'PROFESOR', nombreCompleto: 'Fati' }),
      ],
      perfiles: [...PADRON.perfiles, { id: 'prof-1', usuarioId: 'u-9', packId: 'pack-8' }],
    });

    const pendientes = await servicio.pagosPendientes(ACTOR, {});
    const operativo = await servicio.operativo(ACTOR, OCTUBRE);

    expect(pendientes.map((fila) => fila.perfilId)).toEqual(['en-alta']);
    expect(operativo.actual.cobranza.denominador).toBe(1);
  });
});

/**
 * EL PARAMETRO QUE TAMPOCO EXISTE AQUI.
 *
 * La spec pedia `/stats/pagos-pendientes?salaId=`. Se quito al implementarlo,
 * por la MISMA razon que en la caja y que en la cobranza del operativo: estar al
 * dia es una propiedad del alumno y de sus pagos, un alumno accede a varias
 * salas a la vez, y su `pendienteEstimado` es el precio de su pack ENTERO. La
 * misma persona apareceria con su deuda completa en la lista de la sala A y en
 * la de la B, y sumar las dos listas contaria el mismo peso dos veces.
 *
 * El DTO esta VACIO y eso es lo que hace el trabajo: con el `@Query()` del
 * controller apuntando aqui y el `forbidNonWhitelisted` del ValidationPipe
 * global, mandarlo da 400. Sin el DTO, Nest lo ignoraria en silencio y
 * tendriamos una mentira con codigo 200.
 */
describe('ConsultaPagosPendientesDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const comoQuery = { type: 'query' as const, metatype: ConsultaPagosPendientesDto };

  it('una query vacia pasa limpia', async () => {
    await expect(pipe.transform({}, comoQuery)).resolves.toEqual({});
  });

  it('400 si se manda un salaId: los morosos no se parten por sala', async () => {
    await expect(pipe.transform({ salaId: 'sala1' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400 tambien si se manda un mes: este reporte es de ahora, no de un periodo', async () => {
    await expect(pipe.transform({ anio: '2026', mes: '10' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('ConsultaTurnosLibresDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const comoQuery = { type: 'query' as const, metatype: ConsultaTurnosLibresDto };

  it('los dos parametros son opcionales', async () => {
    await expect(pipe.transform({}, comoQuery)).resolves.toEqual({});
  });

  it('transforma mesesAdelante de string a numero', async () => {
    await expect(pipe.transform({ mesesAdelante: '6' }, comoQuery)).resolves.toEqual({
      mesesAdelante: 6,
    });
  });

  it('NO rechaza un mesesAdelante por encima del tope: lo topea el service', async () => {
    // El caso que fija la decision. Un `@Max(12)` aqui daria 400 a quien pida
    // 24, y la respuesta correcta a "dame dos anos" no es un error, es "te doy
    // uno". El recorte se comprueba en `mesesAdelante se topea en 12`.
    await expect(pipe.transform({ mesesAdelante: '999' }, comoQuery)).resolves.toEqual({
      mesesAdelante: 999,
    });
  });

  it('400 si mesesAdelante es cero o negativo', async () => {
    // Y aqui si es un 400, porque no hay ninguna respuesta razonable que dar:
    // no existe "mirar hacia atras" en un reporte de turnos futuros.
    await expect(pipe.transform({ mesesAdelante: '0' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
    await expect(pipe.transform({ mesesAdelante: '-3' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400 si el salaId trae un separador de clave de cache', async () => {
    await expect(pipe.transform({ salaId: 'a:caja:2026-10' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });
});

// ---------------------------------------------------------------------------
// TASK 8: /stats/composicion-alumnos y /stats/asistencia
// ---------------------------------------------------------------------------

describe('StatsService.composicionAlumnos', () => {
  /** Cuatro alumnos: dos del pack A, uno del B, uno sin pack. */
  const PADRON = {
    usuarios: [
      usuario({ id: 'u-1', nombreCompleto: 'Ana Perez' }),
      usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz' }),
      usuario({ id: 'u-3', nombreCompleto: 'Carla Ruiz' }),
      usuario({ id: 'u-4', nombreCompleto: 'Diego Sosa' }),
    ],
    perfiles: [
      { id: 'a-1', usuarioId: 'u-1', packId: 'pack-a' },
      { id: 'a-2', usuarioId: 'u-2', packId: 'pack-a' },
      { id: 'a-3', usuarioId: 'u-3', packId: 'pack-b' },
      { id: 'a-4', usuarioId: 'u-4', packId: null },
    ],
    packs: [
      { id: 'pack-a', nombre: '8 clases', precio: '8500.00' },
      { id: 'pack-b', nombre: '12 clases', precio: '12000.00' },
    ],
  };

  it('los porcentajes suman 100', async () => {
    const { servicio } = crear(PADRON);

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect(composicion.totalAlumnos).toBe(4);
    expect(composicion.porPack).toEqual([
      { packId: 'pack-b', packNombre: '12 clases', alumnos: 1, porcentaje: 25 },
      { packId: 'pack-a', packNombre: '8 clases', alumnos: 2, porcentaje: 50 },
      { packId: null, packNombre: 'Sin pack', alumnos: 1, porcentaje: 25 },
    ]);
    expect(composicion.porPack.reduce((total, fila) => total + fila.porcentaje, 0)).toBe(100);
  });

  it('los alumnos sin pack se agrupan aparte, no se descartan', async () => {
    // Descartarlos haria que los porcentajes mintieran sobre el total: los tres
    // con pack pasarian a ser 33/33/33 de un universo de tres, y el panel diria
    // que todo el mundo esta en un plan.
    const { servicio } = crear(PADRON);

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    const sinPack = composicion.porPack.find((fila) => fila.packId === null);
    expect(sinPack).toEqual({ packId: null, packNombre: 'Sin pack', alumnos: 1, porcentaje: 25 });
    // Y el que no tiene pack SIGUE siendo un alumno del gimnasio: entra en el
    // total y en el consumo.
    expect(composicion.totalAlumnos).toBe(4);
    expect(composicion.consumo.map((fila) => fila.perfilId)).toContain('a-4');
  });

  it('el consumo sale de las reservas, no de un contador', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' }), turno({ id: 't-2', fecha: dia('2026-10-07') })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1' }),
        reserva({ turnoId: 't-2', perfilId: 'a-1' }),
        // Cancelada: no es una clase tomada.
        reserva({
          turnoId: 't-2',
          perfilId: 'a-1',
          canceladaEn: instante('2026-10-06T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
      ],
    });

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    const ana = composicion.consumo.find((fila) => fila.perfilId === 'a-1');
    expect(ana).toEqual({ perfilId: 'a-1', nombreCompleto: 'Ana Perez', clasesTomadas: 2 });
    // Y el que no reservo nada sale con cero, no se cae de la lista: "no vino
    // nunca" es informacion, y es justo la que este reporte busca.
    expect(composicion.consumo.find((fila) => fila.perfilId === 'a-4')?.clasesTomadas).toBe(0);
  });

  it('solo cuenta las reservas del mes pedido', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 'octubre' }), turno({ id: 'noviembre', fecha: dia('2026-11-05') })],
      reservas: [
        reserva({ turnoId: 'octubre', perfilId: 'a-1' }),
        reserva({ turnoId: 'noviembre', perfilId: 'a-1' }),
      ],
    });

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect(composicion.consumo.find((fila) => fila.perfilId === 'a-1')?.clasesTomadas).toBe(1);
  });

  it('una profesora no infla el grupo de los que no tienen pack', async () => {
    // EL FILTRO DE ROL ES LO QUE SALVA ESTE REPORTE. Una profesora tiene Perfil
    // y no tiene pack: sin el filtro caeria en "Sin pack" y el reporte que dice
    // cuantos ALUMNOS hay en cada plan pasaria a contar al personal.
    const { servicio } = crear({
      ...PADRON,
      usuarios: [
        ...PADRON.usuarios,
        usuario({ id: 'u-9', rol: 'PROFESOR', nombreCompleto: 'Fati' }),
      ],
      perfiles: [...PADRON.perfiles, { id: 'prof-1', usuarioId: 'u-9', packId: null }],
    });

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect(composicion.totalAlumnos).toBe(4);
    expect(composicion.porPack.find((fila) => fila.packId === null)?.alumnos).toBe(1);
    expect(composicion.consumo.map((fila) => fila.perfilId)).not.toContain('prof-1');
  });

  it('un alumno dado de baja no esta en ningun pack hoy', async () => {
    const { servicio } = crear({
      ...PADRON,
      usuarios: [
        ...PADRON.usuarios.slice(0, 3),
        usuario({ id: 'u-4', nombreCompleto: 'Diego Sosa', activo: false }),
      ],
    });

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect(composicion.totalAlumnos).toBe(3);
    expect(composicion.porPack.map((fila) => fila.packId)).toEqual(['pack-b', 'pack-a']);
  });

  it('un gimnasio sin alumnos no revienta ni divide por cero', async () => {
    const { servicio } = crear({});

    const composicion = await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect(composicion).toEqual({
      anio: 2026,
      mes: 10,
      totalAlumnos: 0,
      porPack: [],
      consumo: [],
    });
  });

  it('la clave del cache lleva el mes y el tenant del actor', async () => {
    const { servicio, claves } = crear(PADRON);

    await servicio.composicionAlumnos(ACTOR, OCTUBRE);

    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:composicion:2026-10']);
  });
});

describe('StatsService.asistencia', () => {
  const RANGO = { desde: '2026-10-01', hasta: '2026-10-31' };

  const PADRON = {
    usuarios: [
      usuario({ id: 'u-1', nombreCompleto: 'Ana Perez' }),
      usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz' }),
    ],
    perfiles: [
      { id: 'a-1', usuarioId: 'u-1', packId: 'pack-a' },
      { id: 'a-2', usuarioId: 'u-2', packId: 'pack-a' },
    ],
    packs: [{ id: 'pack-a', nombre: '8 clases', precio: '8500.00' }],
  };

  it('un alumno sin lista pasada tiene porcentaje null', async () => {
    // Dos reservas suyas en el rango, las dos con `asistio: null`. NUNCA 0: un
    // cero es una respuesta —"no vino a ninguna"— y aqui no hay ninguna
    // respuesta. Con el cero, el admin lo llama para preguntarle por que falto a
    // todo cuando lo que paso es que nadie paso lista.
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' }), turno({ id: 't-2', fecha: dia('2026-10-07') })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1' }),
        reserva({ turnoId: 't-2', perfilId: 'a-1' }),
      ],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(reporte.alumnos).toEqual([
      { perfilId: 'a-1', nombreCompleto: 'Ana Perez', presentes: 0, ausentes: 0, porcentaje: null },
    ]);
  });

  it('presentes sobre las reservas con lista pasada, no sobre todas', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [
        turno({ id: 't-1' }),
        turno({ id: 't-2', fecha: dia('2026-10-07') }),
        turno({ id: 't-3', fecha: dia('2026-10-14') }),
        turno({ id: 't-4', fecha: dia('2026-10-21') }),
      ],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true }),
        reserva({ turnoId: 't-2', perfilId: 'a-1', asistio: true }),
        reserva({ turnoId: 't-3', perfilId: 'a-1', asistio: false }),
        // Sin lista: no entra ni arriba ni abajo. Con el denominador ingenuo
        // serian 2 de 4 (50%) en vez de 2 de 3 (66,67%).
        reserva({ turnoId: 't-4', perfilId: 'a-1' }),
      ],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(reporte.alumnos[0]).toEqual({
      perfilId: 'a-1',
      nombreCompleto: 'Ana Perez',
      presentes: 2,
      ausentes: 1,
      porcentaje: 66.67,
    });
  });

  it('una reserva cancelada no cuenta como falta', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' }), turno({ id: 't-2', fecha: dia('2026-10-07') })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true }),
        // Cancelada Y marcada como ausente: pasar lista escribe todas las del
        // turno. Quien cancelo no falto, asi que no entra en el denominador.
        reserva({
          turnoId: 't-2',
          perfilId: 'a-1',
          asistio: false,
          canceladaEn: instante('2026-10-06T10:00:00.000Z'),
          cancelacionTipo: 'RECUPERABLE',
        }),
      ],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(reporte.alumnos[0]).toEqual({
      perfilId: 'a-1',
      nombreCompleto: 'Ana Perez',
      presentes: 1,
      ausentes: 0,
      porcentaje: 100,
    });
  });

  it('el perfilId acota a un solo alumno', async () => {
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true }),
        reserva({ turnoId: 't-1', perfilId: 'a-2', asistio: false }),
      ],
    });

    const reporte = await servicio.asistencia(ACTOR, { ...RANGO, perfilId: 'a-2' });

    expect(reporte.alumnos.map((fila) => fila.perfilId)).toEqual(['a-2']);
    expect(reporte.alumnos[0].porcentaje).toBe(0);
  });

  it('el dia `hasta` entra entero', async () => {
    // El rango de `StatsDatos` es semiabierto, asi que el service tiene que
    // pedir `[desde, hasta + 1)`. Un `lte` contra la medianoche del 31 se
    // comeria los turnos del 31 el dia que esa columna tenga hora.
    const { servicio, db } = crear({
      ...PADRON,
      turnos: [turno({ id: 'el-31', fecha: dia('2026-10-31') })],
      reservas: [reserva({ turnoId: 'el-31', perfilId: 'a-1', asistio: true })],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(rangoPedido(db)).toEqual({ gte: dia('2026-10-01'), lt: dia('2026-11-01') });
    expect(reporte.alumnos[0].presentes).toBe(1);
  });

  it('un rango invertido es 400', async () => {
    // Y no una lista vacia: `desde > hasta` no es una pregunta rara, es una
    // pregunta mal escrita, y contestarla con `[]` la deja pasar por "este
    // alumno no vino nunca".
    const { servicio } = crear(PADRON);

    await expect(
      servicio.asistencia(ACTOR, { desde: '2026-10-31', hasta: '2026-10-01' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('un rango de un solo dia NO es un rango invertido', async () => {
    // El par del caso de arriba: con un `>=` en vez de un `>` en la comprobacion,
    // pedir la asistencia de un martes concreto devolveria un 400.
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1', fecha: dia('2026-10-05') })],
      reservas: [reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true })],
    });

    const reporte = await servicio.asistencia(ACTOR, {
      desde: '2026-10-05',
      hasta: '2026-10-05',
    });

    expect(reporte.alumnos[0].presentes).toBe(1);
  });

  it('un rango descomunal se recorta a un ano, y el reporte lo dice', async () => {
    // Mismo criterio que el tope de `mesesAdelante`: recortar y contestar es
    // mejor respuesta que un 400, y sin tope un rango de diez anos recorre todas
    // las reservas del gimnasio. El `hasta` que vuelve es el RECORTADO: devolver
    // el pedido seria decir que se miro un ano que no se miro.
    const { servicio, db } = crear(PADRON);

    const reporte = await servicio.asistencia(ACTOR, {
      desde: '2026-01-01',
      hasta: '2036-01-01',
    });

    expect(reporte.hasta).toBe('2027-01-01');
    expect(rangoPedido(db)).toEqual({ gte: dia('2026-01-01'), lt: dia('2027-01-02') });
  });

  it('salen en orden alfabetico, no en el que vino de la base', async () => {
    const { servicio } = crear({
      ...PADRON,
      usuarios: [
        usuario({ id: 'u-1', nombreCompleto: 'Zoe Vega' }),
        usuario({ id: 'u-2', nombreCompleto: 'Bruno Diaz' }),
      ],
      turnos: [turno({ id: 't-1' })],
      reservas: [
        reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true }),
        reserva({ turnoId: 't-1', perfilId: 'a-2', asistio: true }),
      ],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(reporte.alumnos.map((fila) => fila.nombreCompleto)).toEqual(['Bruno Diaz', 'Zoe Vega']);
  });

  it('un alumno sin ninguna reserva en el rango no aparece', async () => {
    // Listarlo con tres ceros seria afirmar algo que no se midio.
    const { servicio } = crear({
      ...PADRON,
      turnos: [turno({ id: 't-1' })],
      reservas: [reserva({ turnoId: 't-1', perfilId: 'a-1', asistio: true })],
    });

    const reporte = await servicio.asistencia(ACTOR, RANGO);

    expect(reporte.alumnos.map((fila) => fila.perfilId)).toEqual(['a-1']);
  });

  it('la clave del cache lleva el rango y el alumno', async () => {
    const { servicio, claves } = crear(PADRON);

    await servicio.asistencia(ACTOR, { ...RANGO, perfilId: 'a1' });

    expect([...claves.keys()]).toEqual(['stats:gym-1:v0:asistencia:2026-10-01:2026-10-31:a1']);
  });
});

describe('ConsultaRangoDto', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const comoQuery = { type: 'query' as const, metatype: ConsultaRangoDto };

  it('acepta las dos fechas y el perfilId opcional', async () => {
    await expect(
      pipe.transform({ desde: '2026-10-01', hasta: '2026-10-31' }, comoQuery),
    ).resolves.toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
  });

  it('400 si falta una de las dos fechas', async () => {
    await expect(pipe.transform({ desde: '2026-10-01' }, comoQuery)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('400 si la fecha trae hora', async () => {
    // `@IsDateString()` —lo que pedia el plan— aceptaria esto, y llegaria al
    // service, donde `desdeFechaISO` lo rechaza con una excepcion que nadie
    // traduce: un 500 opaco en vez de un 400. (Los `:` de la hora NO llegarian a
    // la clave del cache, aunque el docblock lo dijera: `desdeFechaISO` lanza
    // antes de `cache.recordar`. Lo comprobo una revision.)
    await expect(
      pipe.transform({ desde: '2026-10-01T12:00:00Z', hasta: '2026-10-31' }, comoQuery),
    ).rejects.toThrow(BadRequestException);
  });

  it('400 si el perfilId trae un separador de clave de cache', async () => {
    await expect(
      pipe.transform(
        { desde: '2026-10-01', hasta: '2026-10-31', perfilId: 'a:caja:2026-10' },
        comoQuery,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('400 si se manda un salaId: la asistencia es del alumno, no de una sala', async () => {
    await expect(
      pipe.transform({ desde: '2026-10-01', hasta: '2026-10-31', salaId: 'sala1' }, comoQuery),
    ).rejects.toThrow(BadRequestException);
  });
});
