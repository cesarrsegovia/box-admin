import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AsistenciaDeAlumno, ReporteAsistencia } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeStats } from '@/hooks/use-stats';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import PaginaDeAsistencia from './page';
// Los ayudantes viven FUERA de `page.tsx`: Next 15 no deja exportar nada mas
// que el `default` desde una pagina. Ver el comentario de `filtros.ts`.
import { rangoDeLaBusqueda } from './filtros';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const RUTA = '/mi-gym/admin/analisis/asistencia';

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
  usePathname: () => RUTA,
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
 * El rango por defecto de esta pantalla —el que se usa cuando la URL no dice
 * ninguno— sale de HOY. Sin congelarlo, este archivo cambiaria de significado
 * cada madrugada.
 *
 * Se falsea `Date` y NADA MAS (`toFake: ['Date']`): los temporizadores siguen
 * siendo de verdad, que es lo que necesitan `userEvent` y las esperas de
 * `esperar()`. Y `performance` se queda fuera por partida doble —ni esta en
 * esta lista ni en la de `vitest.config.ts`—, porque falsearlo sustituye el
 * objeto entero por el de sinon y deja ciego al sexto canal del espia.
 *
 * EL RANGO DE LA URL NO TOCA A «HOY» NI POR UN DIA, y es a proposito: el de la
 * URL va del 1 de enero de 2026 al 30 de junio de 2027 y hoy es el 20 de julio
 * de 2027. Con un rango de la URL que coincidiera con el de por defecto,
 * «pide lo que dice la URL» y «pide los ultimos treinta dias» serian la misma
 * afirmacion y la mitad de este archivo no podria fallar.
 */
const AHORA = new Date(Date.UTC(2027, 6, 20));

/** El rango que la mayoria de los tests pone en la URL. NO es el de hoy. */
const DESDE = '2026-01-01';
const HASTA_PEDIDO = '2027-06-30';
const CONSULTA_DEL_RANGO = `desde=${DESDE}&hasta=${HASTA_PEDIDO}`;

/**
 * EL `hasta` QUE DEVUELVE LA API, QUE NO ES EL QUE SE PIDIO.
 *
 * `MAX_DIAS_DE_RANGO` vale 366 en `stats.service.ts` y cuenta EL PRIMER DIA:
 * `tope = desde + 365 dias`. Desde el 1 de enero de 2026 —2026 no es
 * bisiesto— eso cae exactamente en el 1 de enero de 2027. Pedir hasta el 30 de
 * junio de 2027 son 546 dias, asi que la respuesta vuelve recortada ahi.
 *
 * ES UN RECORTE DE VERDAD Y NO UNO INVENTADO: el fijo tiene que ser POSIBLE en
 * todo lo que no sea el campo derivado. Un «pedi 24 meses y me devolvio 1»
 * seria una respuesta que la API no puede dar, y volveria decorativa cualquier
 * asercion hecha encima.
 *
 * Y es el recorte el caso POR DEFECTO de este archivo, no un caso aparte: con
 * el `hasta` pedido y el devuelto iguales, pintar uno u otro se ve igual, y
 * todos los tests que no hablan del recorte dejarian pasar la confusion.
 */
const HASTA_DEVUELTO = '2027-01-01';

