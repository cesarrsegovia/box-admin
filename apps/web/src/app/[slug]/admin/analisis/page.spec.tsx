import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  CajaDelMes,
  ComposicionAlumnos,
  MetricasOperativas,
  Operativo,
  RolUsuario,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeStats, type Mes } from '@/hooks/use-stats';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeAnalisis from './page';
// Los ayudantes viven FUERA de `page.tsx`: Next 15 no deja exportar nada mas
// que el `default` desde una pagina. Ver el comentario de `filtros.ts`.
import { mesDeLaBusqueda } from './filtros';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  busqueda: { valor: '' },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym' }),
  useSearchParams: () => new URLSearchParams(busqueda.valor),
  usePathname: () => '/mi-gym/admin/analisis',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-stats.spec`. Lo que se audita
 * aqui es un escalon mas arriba: QUE pide esta pantalla a partir de lo que
 * leyo de la URL, y que hace con lo que vuelve. `ErrorDeApi` se deja REAL
 * porque la pagina ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * EL RELOJ, CONGELADO Y SOLO EL RELOJ.
 *
 * El mes por defecto de esta pantalla es el de HOY, y los meses que ofrece el
 * selector salen del mismo reloj. Sin congelarlo, este archivo cambiaria de
 * significado cada primero de mes y los `anio=2026&mes=1` escritos a mano
 * caducarian solos.
 *
 * Se falsea `Date` y NADA MAS (`toFake: ['Date']`): los temporizadores siguen
 * siendo de verdad, que es lo que necesitan `userEvent` y las esperas de
 * `esperar()`. Y `performance` se queda fuera por partida doble —ni esta en
 * esta lista ni en la de `vitest.config.ts`—, porque falsearlo sustituye el
 * objeto entero por el de sinon y deja ciego al sexto canal del espia.
 *
 * MARZO DE 2026 ES «HOY» Y ENERO DE 2026 ES EL MES DE LA URL, y son DISTINTOS
 * a proposito: con los dos iguales, «pide el mes de la URL» y «pide el mes de
 * hoy» son la misma afirmacion y la mitad de este archivo no podria fallar.
 */
const AHORA = new Date(Date.UTC(2026, 2, 17));

/** El mes que la mayoria de los tests pone en la URL. NO es el de hoy. */
const MES_DE_LA_URL = { anio: 2026, mes: 1 };
const CONSULTA_DEL_MES = `anio=${MES_DE_LA_URL.anio}&mes=${MES_DE_LA_URL.mes}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  busqueda.valor = '';
  // Los dos `Storage` y las galletas los deja como estaban —y ademas los
  // AUDITA— el tapon global de `vitest.setup.ts`. Limpiarlos aqui, en un
  // `afterEach` del spec que corre ANTES que el suyo, lo dejaria mirando unos
  // almacenes ya vacios.
});

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * LOS FIJOS NO CUADRAN, Y ESO ES EXACTAMENTE LO QUE LOS HACE SERVIR.
 *
 * `Porcentaje` es un contrato con un campo DERIVADO: el `porcentaje` sale de
 * su propia fraccion. Con un fijo coherente —`{ numerador: 3, denominador: 4,
 * porcentaje: 75 }`— ninguna afirmacion de esta pantalla puede decir QUIEN
 * calculo ese 75: sale igual si lo mando el servidor que si lo dividio el
 * cliente. Con `{ 14, 24, porcentaje: 99 }` si, y la pantalla tiene que pintar
 * el 99 —14 de 24 es 58%—, porque quien calcula es `porcentajeDe` en
 * `stats.service.ts` y aqui no se divide nada.
 *
 * Es la quinta forma de que un test exista y no pueda fallar: que el fijo
 * hable el idioma del codigo en vez del del contrato. Va por el lado de la
 * ENTRADA y vuelve decorativa cualquier asercion que se haga encima.
 *
 * PERO EL FIJO SIGUE SIENDO POSIBLE EN TODO LO DEMAS, que es la otra mitad de
 * la regla. Lo unico que se desalinea es el campo derivado; las relaciones que
 * el servicio SI garantiza se respetan, porque un fijo que las rompa es un
 * fijo que la API no puede devolver y entonces vuelve a hablar un idioma que
 * no es el del contrato:
 *
 * - LAS DOS CANCELACIONES COMPARTEN DENOMINADOR. `metricasDelMes` las calcula
 *   las dos sobre `reservas.length` —todas las del mes, vivas y canceladas—.
 *   Dos denominadores distintos serian un mes que no existe.
 * - Y ESE DENOMINADOR CUADRA con el resto: vivas + recuperables + definitivas.
 *   En enero: 14 vivas, 5 recuperables y 1 definitiva son las 20 reservas.
 * - LAS MARCADAS NO PASAN DE LAS VIVAS. El denominador de la asistencia son
 *   las reservas vivas con `asistio !== null`: 10 marcadas de 14 vivas.
 * - Y `denominador: 0` VIENE SIEMPRE CON `porcentaje: null`, que es lo que el
 *   contrato dice por escrito. Inventarle un numero seria sembrar justo el
 *   caso que la API no puede devolver.
 */
function unMes(anio: number, mes: number, cambios: Partial<MetricasOperativas> = {}) {
  return {
    anio,
    mes,
    // 14 de 24 es 58%, no 99. El 99 es el que manda la API y el que se pinta.
    ocupacion: { numerador: 14, denominador: 24, porcentaje: 99 },
    asistencia: { numerador: 7, denominador: 10, porcentaje: 98 },
    cobranza: { numerador: 18, denominador: 25, porcentaje: 97 },
    cancelacionRecuperable: { numerador: 5, denominador: 20, porcentaje: 96 },
    cancelacionDefinitiva: { numerador: 1, denominador: 20, porcentaje: 95 },
    ...cambios,
  } satisfies MetricasOperativas;
}

/**
 * EL TRIMESTRE, CON TRES MESES DISTINTOS ENTRE SI.
 *
 * Con tres meses iguales el orden no se puede comprobar: la lista dada vuelta
 * se ve exactamente igual que la lista derecha, y el test de «del mas viejo al
 * mas nuevo» pasaria con el `.reverse()` puesto. Cada mes trae su propia
 * ocupacion —91, 81, 71— y sus propias fracciones.
 *
 * SON LOS TRES ANTERIORES AL PEDIDO, que para enero de 2026 son octubre,
 * noviembre y diciembre de 2025. Los calcula `mesesAnteriores(anio, mes, 3)`,
 * que cruza el cambio de año; un trimestre que empezara en enero de 2026 seria
 * un fijo que la API no puede devolver.
 */
const OCTUBRE: MetricasOperativas = {
  anio: 2025,
  mes: 10,
  ocupacion: { numerador: 2, denominador: 24, porcentaje: 91 },
  asistencia: { numerador: 1, denominador: 2, porcentaje: 90 },
  cobranza: { numerador: 3, denominador: 25, porcentaje: 89 },
  cancelacionRecuperable: { numerador: 1, denominador: 4, porcentaje: 88 },
  cancelacionDefinitiva: { numerador: 1, denominador: 4, porcentaje: 87 },
};

const NOVIEMBRE: MetricasOperativas = {
  anio: 2025,
  mes: 11,
  ocupacion: { numerador: 6, denominador: 24, porcentaje: 81 },
  asistencia: { numerador: 4, denominador: 6, porcentaje: 80 },
  cobranza: { numerador: 9, denominador: 25, porcentaje: 79 },
  cancelacionRecuperable: { numerador: 2, denominador: 9, porcentaje: 78 },
  cancelacionDefinitiva: { numerador: 1, denominador: 9, porcentaje: 77 },
};

const DICIEMBRE: MetricasOperativas = {
  anio: 2025,
  mes: 12,
  ocupacion: { numerador: 10, denominador: 24, porcentaje: 71 },
  asistencia: { numerador: 8, denominador: 9, porcentaje: 70 },
  cobranza: { numerador: 15, denominador: 25, porcentaje: 69 },
  cancelacionRecuperable: { numerador: 3, denominador: 14, porcentaje: 68 },
  cancelacionDefinitiva: { numerador: 1, denominador: 14, porcentaje: 67 },
};

/** El reporte de enero de 2026 con su trimestre, del mas viejo al mas nuevo. */
const OPERATIVO: Operativo = {
  actual: unMes(MES_DE_LA_URL.anio, MES_DE_LA_URL.mes),
  trimestre: [OCTUBRE, NOVIEMBRE, DICIEMBRE],
};

// ---------------------------------------------------------------------------
// La caja: el fijo del dinero
// ---------------------------------------------------------------------------