/** Los ultimos treinta dias contando hoy, que es a donde se cae sin URL. */
const DEFECTO_DESDE = '2027-06-21';
const DEFECTO_HASTA = '2027-07-20';

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
 * LOS CUATRO ALUMNOS, Y CADA UNO ESTA POR UN MOTIVO.
 *
 * EL CAMPO DERIVADO VA DESALINEADO, que es lo que los hace servir. El
 * `porcentaje` de `AsistenciaDeAlumno` sale de `porcentajeDe(presentes,
 * presentes + ausentes)` en `stats.service.ts`. Con un fijo coherente —3 de 4
 * y un 75— ninguna afirmacion de esta pantalla podria decir QUIEN calculo ese
 * 75: sale igual si lo mando el servidor que si lo dividio el cliente. Con un
 * 99 encima de «3 de 4», si.
 *
 * Es la quinta forma de que un test exista y no pueda fallar: que el fijo
 * hable el idioma del codigo en vez del del contrato. Va por el lado de la
 * ENTRADA y vuelve decorativa cualquier asercion que se haga encima.
 *
 * PERO EL FIJO SIGUE SIENDO POSIBLE EN TODO LO DEMAS, que es la otra mitad de
 * la regla. Las relaciones que el service SI garantiza se respetan:
 *
 * - `porcentaje: null` VIENE SIEMPRE CON `presentes: 0` Y `ausentes: 0`, y al
 *   reves. `porcentajeDe` devuelve `null` exactamente cuando el denominador es
 *   cero, y el denominador es `presentes + ausentes`. Un `null` con cuatro
 *   presentes seria una respuesta que la API no puede dar. Este es el unico
 *   caso del archivo donde NO se puede desalinear nada, y no es una excepcion
 *   a la regla: el campo derivado sigue siendo el `porcentaje`, y lo que el
 *   contrato fija es que ahi valga `null`.
 * - EL CERO DE VERDAD TAMBIEN ES COHERENTE, Y POR LO MISMO: `0 / 5` es 0 se
 *   mire como se mire. Lo que ese alumno prueba no es quien divide sino que la
 *   pantalla NO esconde los ceros de verdad detras del «Sin datos».
 * - TODOS TIENEN AL MENOS UNA RESERVA VIVA en el rango, que es la condicion
 *   para aparecer: `calcularAsistencia` solo lista a quien entro en el `Map`.
 *   Por eso Bruno —cero presentes y cero ausentes— es posible: tuvo reservas
 *   vivas y a ninguna se le paso lista.
 * - Y VIENEN ORDENADOS POR NOMBRE, que es lo que hace `porNombre` en el
 *   service antes de devolver.
 */

/** 3 de 4 es 75%, no 99%. El 99 es el que manda la API y el que se pinta. */
const ANA: AsistenciaDeAlumno = {
  perfilId: 'p-ana',
  nombreCompleto: 'Ana Gutierrez',
  presentes: 3,
  ausentes: 1,
  porcentaje: 99,
};

/**
 * EL ALUMNO INVISIBLE: tuvo clases y a ninguna se le paso lista.
 *
 * Es el caso que da nombre a la pantalla. Una profesora que no pasa lista no
 * produce alumnos ausentes, produce alumnos invisibles, y `porcentaje: null`
 * es como el contrato lo dice.
 */
const BRUNO: AsistenciaDeAlumno = {
  perfilId: 'p-bruno',
  nombreCompleto: 'Bruno Ledesma',
  presentes: 0,
  ausentes: 0,
  porcentaje: null,
};

/** UN CERO DE VERDAD: se le paso lista cinco veces y no vino a ninguna. */
const CARLA: AsistenciaDeAlumno = {
  perfilId: 'p-carla',
  nombreCompleto: 'Carla Pinto',
  presentes: 0,
  ausentes: 5,
  porcentaje: 0,
};

/**
 * Y UN CIEN DE VERDAD QUE LA API NO LLAMA CIEN.
 *
 * 2 de 2 es 100% y aqui dice 88. Ademas de desalinear el derivado una segunda
 * vez, este alumno cierra la casualidad ortografica por el otro lado: un
 * `not.toContain('0%')` pasa en verde sobre un «100%», asi que en este archivo
 * no hay ni un «100%» pintado del que agarrarse — las afirmaciones son de
 * igualdad exacta sobre un atributo propio, y este fijo las obliga a serlo.
 */
const DARIO: AsistenciaDeAlumno = {
  perfilId: 'p-dario',
  nombreCompleto: 'Dario Sosa',
  presentes: 2,
  ausentes: 0,
  porcentaje: 88,
};

/** El reporte de siempre: el rango RECORTADO y los cuatro alumnos en orden. */
const REPORTE: ReporteAsistencia = {
  desde: DESDE,
  hasta: HASTA_DEVUELTO,
  alumnos: [ANA, BRUNO, CARLA, DARIO],
};

/** Los cuatro, en el orden en que los manda el service. La lista blanca. */
const LOS_CUATRO = ['p-ana', 'p-bruno', 'p-carla', 'p-dario'];