/**
 * LA CAJA, CON SUS DOS CAMPOS DERIVADOS DESALINEADOS Y TODO LO DEMAS POSIBLE.
 *
 * Misma regla que el operativo, aplicada a los dos sitios donde este contrato
 * tiene un campo que SALE DE OTRO:
 *
 * 1. EL `texto` DE UN `Importe` SALE DE SUS `centavos`. `importe()` en el
 *    service los construye siempre juntos, asi que un `texto` que no concuerde
 *    con sus `centavos` es la unica forma de preguntarle a la pantalla CUAL DE
 *    LOS DOS esta usando para cada cosa. Aqui lo lleva desalineado UNO solo
 *    —el efectivo: 50000 centavos y «999.99»— y es suficiente: cualquier suma
 *    o porcentaje que pase por el texto sale distinto, y los demas importes se
 *    siguen leyendo contra su propio fijo sin tener que traducir nada.
 *
 * 2. EL `margen` SALE DE `cobrado - costoProfesoras`. 100000 - 40000 son 60000,
 *    y aqui vale 55555: si la pantalla restara en vez de pintar lo que vino,
 *    se veria.
 *
 * Y LO QUE EL SERVIDOR SI GARANTIZA SE RESPETA, que es la otra mitad de la
 * regla —un fijo imposible vuelve decorativa cualquier asercion que se haga
 * encima—:
 *
 * - EL DESGLOSE SUMA EXACTAMENTE LO COBRADO. `calcularCaja` construye
 *   `cobrado` como la suma de `porMetodo`: 50000 + 20000 + 30000 = 100000.
 *   Un desglose que no cuadre es un mes que la API no puede devolver.
 * - LOS METODOS VIENEN EN ORDEN ALFABETICO y sin repetir: lo hace
 *   `agruparPorMetodo`, y el orden es fijo porque la respuesta se cachea.
 * - `CORTESIA` NO ESTA EN EL DESGLOSE. El service la aparta antes de agrupar y
 *   la cuenta en `bonificado`. Un desglose con cortesia adentro seria la
 *   respuesta de un servidor que ya mezclo las dos cosas.
 * - Y EL BONIFICADO NO ES CERO —7500 centavos—, que es justamente el caso que
 *   hace falta: con una cortesia de cero, sumarla a lo cobrado no cambiaria
 *   ningun numero y el test de «aparte, no sumado» no podria fallar.
 */
const CAJA: CajaDelMes = {
  anio: MES_DE_LA_URL.anio,
  mes: MES_DE_LA_URL.mes,
  cobrado: { centavos: 100_000, texto: '1000.00' },
  porMetodo: [
    // 50000 centavos son «500.00». El «999.99» es la trampa: ninguna cuenta de
    // esta pantalla puede salir de ahi.
    { metodo: 'EFECTIVO', importe: { centavos: 50_000, texto: '999.99' } },
    { metodo: 'OTRO', importe: { centavos: 20_000, texto: '200.00' } },
    { metodo: 'TRANSFERENCIA', importe: { centavos: 30_000, texto: '300.00' } },
  ],
  bonificado: { centavos: 7_500, texto: '75.00' },
  costoProfesoras: { centavos: 40_000, texto: '400.00' },
  // 100000 - 40000 = 60000, y aqui dice 55555: el margen es el del servidor.
  margen: { centavos: 55_555, texto: '555.55' },
  pendienteEstimado: { centavos: 12_300, texto: '123.00' },
};

/** La misma caja de otro mes: la respuesta trae el mes que se pidio. */
function cajaDe(mes: Mes): CajaDelMes {
  return { ...CAJA, anio: mes.anio, mes: mes.mes };
}

/**
 * UN MES EN ROJO, que es un mes posible y no un caso raro.
 *
 * Lo dice el service por escrito: «el margen puede quedar en rojo: un mes flojo
 * con las clases dadas es exactamente eso, y el numero tiene que poder
 * decirlo». Aqui el margen SI es coherente con su texto —lo que se mide es el
 * signo— pero sigue sin ser `cobrado - costoProfesoras`.
 */
const CAJA_EN_ROJO: CajaDelMes = { ...CAJA, margen: { centavos: -12_345, texto: '-123.45' } };

// ---------------------------------------------------------------------------
// La composicion: el fijo de los alumnos
// ---------------------------------------------------------------------------

/**
 * LA COMPOSICION, CON LA TRAMPA DEL NOMBRE PUESTA A PROPOSITO.
 *
 * HAY DOS FILAS QUE SE LLAMAN «Sin pack» Y NO SON LO MISMO: una es un pack de
 * verdad con ese nombre —nada se lo impide a un gimnasio— y la otra es el grupo
 * de los que no tienen plan contratado, que el service agrupa bajo ese mismo
 * literal. Quien las distingue es `packId`, y por eso el fijo trae las dos: una
 * pantalla que se ramifique por el nombre las junta, y el grupo de los que no
 * pagan nada desaparece dentro de un plan que si se cobra.
 *
 * EL CAMPO DERIVADO ES `porcentaje`, y va desalineado: sobre 4 alumnos, 2 son
 * el 50% y 1 es el 25%, y aqui dicen 44, 33 y 22. Lo calcula el service y esta
 * pantalla no divide.
 *
 * LO DEMAS ES POSIBLE: los alumnos por pack suman `totalAlumnos` —cada alumno
 * esta en UN pack—, el `consumo` lista a los cuatro —`calcularComposicion` lo
 * arma recorriendo los mismos alumnos activos—, los packs vienen ordenados por
 * nombre con el grupo sin pack AL FINAL (`porGrupo`) y el consumo por nombre.
 */
const COMPOSICION: ComposicionAlumnos = {
  anio: MES_DE_LA_URL.anio,
  mes: MES_DE_LA_URL.mes,
  totalAlumnos: 4,
  porPack: [
    { packId: 'pack-libre', packNombre: 'Libre 3 veces', alumnos: 1, porcentaje: 33 },
    // UN PACK DE VERDAD QUE SE LLAMA «Sin pack». No es el grupo de abajo.
    { packId: 'pack-trampa', packNombre: 'Sin pack', alumnos: 2, porcentaje: 44 },
    // Y ESTE SI es el grupo de los que no tienen plan: `packId` en `null`.
    { packId: null, packNombre: 'Sin pack', alumnos: 1, porcentaje: 22 },
  ],
  consumo: [
    { perfilId: 'p-ana', nombreCompleto: 'Ana Gutierrez', clasesTomadas: 8 },
    { perfilId: 'p-bruno', nombreCompleto: 'Bruno Ledesma', clasesTomadas: 0 },
    { perfilId: 'p-carla', nombreCompleto: 'Carla Pinto', clasesTomadas: 3 },
    { perfilId: 'p-dario', nombreCompleto: 'Dario Sosa', clasesTomadas: 5 },
  ],
};

function composicionDe(mes: Mes): ComposicionAlumnos {
  return { ...COMPOSICION, anio: mes.anio, mes: mes.mes };
}

/**
 * UN MES SIN NADA QUE CONTAR, que es el caso que da nombre a esta fase.
 *
 * Es un mes sin turnos: un gimnasio que acaba de abrir, o un mes que todavia
 * no empezo. `StatsService.operativo` lo dice por escrito —«Sin turnos, las
 * cuatro metricas de clases salen con denominador cero y `porcentaje: null`»—,
 * asi que esto NO es un fijo inventado: es la respuesta literal de la API.
 *
 * La cobranza es la excepcion y tambien es real: estar al dia es una propiedad
 * del alumno y de sus pagos, no de una clase, asi que sigue teniendo
 * denominador aunque no haya habido ni un turno.
 */
const NADA_QUE_CONTAR: MetricasOperativas = {
  anio: MES_DE_LA_URL.anio,
  mes: MES_DE_LA_URL.mes,
  ocupacion: { numerador: 0, denominador: 0, porcentaje: null },
  asistencia: { numerador: 0, denominador: 0, porcentaje: null },
  cobranza: { numerador: 18, denominador: 25, porcentaje: 97 },
  cancelacionRecuperable: { numerador: 0, denominador: 0, porcentaje: null },
  cancelacionDefinitiva: { numerador: 0, denominador: 0, porcentaje: null },
};

/**
 * UN CERO DE VERDAD: hubo 20 reservas y NINGUNA se cayo definitivamente.
 *
 * Este si es coherente, y tiene que serlo: es el unico caso donde el 0 es el
 * resultado y no la ausencia de pregunta. 14 vivas + 6 recuperables + 0
 * definitivas son las 20 reservas del mes.
 */
const UN_CERO_DE_VERDAD: MetricasOperativas = unMes(MES_DE_LA_URL.anio, MES_DE_LA_URL.mes, {
  cancelacionRecuperable: { numerador: 6, denominador: 20, porcentaje: 96 },
  cancelacionDefinitiva: { numerador: 0, denominador: 20, porcentaje: 0 },
});

/**
 * LO QUE ESTA PANTALLA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON
 * EL DOM.
 *
 * Este reporte es el unico de los seis que NO trae ni un nombre ni un importe:
 * son diez numeros sueltos por mes. O sea que no hay una cadena con forma de
 * secreto que registrar, y eso NO quiere decir que no haya nada que vigilar —
 * la ocupacion y la cobranza de un gimnasio son su situacion comercial, y un
 * `console.info('[analisis]', datos)` o una marca de rendimiento con el numero
 * dentro las publican igual.
 *
 * Asi que se registran las dos FORMAS que tomaria la fuga, que es lo unico que
 * un centinela puede mirar aqui: el volcado del objeto entero —el serializado
 * que deja un `console.log` o el `detail` de un `performance.mark`— y la
 * fraccion ya pintada, que es la que tiene forma de texto y acabaria en un
 * `document.title` o en `window.name`.
 *
 * Y CON LA TASK 3 YA LAS HAY. La caja trae el margen del salon, lo que cuesta
 * cada profesora y el desglose por metodo de pago; la composicion trae los
 * nombres de los packs y los de los alumnos uno por uno. Son cadenas de verdad
 * y se registran TODAS, no una de muestra: un tapon solo mira lo que se le
 * nombra, y el canal por el que se escape el dato que falto en esta lista no
 * dira nada.
 *
 * Se registra el importe PINTADO —el `texto`, que es lo que acabaria en un
 * `document.title`— y tambien el volcado de los `centavos`, que es la forma que
 * toma un `console.log(caja)` o el `detail` de un `performance.mark`. Son dos
 * grafias del mismo dinero y ninguna de las dos puede salir del `<body>`.
 */
vigilarEstosDatos({
  elVolcadoDelReporte: '"numerador":14,"denominador":24,"porcentaje":99',
  laFraccionDeLaOcupacion: '14 de 24',
  laFraccionDeLaCobranza: '18 de 25',
  // La caja: el dato mas sensible del sistema.
  elMargen: '555.55',
  elVolcadoDelMargen: '"centavos":55555',
  loQueCuestanLasProfesoras: '400.00',
  loCobrado: '1000.00',
  loCobradoEnEfectivo: '999.99',
  loBonificado: '75.00',
  elPendienteEstimado: '123.00',
  // La composicion: nombres de packs y de personas.
  elNombreDeUnPack: 'Libre 3 veces',
  elNombreDeUnAlumno: 'Ana Gutierrez',
  elVolcadoDeUnAlumno: '"nombreCompleto":"Dario Sosa"',
});

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  operativo?: Operativo;
  caja?: CajaDelMes;
  composicion?: ComposicionAlumnos;
  /** Lo que falla al LEER los reportes. Falla LA API, no un endpoint suelto. */
  error?: unknown;
  /**
   * Y esto falla SOLO la caja, que es el caso que de verdad pasa.
   *
   * La caja es el unico reporte que recorre la liquidacion de cada profesora,
   * asi que es el que puede romperse —o tardar— mientras los otros dos
   * contestan bien. Los tres bloques son independientes justamente por eso.
   */
  errorDeCaja?: unknown;
  /** El query de la URL, sin `?`. El mes vive ahi. */
  consulta?: string;
  /**
   * Quien mira. `null` es SIN PROVEEDOR, que no es lo mismo que un rol bajo:
   * es la pantalla montada fuera del armazon del panel, y tiene que valer «no
   * alcanza para nada».
   *
   * El valor por defecto es `ADMIN_OPERATIVO` A PROPOSITO: es el rol con el que
   * se entra al panel, o sea el caso que mas gente ve, y es el que NO tiene la
   * caja. Con `ADMIN_SALON` por defecto, el test de que la caja no se dibuja
   * seria el unico que probaria el caso comun.
   */
  rol?: RolUsuario | null;
}

function montar({
  operativo = OPERATIVO,
  caja,
  composicion,
  error,
  errorDeCaja,
  consulta = CONSULTA_DEL_MES,
  rol = 'ADMIN_OPERATIVO',
}: OpcionesDeMontaje = {}): QueryClient {
  busqueda.valor = consulta;

  /**
   * El mes de ESTE montaje, leido con la misma funcion que usa la pantalla.
   *
   * La caja y la composicion contestan el mes que se les pidio, asi que sus
   * fijos lo siguen: un montaje de febrero con una caja que dice enero seria
   * una respuesta que la API no puede dar, y el encabezado de ese bloque
   * —que se pinta del mes QUE VOLVIO— quedaria afirmando algo imposible.
   *
   * El operativo NO se deriva asi y se queda con su fijo de enero: su
   * trimestre son octubre, noviembre y diciembre de 2025, que solo son los
   * tres anteriores de enero. Los tests que montan otro mes le pasan el suyo.
   */
  const mesDelMontaje = mesDeLaBusqueda(new URLSearchParams(consulta), AHORA);
  const laCaja = caja ?? cajaDe(mesDelMontaje);
  const laComposicion = composicion ?? composicionDe(mesDelMontaje);

  /**
   * El doble responde POR RUTA y no por orden de llamada: con
   * `mockResolvedValueOnce` encadenados, agregar una peticion a la pantalla
   * corre todas las respuestas una posicion y los tests fallan en el sitio
   * equivocado.
   */
  const falloDeLaCaja = errorDeCaja ?? error;

  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta.startsWith('/stats/caja')) {
      return falloDeLaCaja === undefined ? Promise.resolve(laCaja) : Promise.reject(falloDeLaCaja);
    }
    if (error !== undefined) return Promise.reject(error);

    if (ruta.startsWith('/stats/operativo')) return Promise.resolve(operativo);
    if (ruta.startsWith('/stats/composicion-alumnos')) return Promise.resolve(laComposicion);
    // La lista del selector de la liquidacion. Lo que la liquidacion hace con
    // ella lo fija `liquidacion.spec`; aqui solo importa QUIEN la pide.
    if (ruta === '/usuarios?tipo=profesor') return Promise.resolve([]);
    if (ruta.startsWith('/liquidacion/')) {
      return Promise.reject(new ErrorDeApi('No hay ninguna profesora con ese id', 404));
    }

    throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga los datos: asi los tests que
  // miran el DOM no necesitan esperar. Sembrar NO apaga la peticion.
  //
  // Las claves salen de la MISMA funcion que usa la pantalla para leer el mes
  // de la URL: sembrar con un mes escrito a mano haria que una lectura
  // equivocada siguiera encontrando datos en la cache y pasara en verde.
  if (error === undefined) {
    cliente.setQueryData(clavesDeStats.operativo(mesDelMontaje), operativo);
    cliente.setQueryData(clavesDeStats.composicion(mesDelMontaje), laComposicion);
  }
  if (falloDeLaCaja === undefined) {
    cliente.setQueryData(clavesDeStats.caja(mesDelMontaje), laCaja);
  }

  const pantalla = <PaginaDeAnalisis />;

  render(
    <QueryClientProvider client={cliente}>
      {/* Sin rol se monta SIN proveedor: envolverla con un `rol={null}` no
          compila y, peor, probaria otra cosa —un contexto puesto en nulo— y no
          el caso que importa, que es la pantalla fuera del armazon. */}
      {rol === null ? pantalla : <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol>}
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/**
 * Las rutas pedidas, ORDENADAS ALFABETICAMENTE y SIN DEDUPLICAR.
 *
 * SIN DEDUPLICAR porque lo que estas listas blancas cuidan es la CUENTA: una
 * lectura de mas no cambia un nodo ni manda un cuerpo, solo se ve contando, y
 * un `Set` la escondería.
 *
 * Y ORDENADAS A PROPOSITO, que es lo que cambio al llegar la Task 3. Con tres
 * reportes, el orden en que salen las peticiones es el que produce React
 * —los efectos de los hijos corren antes que los del padre, asi que la caja y
 * la composicion salen antes que el operativo— y no dice nada de esta
 * pantalla: mover un bloque de sitio romperia los tests sin que nada hubiera
 * cambiado para quien mira. Lo que importa es QUE se pide y CUANTAS veces.
 */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string).sort();
}

/**
 * Un bloque de la pantalla, MIRANDO EL MARCADO.
 *
 * `querySelector` y no un `*ByRole`: el arbol de accesibilidad YA EXCLUYE lo
 * que lleva `hidden`, asi que un `queryByRole` en null no distingue «no esta»
 * de «esta ahi y oculto». Y la caja escondida con CSS filtra exactamente igual
 * que la caja dibujada: los numeros estan en el documento.
 */
function bloque(nombre: string): HTMLElement | null {
  return document.querySelector(`[data-bloque="${nombre}"]`);
}

/** El mismo bloque, pero reventando si no esta. */
function dentroDe(nombre: string): HTMLElement {
  const nodo = bloque(nombre);
  if (nodo === null) throw new Error(`No hay ningun bloque «${nombre}»`);

  return nodo;
}

/** El importe EXACTO de una cifra de la caja. Nada de buscar subcadenas. */
function importeDe(clave: string): string {
  const cifra = dentroDe('caja').querySelector(`[data-cifra="${clave}"]`);
  if (cifra === null) throw new Error(`No hay ninguna cifra de «${clave}»`);

  return cifra.querySelector('[data-importe]')?.textContent?.trim() ?? '';
}

/** La nota que acompaña a una cifra, para afirmar sobre lo que se EXPLICA. */
function notaDe(clave: string): string {
  const cifra = dentroDe('caja').querySelector(`[data-cifra="${clave}"]`);
  if (cifra === null) throw new Error(`No hay ninguna cifra de «${clave}»`);

  return cifra.querySelector('[data-nota]')?.textContent?.trim() ?? '';
}