/**
 * LO QUE ESTA PANTALLA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON
 * EL DOM.
 *
 * Al reves que el operativo —diez numeros sueltos por mes—, este reporte lleva
 * NOMBRES DE PERSONAS y lo que cada una hizo o dejo de hacer. Es el dato mas
 * personal de los seis reportes: «Bruno falto a todo» dicho en un
 * `document.title` queda en la pestaña del navegador del mostrador, donde lo
 * lee cualquiera que pase por detras.
 *
 * Se registran los CUATRO nombres y no uno de muestra: un tapon solo mira lo
 * que se le nombra, y el canal por el que se escape el nombre que falto en
 * esta lista no dira nada.
 *
 * Y se registran las dos GRAFIAS de cada cosa, que es lo que mide de verdad:
 * la pintada —el texto que acabaria en un titulo o en `window.name`— y el
 * volcado del objeto, que es la forma que toma un `console.log(reporte)` o el
 * `detail` de un `performance.mark`.
 *
 * Los ids tambien: un `cuid` no se lee, pero identifica a una persona igual
 * que su nombre y es lo que viaja en el `perfilId` de la URL.
 */
vigilarEstosDatos({
  elNombreDeUnAlumno: ANA.nombreCompleto,
  elNombreDelInvisible: BRUNO.nombreCompleto,
  elNombreDeLaQueNoVino: CARLA.nombreCompleto,
  elNombreDelCuarto: DARIO.nombreCompleto,
  elIdDeUnAlumno: ANA.perfilId,
  elIdDelInvisible: BRUNO.perfilId,
  elVolcadoDeUnAlumno: '"nombreCompleto":"Ana Gutierrez"',
  elVolcadoDeSuAsistencia: '"presentes":3,"ausentes":1,"porcentaje":99',
  elVolcadoDelInvisible: '"presentes":0,"ausentes":0,"porcentaje":null',
  laAsistenciaPintada: '99%',
  laFraccionPintada: '3 de 4',
  laFraccionDeLaQueNoVino: '0 de 5',
});

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  reporte?: ReporteAsistencia;
  /** Lo que falla al LEER el reporte. */
  error?: unknown;
  /** El query de la URL, sin `?`. El rango y el alumno viven ahi. */
  consulta?: string;
}