/** La fila del desglose de un metodo de pago. */
function filaDelMetodo(metodo: string): HTMLElement {
  const marca = dentroDe('caja').querySelector(`[data-metodo="${metodo}"]`);
  const fila = marca?.closest('tr');
  if (!fila) throw new Error(`No hay ninguna fila del metodo «${metodo}»`);

  return fila as HTMLElement;
}

function importeDelMetodo(metodo: string): string {
  return filaDelMetodo(metodo).querySelector('[data-importe]')?.textContent?.trim() ?? '';
}

function participacionDe(metodo: string): string {
  return filaDelMetodo(metodo).querySelector('[data-participacion]')?.textContent?.trim() ?? '';
}

/** Los metodos del desglose, en orden: para fijar el conjunto ENTERO. */
function metodosDelDesglose(): string[] {
  return [...dentroDe('caja').querySelectorAll('[data-metodo]')].map(
    (nodo) => nodo.getAttribute('data-metodo') ?? '',
  );
}

function totalDelDesglose(): string {
  return dentroDe('caja').querySelector('[data-total-del-desglose]')?.textContent?.trim() ?? '';
}

/** Las filas del reparto por pack, identificadas por su ID y no por su nombre. */
function filasPorPack(): HTMLElement[] {
  return [...dentroDe('composicion').querySelectorAll('[data-pack-id]')].map(
    (nodo) => nodo.closest('tr') as HTMLElement,
  );
}

/** El nodo marcado de una fila del reparto, buscado por ID de pack. */
function filaDelPack(packId: string): HTMLElement {
  const marca = dentroDe('composicion').querySelector(`[data-pack-id="${packId}"]`);
  if (marca === null) throw new Error(`No hay ninguna fila del pack «${packId}»`);

  return marca as HTMLElement;
}

function porcentajeDelPack(packId: string): string {
  const fila = filaDelPack(packId).closest('tr');
  return fila?.querySelector('[data-porcentaje]')?.textContent?.trim() ?? '';
}

/** Los alumnos del consumo, por su id: el conjunto ENTERO y en orden. */
function alumnosDelConsumo(): string[] {
  return [...dentroDe('composicion').querySelectorAll('[data-alumno]')].map(
    (nodo) => nodo.getAttribute('data-alumno') ?? '',
  );
}

function clasesDe(perfilId: string): string {
  const marca = dentroDe('composicion').querySelector(`[data-alumno="${perfilId}"]`);
  const fila = marca?.closest('tr');
  if (!fila) throw new Error(`No hay ninguna fila del alumno «${perfilId}»`);

  return fila.querySelector('[data-clases]')?.textContent?.trim() ?? '';
}

/** La tarjeta de una metrica del mes elegido. Revienta si no esta. */
function tarjetaDe(clave: string): HTMLElement {
  const tarjeta = document.querySelector(`[data-bloque="mes"] [data-metrica="${clave}"]`);
  if (tarjeta === null) throw new Error(`No hay ninguna tarjeta de «${clave}»`);

  return tarjeta as HTMLElement;
}

/** El numero grande de una metrica, EXACTO: nada de buscar subcadenas. */
function numeroDe(clave: string): string {
  return tarjetaDe(clave).querySelector('[data-numero]')?.textContent?.trim() ?? '';
}

/** La fraccion de una metrica, EXACTA. */
function fraccionDe(clave: string): string {
  return tarjetaDe(clave).querySelector('[data-fraccion]')?.textContent?.trim() ?? '';
}

/** Las metricas que la pantalla pinta para el mes elegido, en orden. */
function metricasDelMes(): string[] {
  return [...document.querySelectorAll('[data-bloque="mes"] [data-metrica]')].map(
    (nodo) => nodo.getAttribute('data-metrica') ?? '',
  );
}

/**
 * Las columnas del trimestre, ACOTADAS A SU BLOQUE.
 *
 * Un `document.querySelectorAll('th')` suelto mezclaba las tres tablas de esta
 * pantalla desde que la Task 3 trajo el desglose por metodo y el reparto por
 * pack: la lista blanca de columnas pasaba a tener once y el fallo no decia de
 * que tabla sobraban.
 */
function columnasDelTrimestre(): string[] {
  return [...dentroDe('trimestre').querySelectorAll('th')].map(
    (th) => th.textContent?.trim() ?? '',
  );
}

/** Cada fila del trimestre, celda por celda. Tambien acotada a su bloque. */
function filasDelTrimestre(): string[][] {
  return [...dentroDe('trimestre').querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

/** El primer campo de cada fila del trimestre: el mes. */
function mesesDelTrimestre(): string[] {
  return filasDelTrimestre().map((celdas) => celdas[0] ?? '');
}

async function elegirElMes(valor: string): Promise<void> {
  const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  await usuario.selectOptions(screen.getByLabelText('Mes'), valor);
  await esperar();
}

// ---------------------------------------------------------------------------
// El mes vive en la URL
// ---------------------------------------------------------------------------

describe('el mes esta en la URL', () => {
  it('se pide el mes DE LA URL, no el de hoy', async () => {
    // Hoy es marzo de 2026 y la URL dice enero: las dos afirmaciones hacen
    // falta. Sin la segunda, una pantalla que ignorara la URL entera y pidiera
    // siempre el mes de hoy pasaria el dia que los dos coincidan.
    montar();
    await esperar();

    // LOS DOS REPORTES QUE VE UN OPERATIVO, y los dos con el mismo mes: el
    // selector es uno solo porque los tres endpoints toman `anio` y `mes` y
    // nada mas. La caja no esta porque este rol no la ve; eso se mide aparte.
    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=1',
      '/stats/operativo?anio=2026&mes=1',
    ]);
    expect(
      rutasPedidas().filter((ruta) => ruta.includes('mes=3')),
      'pidio el mes de hoy y no el de la URL',
    ).toEqual([]);
  });

  it('sin mes en la URL se pide el de hoy', async () => {
    montar({ consulta: '' });
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=3',
      '/stats/operativo?anio=2026&mes=3',
    ]);
  });

  it('medio mes en la URL no es medio mes: se cae al de hoy', async () => {
    // `?anio=2026` solo no significa «todo 2026» —el reporte no sabe contestar
    // eso— ni «enero de 2026». Es media eleccion, y la mitad que falta no se
    // adivina.
    montar({ consulta: 'anio=2026' });
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=3',
      '/stats/operativo?anio=2026&mes=3',
    ]);
  });

  it('un mes imposible NO se recorta: se cae al de hoy', async () => {
    // `?mes=13` recortado a 12 pintaria diciembre debajo de una barra de
    // direcciones que dice otra cosa, y el admin leeria los numeros de
    // diciembre creyendo que pidio otra cosa. Y `?mes=0` es un 400 del DTO.
    montar({ consulta: 'anio=2026&mes=13' });
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=3',
      '/stats/operativo?anio=2026&mes=3',
    ]);
  });

  it('el selector marca el mes que dice la URL', () => {
    // La otra mitad: la pantalla puede pedir el mes correcto y dejar el
    // control en otro, y entonces el admin ve «marzo» encima de los numeros de
    // enero.
    montar();

    expect(screen.getByLabelText('Mes')).toHaveValue('2026-1');
  });

  it('cambiar de mes escribe las DOS claves y conserva lo que ya habia', async () => {
    // Las dos claves juntas o ninguna. Y partiendo de la URL que YA hay: el
    // mes no puede borrar lo que lleve al lado —hoy un enlace compartido,
    // manana los parametros que agregue la Task 3—.
    montar({ consulta: `${CONSULTA_DEL_MES}&algo=puesto` });
    await elegirElMes('2026-2');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/analisis?anio=2026&mes=2&algo=puesto');
  });

  it('el mes sobrevive al boton de atras', async () => {
    // El boton de atras no es un evento que la pantalla reciba: es la URL
    // ANTERIOR, montada otra vez. Asi que se comprueba lo unico que lo hace
    // posible —que el mes no vive en `useState`—: se elige otro mes, se monta
    // la URL que ese cambio escribio, y se vuelve a montar la de antes. Las
    // dos tienen que pintar SU mes.
    montar();
    await elegirElMes('2026-2');

    const [destino] = empujar.mock.calls[0] as [string];
    const adelante = destino.slice(destino.indexOf('?') + 1);

    // Lo que la pantalla escribio en la URL es lo que el historial guarda.
    expect(adelante).toBe('anio=2026&mes=2');

    // Ir «adelante»: la URL nueva, montada desde cero.
    document.body.innerHTML = '';
    montar({ operativo: { ...OPERATIVO, actual: unMes(2026, 2) }, consulta: adelante });
    expect(screen.getByLabelText('Mes')).toHaveValue('2026-2');
    expect(screen.getByRole('heading', { name: 'febrero 2026' })).toBeInTheDocument();

    // Y «atras»: la de antes, tambien desde cero, con su mes puesto.
    document.body.innerHTML = '';
    montar();
    expect(screen.getByLabelText('Mes')).toHaveValue('2026-1');
    expect(screen.getByRole('heading', { name: 'enero 2026' })).toBeInTheDocument();
  });

  it('un mes viejo de un enlace guardado sigue estando en el selector', () => {
    // El selector ofrece un año, pero la URL la escribe cualquiera y un enlace
    // de hace dos años sigue siendo una peticion que la API contesta. Si el
    // mes elegido no estuviera entre las opciones, el control quedaria en
    // blanco mientras la pantalla pinta ese mes.
    montar({
      operativo: { actual: unMes(2024, 7), trimestre: [] },
      consulta: 'anio=2024&mes=7',
    });

    expect(screen.getByLabelText('Mes')).toHaveValue('2024-7');
    expect(screen.getByRole('heading', { name: 'julio 2024' })).toBeInTheDocument();
  });

  it('el encabezado dice el mes QUE VOLVIO, no el que marca el selector', () => {
    // Los dos coinciden hoy —`/stats/operativo` devuelve el mes que se le
    // pidio—, y aun asi el titulo se pinta del `actual` de la respuesta y no
    // del control: es el mismo criterio que el `hasta` de la asistencia y el
    // `mesesAdelante` de los turnos libres, los dos campos que vuelven
    // RECORTADOS. Pintar lo que uno mismo mando es decir que se miro algo que
    // a lo mejor no se miro.
    montar();

    expect(screen.getByRole('heading', { name: 'enero 2026' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'marzo 2026' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Los cinco porcentajes
// ---------------------------------------------------------------------------

describe('los cinco porcentajes del mes', () => {
  // LISTA BLANCA, escrita A MANO: el conjunto ENTERO. Derivarla de
  // `LAS_CINCO_METRICAS` —la misma lista con la que la pantalla los pinta—
  // seria autorreferencial: agregar una sexta moveria los dos lados a la vez y
  // el test seguiria verde.
  it('los cinco porcentajes estan, y solo esos cinco', () => {
    montar();

    expect(metricasDelMes()).toEqual([
      'ocupacion',
      'asistencia',
      'cobranza',
      'cancelacionRecuperable',
      'cancelacionDefinitiva',
    ]);
  });

  it('la pantalla pinta el porcentaje DEL SERVIDOR, no uno recalculado', () => {
    // 14 de 24 es 58%. El servidor manda 99 y el 99 es el que vale: quien
    // calcula es `porcentajeDe` en el service, y dos implementaciones del
    // mismo numero acaban discrepando sin que nadie sepa cual creer.
    montar();

    expect(numeroDe('ocupacion')).toBe('99%');
    expect(numeroDe('ocupacion'), 'dividio la fraccion en vez de leer el campo').not.toBe('58%');

    // Los cinco, no solo el primero: con una sola comparacion, cuatro
    // divisiones pasan.
    expect(numeroDe('asistencia')).toBe('98%');
    expect(numeroDe('cobranza')).toBe('97%');
    expect(numeroDe('cancelacionRecuperable')).toBe('96%');
    expect(numeroDe('cancelacionDefinitiva')).toBe('95%');
  });

  it('el numerador y el denominador estan a la vista, no solo el porcentaje', () => {
    // Sin la fraccion al lado, «50%» son dos de cuatro o cien de doscientas, y
    // no son lo mismo para decidir nada. Los cinco la llevan.
    montar();

    expect(fraccionDe('ocupacion')).toBe('14 de 24');
    expect(fraccionDe('asistencia')).toBe('7 de 10');
    expect(fraccionDe('cobranza')).toBe('18 de 25');
    expect(fraccionDe('cancelacionRecuperable')).toBe('5 de 20');
    expect(fraccionDe('cancelacionDefinitiva')).toBe('1 de 20');
  });

  it('denominador CERO no se pinta como 0%', () => {
    // EL TEST DE LA FASE. Una ocupacion en 0% le dice al dueño que no vino
    // nadie; la verdad puede ser que no hubo nada a lo que venir. Se afirma
    // con igualdad EXACTA y no buscando «0%» dentro del texto, porque «100%»
    // tambien contiene «0%» y la afirmacion pasaria por casualidad
    // ortografica.
    montar({ operativo: { actual: NADA_QUE_CONTAR, trimestre: [] } });

    for (const clave of [
      'ocupacion',
      'asistencia',
      'cancelacionRecuperable',
      'cancelacionDefinitiva',
    ]) {
      expect(numeroDe(clave), `${clave} se pinto como un numero`).toBe('Sin datos');
      expect(numeroDe(clave), `${clave} se pinto como 0%`).not.toBe('0%');
    }

    // Y se DICE por que, con palabras: un hueco o un guion en el sitio del
    // numero se leen como que la pantalla no termino de cargar, que es otra
    // mentira distinta.
    expect(tarjetaDe('ocupacion').textContent).toContain('No hubo nada que contar');

    // La fraccion sigue a la vista: es la que demuestra que el denominador es
    // cero y no que el dato falte.
    expect(fraccionDe('ocupacion')).toBe('0 de 0');

    // La cobranza del mismo mes SI tiene denominador —estar al dia no depende
    // de que haya habido clases—, y se pinta normal. Sin esto, una pantalla
    // que no pintara NUNCA un numero pasaria el test de arriba entero.
    expect(numeroDe('cobranza')).toBe('97%');
  });

  it('un 0% de verdad SI se pinta como 0%', () => {
    // La otra mitad: sin este caso, «nunca pinta 0%» tambien pasaria el
    // anterior. Hubo 20 reservas y ninguna se cayo definitivamente: el cero es
    // el resultado, no la ausencia de pregunta.
    montar({ operativo: { actual: UN_CERO_DE_VERDAD, trimestre: [] } });

    expect(numeroDe('cancelacionDefinitiva')).toBe('0%');
    expect(fraccionDe('cancelacionDefinitiva')).toBe('0 de 20');
    expect(tarjetaDe('cancelacionDefinitiva').textContent).not.toContain('No hubo nada que contar');
  });

  it('cada porcentaje dice SOBRE QUE se calcula', () => {
    // Un numero grande sin su denominador explicado es una invitacion a
    // comparar dos cosas que no se comparan. Se afirma sobre el texto entero y
    // no con una expresion laxa: una frase generica la pasaria igual.
    montar();

    expect(tarjetaDe('ocupacion').textContent).toContain(
      'lugares reservados sobre los cupos de los turnos del mes',
    );
    expect(tarjetaDe('cobranza').textContent).toContain(
      'alumnos al dia al cerrar el mes, sobre los que tienen pack',
    );
    expect(tarjetaDe('cancelacionRecuperable').textContent).toContain(
      'reservas reprogramadas sobre todas las reservas del mes',
    );
    expect(tarjetaDe('cancelacionDefinitiva').textContent).toContain(
      'reservas dadas de baja sobre todas las reservas del mes',
    );
  });

  it('la asistencia dice que su denominador son las reservas CON LISTA PASADA', () => {
    // Es la definicion peligrosa del reporte entero: el denominador son las
    // reservas de turnos DONDE SE PASO LISTA, no las reservas. Una profesora
    // que no pasa lista no produce alumnos ausentes: produce alumnos
    // INVISIBLES, y un «98%» sin decir sobre que invita a tomar una decision
    // sobre alguien con un numero que puede cubrir tres clases de doce.
    montar();

    expect(tarjetaDe('asistencia').textContent).toContain(
      'presentes sobre las reservas de turnos con lista pasada',
    );
    expect(tarjetaDe('asistencia').textContent).toContain(
      'Una clase sin lista pasada no produce ausentes: no entra en la cuenta.',
    );
  });
});

// ---------------------------------------------------------------------------
// El trimestre
// ---------------------------------------------------------------------------

describe('los meses anteriores', () => {
  it('el trimestre se pinta del mas viejo al mas nuevo', () => {
    // Lo dice el contrato —«Los tres meses anteriores, del mas viejo al mas
    // nuevo»— y lo cumple `mesesAnteriores`. Los tres meses sembrados son
    // DISTINTOS entre si: con tres iguales, la lista dada vuelta se ve igual
    // que la derecha y este test pasaria con el `.reverse()` puesto.
    montar();

    expect(mesesDelTrimestre()).toEqual(['octubre 2025', 'noviembre 2025', 'diciembre 2025']);
  });

  it('y los numeros van con su mes, no corridos', () => {
    // El orden de las FILAS no basta: una tabla puede ordenar bien los meses y
    // pintar en cada uno los numeros del vecino. Cada ocupacion es distinta a
    // proposito —91, 81, 71— para que eso se vea.
    montar();

    const ocupaciones = filasDelTrimestre().map((celdas) => celdas[1] ?? '');
    expect(ocupaciones).toEqual(['91%2 de 24', '81%6 de 24', '71%10 de 24']);
  });

  // LISTA BLANCA: el conjunto ENTERO de columnas, escrito a mano. Una columna
  // de mas —el error que ningun test de presencia ve— rompe esto.
  it('el trimestre tiene ESTAS columnas y solo estas', () => {
    montar();

    expect(columnasDelTrimestre()).toEqual([
      'Mes',
      'Ocupacion',
      'Asistencia',
      'Cobranza',
      'Cancelacion recuperable',
      'Cancelacion definitiva',
    ]);
  });

  it('un gimnasio nuevo no pinta ceros en el trimestre', () => {
    // El caso REAL de un gimnasio sin historia: la API devuelve los tres meses
    // igual —`mesesAnteriores` siempre da tres— y los tres vienen con
    // denominador cero. Si la tabla los pintara como 0%, el dueño veria tres
    // meses de «no vino nadie» sobre un gimnasio que todavia no existia.
    const vacio = { ...NADA_QUE_CONTAR, anio: 2025, mes: 12 };
    montar({ operativo: { actual: unMes(2026, 1), trimestre: [vacio] } });

    const celdas = filasDelTrimestre()[0] ?? [];
    expect(celdas[1]).toBe('Sin datos0 de 0');
    expect(celdas[1], 'un mes sin turnos se pinto como 0%').not.toContain('0%');
  });

  it('un trimestre con MENOS de tres meses no inventa huecos', () => {
    // OJO CON LA PREMISA, QUE SE MIDIO: la API de hoy SIEMPRE manda tres
    // —`calcularOperativo` recorre `mesesAnteriores(anio, mes, 3)` sin
    // condiciones—, asi que un gimnasio nuevo no recibe un trimestre corto
    // sino tres meses con denominador cero (el caso de arriba, que es el que
    // de verdad ocurre).
    //
    // Este caso NO reproduce una respuesta real: fija que la pantalla pinta
    // LOS QUE VENGAN y no rellena hasta tres. Es una afirmacion sobre la
    // aritmetica de esta pantalla —que no tiene un `3` escrito en ningun
    // sitio— y no sobre el contrato.
    montar({ operativo: { actual: unMes(2026, 1), trimestre: [NOVIEMBRE, DICIEMBRE] } });

    expect(mesesDelTrimestre()).toEqual(['noviembre 2025', 'diciembre 2025']);
    expect(filasDelTrimestre()).toHaveLength(2);
  });

  it('sin meses anteriores se dice, no se deja una tabla con la cabecera sola', () => {
    // Una cabecera con nada debajo se ve igual que una averia.
    montar({ operativo: { actual: unMes(2026, 1), trimestre: [] } });

    expect(filasDelTrimestre()).toEqual([]);
    expect(screen.getByText('Todavia no hay meses anteriores que comparar.')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lo que se pide, y lo que falla
// ---------------------------------------------------------------------------

describe('lo que la pantalla pide', () => {
  it('al montar pide ESTO y nada mas', async () => {
    // LISTA BLANCA de peticiones. Una lectura de mas no cambia un nodo ni
    // manda un cuerpo: solo se ve contando. Y el operativo es el reporte mas
    // caro del sistema —cuatro meses de metricas por peticion—.
    montar();
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=1',
      '/stats/operativo?anio=2026&mes=1',
    ]);
  });

  it('y un ADMIN_SALON pide ESTO, que es lo mismo mas la caja y las profesoras', async () => {
    // La otra mitad de la lista blanca. Una vez cada una: la caja no se pide
    // dos veces por estar en un bloque aparte. Y la liquidacion NO esta: sin
    // `?profesora=` no hay una por defecto, y pedir la primera seria pedir el
    // sueldo de alguien que nadie busco.
    montar({ rol: 'ADMIN_SALON' });
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/caja?anio=2026&mes=1',
      '/stats/composicion-alumnos?anio=2026&mes=1',
      '/stats/operativo?anio=2026&mes=1',
      '/usuarios?tipo=profesor',
    ]);

    // Y la caja NO lleva `salaId`: `ConsultaMensualDto` no lo tiene y el
    // ValidationPipe corre con `forbidNonWhitelisted`, asi que mandarlo es un
    // 400. Viene de un bug real —`/stats/caja?salaId=` devolvia los numeros de
    // TODAS las salas, una mentira con codigo 200—.
    expect(rutasPedidas().filter((ruta) => ruta.includes('salaId'))).toEqual([]);
  });

  it('no habla con la red por fuera de `pedir`', async () => {
    // El doble CONTESTA como contestaria la red —un 200 con JSON— en vez de
    // devolver `undefined`: asi una peticion clandestina falla por la
    // afirmacion de abajo, que dice a donde se hablaba, y no por un
    // `TypeError` al encadenarle algo al resultado.
    const red = vi.fn((_destino: RequestInfo | URL) =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', red);

    try {
      montar();
      await esperar();
      await elegirElMes('2026-2');

      expect(red.mock.calls.map(([destino]) => String(destino))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('cuando el reporte no se puede leer', () => {
  it('un fallo al leer no se parece a un mes sin datos', async () => {
    // Un 500 dibujado como celdas vacias —o como «Sin datos» en los cinco—
    // diria que el gimnasio no tuvo clases, no que no se pudo preguntar. Son
    // dos cosas distintas y la segunda tiene arreglo.
    montar({ error: new ErrorDeApi('La base no contesta', 500) });
    await esperar();

    // Acotado al bloque del operativo: cuando la API no contesta fallan LOS
    // TRES reportes y cada uno pone su cartel, que es lo correcto —un fallo de
    // la caja no puede borrar la ocupacion—. Un `getByRole('alert')` suelto
    // reventaria con «found multiple elements» y el fallo apuntaria al sitio
    // equivocado.
    const elOperativo = within(dentroDe('operativo'));
    expect(elOperativo.getByRole('alert').textContent).toContain('La base no contesta');
    expect(elOperativo.getByRole('alert').textContent).toContain('No se pudieron leer los numeros');

    // Y los numeros NO se pintan: ni el grande, ni la fraccion, ni la frase de
    // «no hubo nada que contar», que es justo la que lo haria pasar por un mes
    // vacio.
    expect(metricasDelMes()).toEqual([]);
    expect(document.body.textContent).not.toContain('Sin datos');
    expect(document.body.textContent).not.toContain('No hubo nada que contar');

    // Se puede volver a intentar: un fallo de lectura se arregla reintentando,
    // un mes sin datos no.
    expect(elOperativo.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('un mes sin datos NO ofrece reintentar', () => {
    // La otra mitad del anterior: si el boton estuviera siempre, los dos
    // estados volverian a verse igual.
    montar({ operativo: { actual: NADA_QUE_CONTAR, trimestre: [] } });

    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('una sesion caducada manda al login CONSERVANDO el mes', async () => {
    // El mes es el estado de esta pantalla. Volver del login al mes de hoy es
    // perder el mes que la persona acababa de elegir, y encima parece que
    // funciona.
    montar({ error: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
    const [destino] = empujar.mock.calls[0] as [string];

    expect(destino).toBe(
      `/mi-gym/login?volverA=${encodeURIComponent(`/mi-gym/admin/analisis?${CONSULTA_DEL_MES}`)}`,
    );
    // Y el destino sobrevive entero a la lista blanca que lo valida: un
    // `volverA` que esa funcion descarte manda a la persona a la portada del
    // gimnasio sin decir nada.
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA') ?? undefined;
    expect(rutaDeRetornoSegura(volverA, 'mi-gym')).toBe(
      `/mi-gym/admin/analisis?${CONSULTA_DEL_MES}`,
    );

    // Y no se enseña el «Unauthorized» crudo de la API, que no le dice nada a
    // nadie, ni se ofrece reintentar mientras la pantalla ya se esta yendo.
    expect(screen.getByRole('alert').textContent).toBe('Tu sesion caduco. Te llevamos al login.');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La puerta de rol: la caja es de ADMIN_SALON
// ---------------------------------------------------------------------------

/**
 * LAS DOS MITADES DE UNA PUERTA, Y HACEN FALTA LAS DOS.
 *
 * Un bloque que NO SE DIBUJA pero SI SE PIDE filtra exactamente igual que uno
 * dibujado: la respuesta viaja al navegador, se queda en la cache de TanStack y
 * se lee desde las herramientas del navegador o desde la pestaña de red. Y al
 * reves, un bloque que no se pide pero deja el hueco en el marcado anuncia que
 * hay algo que no se esta viendo.
 *
 * Y LA MITAD DEL MARCADO SE AFIRMA SOBRE EL MARCADO, no con un `*ByRole`: el
 * arbol de accesibilidad ya excluye lo que lleva `hidden`, asi que un
 * `queryByRole` en null no distingue «no esta» de «esta y esta oculto» —que es
 * justo la version equivocada de esta puerta—.
 */
describe('la caja es de ADMIN_SALON y nadie mas', () => {
  it('un ADMIN_OPERATIVO no tiene la caja en el marcado', async () => {
    montar();
    await esperar();

    expect(bloque('caja')).toBeNull();
    // Ni la liquidacion, que pasa por la misma puerta.
    expect(bloque('liquidacion')).toBeNull();

    // Y NO esta escondida: se mira el HTML crudo, que es donde se veria un
    // bloque con `hidden` o con `display:none`. Los tres numeros del dinero,
    // uno por uno: con uno solo, un marcado que pinte los otros dos pasa.
    expect(document.body.innerHTML, 'el margen esta en el marcado').not.toContain('555.55');
    expect(document.body.innerHTML, 'lo cobrado esta en el marcado').not.toContain('1000.00');
    expect(document.body.innerHTML, 'el costo de las profesoras esta en el marcado').not.toContain(
      '400.00',
    );
  });

  it('y tampoco la pide: la lista de peticiones no la lleva', async () => {
    montar();
    await esperar();

    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=1',
      '/stats/operativo?anio=2026&mes=1',
    ]);
    expect(
      rutasPedidas().filter((ruta) => ruta.startsWith('/stats/caja')),
      'se pidio la caja sin dibujarla',
    ).toEqual([]);
  });

  it('sin proveedor de rol tampoco se dibuja', async () => {
    // «Sin proveedor» no es un rol bajo: es la pantalla montada fuera del
    // armazon del panel. Tiene que valer «no alcanza para nada», porque lo que
    // no puede pasar es que un reordenamiento del layout ABRA el dato mas
    // sensible del sistema.
    montar({ rol: null });
    await esperar();

    expect(bloque('caja')).toBeNull();
    expect(bloque('liquidacion')).toBeNull();
    expect(rutasPedidas()).toEqual([
      '/stats/composicion-alumnos?anio=2026&mes=1',
      '/stats/operativo?anio=2026&mes=1',
    ]);

    // Y lo demas sigue funcionando: la puerta cierra la caja, no la pantalla.
    expect(metricasDelMes()).toHaveLength(5);
    expect(bloque('composicion')).not.toBeNull();
  });

  it('un ADMIN_SALON si la ve, y ve TAMBIEN lo operativo', async () => {
    // `rolAlcanza` es una JERARQUIA y no una lista de roles exactos. Con un
    // `rol === 'ADMIN_SALON'` esto pasaria igual, y por eso esta el superadmin
    // en el test de abajo; lo que esta mitad fija es la otra confusion: una
    // puerta escrita como «la caja Y NADA MAS para el salon» le quitaria al
    // dueño del gimnasio la ocupacion y las cancelaciones.
    montar({ rol: 'ADMIN_SALON' });
    await esperar();

    expect(bloque('caja')).not.toBeNull();
    expect(importeDe('margen')).toBe('555.55');

    expect(metricasDelMes()).toEqual([
      'ocupacion',
      'asistencia',
      'cobranza',
      'cancelacionRecuperable',
      'cancelacionDefinitiva',
    ]);
    expect(mesesDelTrimestre()).toEqual(['octubre 2025', 'noviembre 2025', 'diciembre 2025']);
    expect(bloque('composicion')).not.toBeNull();
  });

  it('y un SUPERADMIN, que esta por encima, tambien la ve', async () => {
    // La otra mitad de la jerarquia: comparar por igualdad con 'ADMIN_SALON'
    // dejaria al superadmin fuera de su propio sistema, y el fallo no se veria
    // hasta que alguien con ese rol abriera la pantalla.
    montar({ rol: 'SUPERADMIN' });
    await esperar();

    expect(bloque('caja')).not.toBeNull();
    expect(importeDe('margen')).toBe('555.55');
    expect(bloque('liquidacion')).not.toBeNull();
  });

  it('la liquidacion de la URL viaja con el MISMO mes que la caja', async () => {
    // Un selector de mes para todo el dinero: la liquidacion no lee la URL por
    // su cuenta, recibe el mes ya resuelto. Si lo leyera aparte, un dia uno
    // de los dos se queda atras y la caja y el sueldo hablan de meses distintos.
    montar({ rol: 'ADMIN_SALON', consulta: 'anio=2025&mes=11&profesora=pf-1' });
    await esperar();

    expect(rutasPedidas().filter((ruta) => /^\/(stats\/caja|liquidacion)/.test(ruta))).toEqual([
      '/liquidacion/pf-1?anio=2025&mes=11',
      '/stats/caja?anio=2025&mes=11',
    ]);
  });

  it('una sesion caducada con la caja montada sigue avisando UNA sola vez', async () => {
    // Con tres reportes en la pantalla, un 401 los rompe los tres. El aviso es
    // del token y no de un reporte: tres carteles iguales taparian el unico
    // que importa, y encima el que lee no sabria si son tres problemas.
    montar({ rol: 'ADMIN_SALON', error: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe('Tu sesion caduco. Te llevamos al login.');
    expect(empujar).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// El dinero
// ---------------------------------------------------------------------------

describe('la caja del mes', () => {
  /** Todos estos miran la caja, asi que todos montan con quien la ve. */
  function montarLaCaja(opciones: OpcionesDeMontaje = {}): QueryClient {
    return montar({ rol: 'ADMIN_SALON', ...opciones });
  }

  it('el margen dice que mezcla dos bases', () => {
    // Lo dice el contrato por escrito y la pantalla tiene que decirlo tambien:
    // `cobrado` es CAJA —cuando entro el dinero— y `costoProfesoras` es
    // DEVENGADO —las clases de ese mes—. Se afirma sobre la nota de la tarjeta
    // DEL MARGEN y no sobre el texto de la pantalla: al lado del numero, que
    // es donde hace falta. Una advertencia al pie llega tarde, porque el margen
    // ya se comparo con el del mes pasado.
    montarLaCaja();

    expect(notaDe('margen')).toContain('caja');
    expect(notaDe('margen')).toContain('devengado');
    expect(notaDe('margen')).toContain('octubre el 28 de septiembre');
    expect(notaDe('margen')).toContain('comparar el margen de dos meses');
  });

  it('el margen es el del servidor, no una resta hecha aqui', () => {
    // 100000 - 40000 son 60000 y el servidor manda 55555. Dos
    // implementaciones del mismo numero acaban discrepando, y el dia que
    // discrepen la discusion es sobre el sueldo de alguien.
    montarLaCaja();

    expect(importeDe('margen')).toBe('555.55');
    expect(importeDe('margen'), 'resto cobrado - costo en vez de leer el campo').not.toBe('600.00');
  });

  it('lo bonificado se muestra APARTE de lo cobrado, no sumado', () => {
    // Una cortesia es un metodo de pago normal y NADA OBLIGA A QUE SU MONTO
    // SEA CERO: sumarla haria que un mes en el que el gimnasio regalo cuotas
    // apareciera como un mes de buena facturacion. Igualdad EXACTA: «1000.00»
    // esta dentro de «11000.00» y un `toContain` pasaria sobre el numero
    // equivocado.
    montarLaCaja();

    expect(importeDe('cobrado')).toBe('1000.00');
    expect(importeDe('cobrado'), 'sumo la cortesia a lo cobrado').not.toBe('1075.00');
    expect(importeDe('bonificado')).toBe('75.00');

    // Y se dice POR QUE van separados, que es lo que impide que el proximo
    // lector los junte creyendo que arregla algo.
    expect(notaDe('bonificado')).toContain('Las cortesias no son facturacion');

    // La cortesia tampoco esta en el desglose: el service la aparta antes de
    // agrupar, y verla ahi seria lo mismo sumado por otro camino.
    expect(metodosDelDesglose()).not.toContain('CORTESIA');
  });

  it('ninguna cuenta usa `texto`', () => {
    // EL FIJO LO HACE POSIBLE: el efectivo trae 50000 centavos y el texto
    // «999.99». El importe se PINTA del texto —es el campo que el contrato
    // trae para mostrar— y cualquier cuenta sale de los centavos. Si una suma
    // o un porcentaje saliera del texto, los dos numeros de abajo serian
    // otros. Es la unica forma de fijar que el float no esta: no existe un
    // campo con pesos y no puede aparecer uno calculado a mano.
    montarLaCaja();

    expect(importeDelMetodo('EFECTIVO')).toBe('999.99');

    // 50000 + 20000 + 30000 = 100000 centavos. Por los textos serian 1499.99.
    expect(totalDelDesglose()).toBe('1000.00');
    expect(totalDelDesglose(), 'sumo los `texto` en vez de los `centavos`').not.toBe('1499.99');

    // 50000 sobre 100000 es la mitad. Por los textos, 999.99 sobre 1499.99.
    expect(participacionDe('EFECTIVO')).toBe('50%');
    expect(participacionDe('EFECTIVO'), 'dividio los `texto`').not.toBe('66.67%');
  });

  it('el desglose por metodo suma lo mismo que el cobrado', () => {
    montarLaCaja();

    // La suma, A MANO y en centavos. Llamar a `sumaDeCentavos` —la misma
    // funcion con la que la pantalla pinta el total— seria autorreferencial:
    // un error dentro de ella moveria los dos lados a la vez.
    const aMano = 50_000 + 20_000 + 30_000;
    expect(aMano, 'el fijo ya no es un mes que la API pueda devolver').toBe(CAJA.cobrado.centavos);

    // Y los dos numeros que la pantalla enseña coinciden: el total de lo que
    // se esta desglosando y el cobrado de arriba. El dia que el desglose
    // pierda un metodo, estos dos dejan de ser iguales y se ve en la pantalla.
    expect(totalDelDesglose()).toBe('1000.00');
    expect(importeDe('cobrado')).toBe(totalDelDesglose());
  });

  it('el desglose lista los metodos que vinieron, y en el orden que vinieron', () => {
    // LISTA BLANCA: el conjunto ENTERO. El orden es el del servidor —alfabetico
    // y fijo, porque la respuesta se cachea— y aqui no se reordena.
    montarLaCaja();

    expect(metodosDelDesglose()).toEqual(['EFECTIVO', 'OTRO', 'TRANSFERENCIA']);
    expect(importeDelMetodo('OTRO')).toBe('200.00');
    expect(importeDelMetodo('TRANSFERENCIA')).toBe('300.00');
    expect(participacionDe('OTRO')).toBe('20%');
    expect(participacionDe('TRANSFERENCIA')).toBe('30%');
  });

  it('una participacion sin total no se pinta como 0%', () => {
    // El mismo criterio que el `denominador: 0` del operativo, aplicado al
    // dinero. ES UN MES POSIBLE: el patron del monto admite «0», asi que un
    // pago de cero en efectivo —una correccion— deja una fila con importe cero
    // y un cobrado de cero. Un «0%» ahi diria que por efectivo no entro nada,
    // cuando lo que pasa es que no entro nada por ninguno.
    montarLaCaja({
      caja: {
        ...CAJA,
        cobrado: { centavos: 0, texto: '0.00' },
        porMetodo: [{ metodo: 'EFECTIVO', importe: { centavos: 0, texto: '0.00' } }],
      },
    });

    expect(participacionDe('EFECTIVO')).toBe('Sin datos');
    expect(participacionDe('EFECTIVO'), 'se pinto como 0%').not.toBe('0%');
    expect(totalDelDesglose()).toBe('0.00');
  });

  it('un mes sin un solo pago lo dice, y no deja la tabla con la cabecera sola', () => {
    montarLaCaja({
      caja: {
        ...CAJA,
        cobrado: { centavos: 0, texto: '0.00' },
        porMetodo: [],
        bonificado: { centavos: 0, texto: '0.00' },
      },
    });

    expect(metodosDelDesglose()).toEqual([]);
    expect(screen.getByText('Este mes no entro nada por ningun metodo de pago.')).toBeVisible();
    expect(totalDelDesglose()).toBe('0.00');
  });

  it('un margen negativo se dice con palabras, no solo con el color', () => {
    // El margen puede quedar en rojo y el numero tiene que poder decirlo. Un
    // menos delante de un numero largo se pasa por alto, y quien no distingue
    // el rojo no tiene ninguna otra señal.
    montarLaCaja({ caja: CAJA_EN_ROJO });

    expect(importeDe('margen')).toBe('-123.45');
    expect(
      dentroDe('caja').querySelector('[data-cifra="margen"] [data-en-perdida]'),
    ).not.toBeNull();
  });

  it('y un margen positivo NO dice que el mes cerro en perdida', () => {
    // La otra mitad: con el cartel siempre puesto, el test de arriba pasaria
    // sobre una pantalla que llama perdida a todos los meses.
    montarLaCaja();

    expect(dentroDe('caja').querySelector('[data-cifra="margen"] [data-en-perdida]')).toBeNull();
  });

  it('el pendiente dice que es un estimado y de cuando', () => {
    // No es una deuda calculada —el sistema no lleva cuenta corriente— y esta
    // evaluado AL CERRAR ESE MES, no hoy. Las dos cosas cambian lo que
    // significa el numero.
    montarLaCaja();

    expect(importeDe('pendienteEstimado')).toBe('123.00');
    expect(notaDe('pendienteEstimado')).toContain('estimado evaluado al cerrar este mes');
    expect(notaDe('pendienteEstimado')).toContain('no una deuda calculada');
  });

  it('la caja dice el mes QUE VOLVIO', () => {
    // Hoy es marzo de 2026 y la respuesta es de enero: el encabezado se pinta
    // del mes de la RESPUESTA, igual que el del operativo.
    montarLaCaja();

    expect(
      within(dentroDe('caja')).getByRole('heading', { name: 'La caja de enero 2026' }),
    ).toBeInTheDocument();
  });

  it('un fallo al leer la caja no borra lo que ya se leyo bien', async () => {
    // La caja es el unico reporte que recorre la liquidacion de cada
    // profesora: es el que se rompe sin que se rompan los otros. Que falle no
    // puede llevarse por delante la ocupacion del mes, que esta en la pantalla
    // y se leyo bien.
    montarLaCaja({ errorDeCaja: new ErrorDeApi('El margen no se pudo calcular', 500) });
    await esperar();

    const laCaja = within(dentroDe('caja'));
    expect(laCaja.getByRole('alert').textContent).toContain('El margen no se pudo calcular');
    expect(laCaja.getByRole('button', { name: 'Reintentar la caja' })).toBeInTheDocument();

    // Y ningun numero de dinero se pinta: un fallo al leer no se parece a un
    // mes sin movimiento, que son ceros de verdad.
    expect(dentroDe('caja').querySelector('[data-cifra="margen"]')).toBeNull();
    expect(document.body.innerHTML).not.toContain('555.55');

    // Lo operativo y la composicion, intactos.
    expect(metricasDelMes()).toHaveLength(5);
    expect(filasPorPack()).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// La composicion de alumnos
// ---------------------------------------------------------------------------

describe('la composicion de alumnos', () => {
  it('un pack sin nombre (packId null) se distingue de uno llamado "Sin pack"', () => {
    // EL NOMBRE NO DISTINGUE NADA: el service llama «Sin pack» al grupo de los
    // que no tienen plan Y TAMBIEN al pack borrado, y nada le impide a un
    // gimnasio llamar «Sin pack» a un plan de verdad. Quien distingue es
    // `packId`. Juntarlos esconderia a los que no pagan nada dentro de un plan
    // que si se cobra.
    montar();

    const sinPlan = filaDelPack('');
    const unPackDeVerdad = filaDelPack('pack-trampa');

    expect(sinPlan.getAttribute('data-sin-pack')).toBe('si');
    expect(unPackDeVerdad.getAttribute('data-sin-pack')).toBeNull();

    // Y se distinguen MIRANDO, que es lo que importa: las dos filas dicen
    // «Sin pack» y solo una dice que esa gente no tiene plan contratado.
    expect(sinPlan.textContent).toContain('no tienen ningun plan contratado');
    expect(unPackDeVerdad.textContent).not.toContain('no tienen ningun plan contratado');
    expect(unPackDeVerdad.textContent).toContain('Sin pack');

    // Son TRES filas: ni se juntaron en una ni se descarto el grupo sin pack
    // —descartarlo haria que los porcentajes mintieran sobre el total—.
    expect(filasPorPack()).toHaveLength(3);
  });

  it('los porcentajes por pack salen del servidor, no se recalculan', () => {
    // Sobre 4 alumnos, 2 son el 50% y 1 es el 25%. El servidor manda 44, 33 y
    // 22, y son esos los que se pintan: el denominador lo conoce el servidor
    // —son los alumnos activos— y dos implementaciones del mismo numero acaban
    // discrepando. Igualdad exacta en los tres: con uno solo, dos divisiones
    // pasan.
    montar();

    expect(porcentajeDelPack('pack-trampa')).toBe('44%');
    expect(porcentajeDelPack('pack-trampa'), 'dividio alumnos entre el total').not.toBe('50%');
    expect(porcentajeDelPack('pack-libre')).toBe('33%');
    expect(porcentajeDelPack('')).toBe('22%');
    expect(porcentajeDelPack(''), 'dividio alumnos entre el total').not.toBe('25%');
  });

  it('el total de alumnos es el del servidor y no la cuenta de las filas', () => {
    montar();

    expect(dentroDe('composicion').querySelector('[data-total-alumnos]')?.textContent?.trim()).toBe(
      '4',
    );
  });

  it('un alumno que no tomo ni una clase se lista igual', () => {
    // Un cero es un dato: es el alumno que paga y no viene, que es justo a
    // quien hay que llamar. Filtrarlo lo haria invisible.
    montar();

    expect(alumnosDelConsumo()).toEqual(['p-ana', 'p-bruno', 'p-carla', 'p-dario']);
    expect(clasesDe('p-bruno')).toBe('0');
    expect(clasesDe('p-ana')).toBe('8');
  });

  it('se dice que el reparto por pack es la foto de hoy', () => {
    // La limitacion que el service declara: `Perfil.packId` es el actual y
    // punto, asi que la composicion de un mes pasado se dibuja con los planes
    // de hoy mientras las clases tomadas si son las de ese mes. Sin esta
    // frase, la tabla se lee como «asi estaban repartidos en enero», que es
    // falso y no hay forma de notarlo mirandola.
    montar();

    expect(dentroDe('composicion').textContent).toContain('El reparto por pack es la foto de hoy');
    expect(dentroDe('composicion').textContent).toContain(
      'el sistema no guarda historial de packs',
    );
  });

  it('la composicion dice el mes QUE VOLVIO', () => {
    montar();

    expect(
      within(dentroDe('composicion')).getByRole('heading', { name: 'Los alumnos de enero 2026' }),
    ).toBeInTheDocument();
  });
});