function montar({
  reporte = REPORTE,
  error,
  consulta = CONSULTA_DEL_RANGO,
}: OpcionesDeMontaje = {}): QueryClient {
  busqueda.valor = consulta;

  /**
   * El rango de ESTE montaje, leido con la MISMA funcion que usa la pantalla.
   *
   * Sembrar la cache con un rango escrito a mano haria que una lectura
   * equivocada de la URL siguiera encontrando datos y pasara en verde.
   */
  const rangoDelMontaje = rangoDeLaBusqueda(new URLSearchParams(consulta), AHORA);

  /**
   * El doble responde POR RUTA y no por orden de llamada: con
   * `mockResolvedValueOnce` encadenados, agregar una peticion a la pantalla
   * corre todas las respuestas una posicion y los tests fallan en el sitio
   * equivocado.
   */
  pedirEspia.mockImplementation((ruta: string) => {
    if (!ruta.startsWith('/stats/asistencia')) {
      throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
    }

    return error === undefined ? Promise.resolve(reporte) : Promise.reject(error);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Sembrado para que el primer pintado ya tenga los datos: asi los tests que
  // miran el DOM no necesitan esperar. Sembrar NO apaga la peticion.
  if (error === undefined) {
    cliente.setQueryData(clavesDeStats.asistencia(rangoDelMontaje), reporte);
  }

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeAsistencia />
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
 * Las rutas pedidas, SIN DEDUPLICAR.
 *
 * Lo que esta lista blanca cuida es la CUENTA: una lectura de mas no cambia un
 * nodo ni manda un cuerpo, solo se ve contando, y un `Set` la esconderia. Esta
 * pantalla monta `useAsistencia` DOS veces —arriba, para la redireccion del
 * 401, y dentro del bloque—, y las dos con la misma clave: TanStack las junta
 * en una sola peticion, y si algun dia dejara de hacerlo se veria aqui.
 */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/** El bloque del reporte. Revienta si no esta. */
function elBloque(): HTMLElement {
  const nodo = document.querySelector('[data-bloque="asistencia"]');
  if (nodo === null) throw new Error('No hay bloque de asistencia');

  return nodo as HTMLElement;
}

/** La fila de un alumno, buscada por su ID y nunca por su nombre. */
function filaDe(perfilId: string): HTMLElement {
  const marca = elBloque().querySelector(`[data-alumno="${perfilId}"]`);
  const fila = marca?.closest('tr');
  if (!fila) throw new Error(`No hay ninguna fila del alumno «${perfilId}»`);

  return fila as HTMLElement;
}

/** Los alumnos pintados, por su id y EN ORDEN: para fijar el conjunto ENTERO. */
function alumnosDeLaTabla(): string[] {
  return [...elBloque().querySelectorAll('[data-alumno]')].map(
    (nodo) => nodo.getAttribute('data-alumno') ?? '',
  );
}

/** El texto de un nodo marcado dentro de la fila de un alumno, EXACTO. */
function deLaFila(perfilId: string, marca: string): string | null {
  const nodo = filaDe(perfilId).querySelector(`[${marca}]`);
  return nodo === null ? null : (nodo.textContent?.trim() ?? '');
}

/** El numero de asistencia de un alumno, EXACTO. Nada de subcadenas. */
function porcentajeDe(perfilId: string): string | null {
  return deLaFila(perfilId, 'data-porcentaje');
}

function fraccionDe(perfilId: string): string | null {
  return deLaFila(perfilId, 'data-fraccion');
}

/** El rango QUE SE MIRO, leido de sus atributos propios y no de la frase. */
function rangoMirado(): { desde: string | null; hasta: string | null } {
  const nodo = elBloque().querySelector('[data-rango-mirado]');
  if (nodo === null) throw new Error('No se dice que rango se miro');

  return { desde: nodo.getAttribute('data-desde'), hasta: nodo.getAttribute('data-hasta') };
}

/** Un texto del documento con los saltos de linea del JSX ya aplanados. */
function textoDe(nodo: Element | null): string {
  return (nodo?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Lo que el query de un destino lleva, para afirmar sobre el sin el prefijo. */
function queryDe(destino: string): string {
  return destino.slice(destino.indexOf('?') + 1);
}

async function escribirElRango(desde: string, hasta: string): Promise<void> {
  const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

  await usuario.clear(screen.getByLabelText('Desde'));
  await usuario.type(screen.getByLabelText('Desde'), desde);
  await usuario.clear(screen.getByLabelText('Hasta'));
  await usuario.type(screen.getByLabelText('Hasta'), hasta);
  await usuario.click(screen.getByRole('button', { name: 'Ver el rango' }));
}

// ---------------------------------------------------------------------------
// El rango y el alumno viven en la URL
// ---------------------------------------------------------------------------

describe('el rango vive en la URL', () => {
  it('el rango y el perfilId viajan en la URL', async () => {
    // LAS DOS DIRECCIONES, porque son dos cosas distintas y cada una se rompe
    // sola: lo que la URL dice tiene que llegar a la peticion, y lo que los
    // controles eligen tiene que volver a la URL. Con solo la primera, una
    // pantalla que guardara el rango en `useState` pasaria el test entero.
    montar({ consulta: `${CONSULTA_DEL_RANGO}&perfilId=${ANA.perfilId}` });

    // 1. De la URL a la peticion: los tres parametros, y en el orden en que
    //    los arma `queryDeAsistencia`.
    expect(rutasPedidas()).toEqual([
      `/stats/asistencia?desde=${DESDE}&hasta=${HASTA_PEDIDO}&perfilId=${ANA.perfilId}`,
    ]);

    // 2. De los controles a la URL: el rango nuevo, con el alumno conservado.
    await escribirElRango('2027-02-01', '2027-02-28');

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith(
      `${RUTA}?desde=2027-02-01&hasta=2027-02-28&perfilId=${ANA.perfilId}`,
    );
  });

  it('el perfilId se elige pinchando una fila, y la URL se lo lleva entero', () => {
    // Nadie se sabe un `cuid` de memoria: el filtro por alumno sale de la
    // tabla. El enlace lleva el MISMO rango y agrega el alumno; si se llevara
    // por delante el rango, se leeria la asistencia de ese alumno en otros
    // dias sin que nada lo dijera.
    montar();

    const enlace = filaDe(BRUNO.perfilId).querySelector('a');

    expect(enlace?.getAttribute('href')).toBe(
      `${RUTA}?desde=${DESDE}&hasta=${HASTA_PEDIDO}&perfilId=${BRUNO.perfilId}`,
    );
  });

  it('mirando a un alumno se puede volver a todos, y eso BORRA la clave', () => {
    // `?perfilId=` vacio no es «sin filtro»: seria pedir la asistencia de un
    // alumno cuyo id es la cadena vacia, y la respuesta —un reporte sin
    // alumnos— se lee como «este alumno no vino nunca». La clave se borra.
    montar({ consulta: `${CONSULTA_DEL_RANGO}&perfilId=${ANA.perfilId}` });

    const volver = elBloque().querySelector('[data-ver-a-todos]');

    expect(volver?.getAttribute('href')).toBe(`${RUTA}?desde=${DESDE}&hasta=${HASTA_PEDIDO}`);
  });

  it('sin rango en la URL se piden los ultimos treinta dias, y se dibujan', () => {
    // `desde` y `hasta` son OBLIGATORIOS en `ConsultaRangoDto`: entrar sin
    // nada tiene que elegir un rango igualmente. Y el elegido se dibuja en los
    // controles, para que nadie lea unos numeros sin saber de cuando son.
    montar({ consulta: '', reporte: { ...REPORTE, desde: DEFECTO_DESDE, hasta: DEFECTO_HASTA } });

    expect(rutasPedidas()).toEqual([
      `/stats/asistencia?desde=${DEFECTO_DESDE}&hasta=${DEFECTO_HASTA}`,
    ]);
    expect(screen.getByLabelText('Desde')).toHaveValue(DEFECTO_DESDE);
    expect(screen.getByLabelText('Hasta')).toHaveValue(DEFECTO_HASTA);
  });

  it('medio rango en la URL se completa con el otro extremo de hoy', () => {
    // Y aqui esta la diferencia con el mes de Analisis, donde las dos claves
    // van juntas o no van: `?anio=2026` suelto es media eleccion y la mitad
    // que falta no se adivina. Un `?desde=` suelto SI tiene lectura honesta.
    montar({ consulta: 'desde=2027-05-01', reporte: { ...REPORTE, desde: '2027-05-01' } });

    expect(rutasPedidas()).toEqual([`/stats/asistencia?desde=2027-05-01&hasta=${DEFECTO_HASTA}`]);
  });

  it('el rango de la URL vuelve a los controles', () => {
    // La otra mitad del primero: la pantalla puede pedir el rango correcto y
    // dejar los campos en otro, y entonces se leen los numeros de 2026 encima
    // de unas fechas de julio.
    montar();

    expect(screen.getByLabelText('Desde')).toHaveValue(DESDE);
    expect(screen.getByLabelText('Hasta')).toHaveValue(HASTA_PEDIDO);
  });

  it('una fecha rota viaja tal cual: el que decide es el DTO', () => {
    // Caerse al rango por defecto en silencio pintaria los numeros de otros
    // dias debajo de una barra de direcciones que dice el roto. El 400 de la
    // API («desde debe tener formato YYYY-MM-DD») explica que pasa; un
    // recorte callado, no.
    montar({ consulta: 'desde=ayer&hasta=2027-06-30', error: new ErrorDeApi('x', 400) });

    expect(rutasPedidas()).toEqual([`/stats/asistencia?desde=ayer&hasta=${HASTA_PEDIDO}`]);
  });

  it('no pide nada mas que la asistencia, y una sola vez', () => {
    // `useAsistencia` se monta DOS veces con la misma clave. Una lectura de
    // mas no cambia un nodo: solo se ve contando.
    montar();

    expect(rutasPedidas()).toEqual([`/stats/asistencia?desde=${DESDE}&hasta=${HASTA_PEDIDO}`]);
  });
});

// ---------------------------------------------------------------------------
// Sobre QUE se calcula
// ---------------------------------------------------------------------------

describe('lo que esta pantalla tiene que decir', () => {
  it('dice sobre QUE se calcula la asistencia', () => {
    // La definicion peligrosa del reporte entero, verificada en
    // `StatsService.calcularAsistencia`: el denominador son las reservas con
    // `asistio !== null`, o sea las de los turnos DONDE SE PASO LISTA. Un
    // «94%» sin decir sobre que invita a tomar una decision sobre alguien con
    // un numero que a lo mejor cubre tres clases de las doce que tomo.
    //
    // Igualdad exacta sobre el texto entero y no un `toContain('lista')`: con
    // una subcadena, borrar la mitad de la frase —justo la mitad que explica
    // que esas clases NO ENTRAN— seguiria pasando.
    montar();

    expect(textoDe(document.querySelector('[data-sobre-que]'))).toBe(
      'La asistencia se calcula sobre las reservas de turnos donde SE PASO LISTA, no sobre ' +
        'todas las reservas. Una clase sin lista pasada no produce ausentes: produce alumnos ' +
        'invisibles, porque esa clase no entra en la cuenta.',
    );
  });

  it('lo dice tambien cuando el reporte no llego', async () => {
    // La frase que explica un numero no puede depender de que el numero haya
    // llegado: va fuera de la frontera de Suspense y fuera del bloque.
    montar({ error: new ErrorDeApi('Se cayo', 500) });
    await esperar();

    expect(document.querySelector('[data-sobre-que]')).not.toBeNull();
  });

  it('cada alumno lleva su fraccion al lado del numero', () => {
    // Es la otra mitad de no mentir: «50%» son dos de cuatro o cien de
    // doscientas, y no son lo mismo para decidir nada.
    montar();

    expect(fraccionDe(ANA.perfilId)).toBe('3 de 4');
    expect(fraccionDe(CARLA.perfilId)).toBe('0 de 5');
    // Tambien el «0 de 0», que es el caso donde mas falta hace: sin la
    // fraccion, «Sin datos» no dice cuantas clases quedaron sin mirar.
    expect(fraccionDe(BRUNO.perfilId)).toBe('0 de 0');
  });

  it('la pantalla NO recalcula el porcentaje: pinta el que vino', () => {
    // 3 de 4 son 75 y la API dice 99. Quien calcula es `porcentajeDe` en
    // `stats.service.ts`: dos implementaciones del mismo numero son la forma
    // conocida de que la tabla y el total acaben discrepando sin que nadie
    // sepa cual creer.
    montar();

    expect(porcentajeDe(ANA.perfilId)).toBe('99%');
    // Y 2 de 2 son 100, y la API dice 88.
    expect(porcentajeDe(DARIO.perfilId)).toBe('88%');
  });

  it('la tabla lista a TODOS los que vinieron en el reporte, en su orden', () => {
    // Lista blanca: el conjunto ENTERO y ordenado. Un alumno de mas —o uno
    // que se cayera por un filtro inventado aqui— rompe esto; un test de
    // presencia no lo veria.
    montar();

    expect(alumnosDeLaTabla()).toEqual(LOS_CUATRO);
  });
});

// ---------------------------------------------------------------------------
// Las dos mitades del cero
// ---------------------------------------------------------------------------

describe('un cero y un «no se sabe» no se ven igual', () => {
  it('un alumno SIN lista pasada no se pinta como 0% de asistencia', () => {
    // Una profesora que no pasa lista no produce alumnos ausentes: produce
    // alumnos INVISIBLES. Con un `porcentaje ?? 0`, el admin llama a Bruno
    // para preguntarle por que falto a todo.
    //
    // IGUALDAD EXACTA sobre un atributo propio y no un `not.toContain('0%')`:
    // esa forma pasa en verde sobre un «100%» y sobre «10%».
    montar();

    expect(porcentajeDe(BRUNO.perfilId)).toBe('Sin datos');
    expect(deLaFila(BRUNO.perfilId, 'data-sin-lista')).toBe(
      'No se le paso lista ni una vez en este rango: no es un 0%, es que no se sabe.',
    );
  });

  it('un 0% de verdad SI se pinta como 0%', () => {
    // La otra mitad. Sin este, «nunca pinta 0%» tambien pasaria.
    montar();

    expect(porcentajeDe(CARLA.perfilId)).toBe('0%');
    // Y a esa fila no se le cuelga el aviso del invisible, que diria que de
    // Carla «no se sabe» cuando se sabe perfectamente: no vino a ninguna.
    expect(deLaFila(CARLA.perfilId, 'data-sin-lista')).toBeNull();
  });

  it('el aviso de «sin lista» va SOLO en la fila que lo necesita', () => {
    // Repartido a todas las filas se vuelve invisible a las dos semanas, y de
    // paso le pone una duda encima al 0% de Carla, que no la tiene.
    montar();

    const avisos = [...elBloque().querySelectorAll('[data-sin-lista]')].map((nodo) =>
      nodo.closest('tr')?.querySelector('[data-alumno]')?.getAttribute('data-alumno'),
    );

    expect(avisos).toEqual([BRUNO.perfilId]);
  });
});

// ---------------------------------------------------------------------------
// El rango que VOLVIO
// ---------------------------------------------------------------------------

describe('el rango que se miro no es el que se pidio', () => {
  it('muestra el `hasta` QUE VOLVIO, no el que se pidio', () => {
    // Vuelve recortado: `MAX_DIAS_DE_RANGO` son 366 dias contando el primero,
    // asi que desde el 1 de enero de 2026 el tope es el 1 de enero de 2027.
    // Pintar el pedido seria afirmar que se miro medio 2027 que no se miro, y
    // entonces un alumno que no aparece se lee como «no vino en año y medio».
    montar();

    expect(rangoMirado()).toEqual({ desde: DESDE, hasta: HASTA_DEVUELTO });
    // Y explicitamente: el pedido no esta en ese atributo. Son dos valores
    // distintos a proposito en todo este archivo.
    expect(rangoMirado().hasta).not.toBe(HASTA_PEDIDO);
  });

  it('y lo explica, en vez de recortar en silencio', () => {
    montar();

    expect(textoDe(elBloque().querySelector('[data-recorte]'))).toBe(
      `Pediste hasta ${HASTA_PEDIDO} y se miro hasta ${HASTA_DEVUELTO}: el rango maximo es de ` +
        '366 dias contando el primero. Lo que no aparece aqui no es «no vino»: es que no se miro.',
    );
  });

  it('un rango que NO se recorto no avisa de ningun recorte', () => {
    // La otra mitad: con el aviso siempre puesto, «avisa del recorte» pasaria
    // sin que la pantalla comparara nada.
    montar({
      consulta: `desde=${DESDE}&hasta=${HASTA_DEVUELTO}`,
      reporte: { ...REPORTE, hasta: HASTA_DEVUELTO },
    });

    expect(elBloque().querySelector('[data-recorte]')).toBeNull();
    expect(rangoMirado()).toEqual({ desde: DESDE, hasta: HASTA_DEVUELTO });
  });
});

// ---------------------------------------------------------------------------
// Lo que dice la API cuando no se puede contestar
// ---------------------------------------------------------------------------

describe('lo que dice la API cuando no se puede leer', () => {
  /**
   * EL MENSAJE DEL RANGO INVERTIDO DE `/stats/asistencia`, PALABRA POR PALABRA.
   *
   * ⚠️ NO ES el de los otros cinco modulos. `ausencias`, `vacaciones`,
   * `rutinas`, `horarios-profesor` y `mi-calendario` contestan «hasta no puede
   * ser anterior a desde»; `stats.service.ts:763` contesta esta otra frase.
   * Comprobado leyendo el `throw`, no deducido del parecido.
   *
   * Por eso se afirma la igualdad exacta y no un `/anterior/i`: una asercion
   * laxa aqui taparia justamente la unica diferencia que hay.
   */
  const RANGO_INVERTIDO = 'El rango esta invertido: hasta es anterior a desde.';

  it('hasta anterior a desde muestra el motivo de la API', async () => {
    montar({
      consulta: `desde=${HASTA_PEDIDO}&hasta=${DESDE}`,
      error: new ErrorDeApi(RANGO_INVERTIDO, 400),
    });
    await esperar();

    expect(textoDe(elBloque().querySelector('[data-fallo-al-leer] [role="alert"]'))).toBe(
      `No se pudo leer la asistencia: ${RANGO_INVERTIDO}`,
    );

    // Y NI UNA FILA: un 400 dibujado como una tabla vacia diria que nadie se
    // anoto a nada en ese rango, que es una respuesta a una pregunta que la
    // API no contesto.
    expect(alumnosDeLaTabla()).toEqual([]);
  });

  it('un rango sin alumnos se distingue de un fallo al leer', async () => {
    // Las dos mitades en un solo test, porque lo que se mide es la DIFERENCIA
    // y no cada cartel por su lado: con los dos iguales, un 500 se leeria como
    // «nadie se anoto a nada».
    montar({ reporte: { ...REPORTE, alumnos: [] } });
    await esperar();

    expect(textoDe(elBloque().querySelector('[data-sin-alumnos]'))).toBe(
      'Nadie tuvo una reserva viva en este rango. La pregunta se contesto y la respuesta esta ' +
        'vacia: no es un fallo al leer.',
    );
    expect(elBloque().querySelector('[data-fallo-al-leer]')).toBeNull();
    // Y el rango mirado sigue ahi: la respuesta vacia TAMBIEN dice de cuando
    // es, y sin eso «no vino nadie» no se puede juzgar.
    expect(rangoMirado()).toEqual({ desde: DESDE, hasta: HASTA_DEVUELTO });

    // Y la vuelta: el fallo no se pinta como un rango vacio.
    document.body.innerHTML = '';
    montar({ error: new ErrorDeApi('Se cayo la base', 500) });
    await esperar();

    expect(elBloque().querySelector('[data-sin-alumnos]')).toBeNull();
    expect(textoDe(elBloque().querySelector('[data-fallo-al-leer] [role="alert"]'))).toBe(
      'No se pudo leer la asistencia: Se cayo la base',
    );
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('una sesion caducada manda al login CONSERVANDO el rango', async () => {
    // El rango es el estado de esta pantalla. Volver del login a los ultimos
    // treinta dias es perder el rango que la persona acababa de elegir, y
    // encima parece que funciona.
    montar({ consulta: `${CONSULTA_DEL_RANGO}&perfilId=${ANA.perfilId}` });
    // El montaje siembra la cache; este test necesita el fallo, asi que se
    // monta de nuevo con el 401 y sin semilla.
    document.body.innerHTML = '';
    vi.clearAllMocks();
    montar({
      consulta: `${CONSULTA_DEL_RANGO}&perfilId=${ANA.perfilId}`,
      error: new ErrorDeApi('Unauthorized', 401),
    });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
    const [destino] = empujar.mock.calls[0] as [string];

    const esperado = `${RUTA}?${CONSULTA_DEL_RANGO}&perfilId=${ANA.perfilId}`;
    expect(destino).toBe(`/mi-gym/login?volverA=${encodeURIComponent(esperado)}`);

    // Y el destino sobrevive entero a la lista blanca que lo valida: un
    // `volverA` que esa funcion descarte manda a la persona a la portada del
    // gimnasio sin decir nada.
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA') ?? undefined;
    expect(rutaDeRetornoSegura(volverA, 'mi-gym')).toBe(esperado);

    // Y no se enseña el «Unauthorized» crudo de la API, que no le dice nada a
    // nadie, ni se ofrece reintentar mientras la pantalla ya se esta yendo.
    expect(elBloque().querySelector('[data-fallo-al-leer]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.getByText('Tu sesion caduco. Te llevamos al login.')).toBeInTheDocument();
  });

  it('el query que se conserva al caducar es el de la URL, entero', async () => {
    // Un `volverA` armado desde el rango YA LEIDO perderia lo que la pantalla
    // no entienda, y el enlace compartido volveria del login distinto.
    montar({ consulta: `${CONSULTA_DEL_RANGO}&algo=puesto`, error: new ErrorDeApi('x', 401) });
    await esperar();

    const [destino] = empujar.mock.calls[0] as [string];
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA') ?? '';

    expect(queryDe(volverA)).toBe(`${CONSULTA_DEL_RANGO}&algo=puesto`);
  });
});
