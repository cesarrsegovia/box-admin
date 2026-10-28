import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PackPublico, RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { usePacks } from '@/hooks/use-catalogos';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDePacks from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

/**
 * LO QUE ESTE ARCHIVO SIEMBRA Y NO PUEDE SALIRSE POR LOS CANALES QUE NO SON EL
 * `<body>`.
 *
 * El tapon vive en `vitest.setup.ts`, vigila SIEMPRE los secretos del panel y
 * esto le agrega lo propio de esta pantalla, para todos sus tests. Los
 * diecisiete canales, los dos ejes y el alfabeto corren despues de cada uno sin
 * que haya que pedirlo.
 *
 * LOS DOS PRECIOS TERMINAN EN DECIMALES QUE UN FLOAT NO REPRESENTA, y son la
 * pieza mas util de la lista: `25000.10` y `9900.25` son ademas de centinelas
 * la sonda que delata a quien los convierta por el camino —`Number('25000.10')`
 * es `25000.1`, que ya no es el mismo texto ni el mismo centinela—. Mismo valor
 * que usaron la T1 en `use-dinero.spec`, la T2 en `bloque-pagos.spec` y la T3
 * en la cola de comprobantes.
 *
 * LOS TRES NOMBRES DE PACK son el otro dato de negocio que esta pantalla tiene
 * en la mano: son lo que el gimnasio vende y lo que aparece en la factura de
 * cada alumno. Que se pinten a proposito —es con lo que el admin decide cual
 * esta editando— es justamente lo que hace util vigilarlos por los otros
 * canales: el decimoquinto los RESTA de lo que hay en el marcado, asi que lo
 * que caza es solo el que este ESCONDIDO.
 *
 * LOS TRES EMPIEZAN POR LETRAS DISTINTAS Y EN ORDEN —A, B, C— porque el orden
 * del fijo tiene que ser POSIBLE: `PacksService.listar` cierra con
 * `orderBy: { nombre: 'asc' }`, asi que una lista desordenada seria una
 * respuesta que la API no puede dar y un test sobre ella no probaria nada.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  nombreDelMensual: 'Abono Centinela Bronce',
  nombreDelTotal: 'Bono Centinela Diamante',
  nombreDelDeBaja: 'Cupon Centinela Esmeralda',
  elPrecioDelMensual: '25000.10',
  elPrecioDelTotal: '9900.25',
};

vigilarEstosDatos(CENTINELAS);

/**
 * DOS FUGAS MEDIDAS QUE LOS DIECISIETE CANALES DE ENTONCES NO VEIAN. Se
 * reportaron aqui y SE CERRARON DESPUES, en esta misma fase, en
 * `espia-de-consola.ts`: la primera con la forma localizada del alfabeto
 * (`agujasLocalizadas`) —con la linea de abajo puesta, hoy caen 25 de los 28
 * de este archivo— y la segunda como la segunda mitad del duodecimo canal
 * (`loColgadoDelHtml`). Se deja el registro de lo que se midio.
 *
 * ⚠️ 1. EL ALFABETO NO CONOCE EL FORMATO DE MILES, Y ESTA ES LA FASE DEL
 * DINERO. En el cuerpo de la pantalla:
 *
 *     console.info('[packs] lista de precios', packs.data.map((p) =>
 *       p.precio === null ? 'a consultar' : Number(p.precio).toLocaleString('es-AR')));
 *
 * `25000.10` sale como `25.000,1` y `9900.25` como `9.900,25`: el punto se
 * vuelve coma, aparecen los separadores de miles y el centinela deja de estar
 * ahi EN CUALQUIERA de las formas que el alfabeto busca —claro, base64,
 * %-codificado, y las tres cajas de letras—. MEDIDO: pasa los 1841 tests del
 * paquete. Y el control, la MISMA linea con `p.precio` tal cual, tira 25 de
 * los 28 de este archivo, asi que el canal esta despierto y lo unico que
 * cambia entre caer y no caer es la llamada a `toLocaleString`.
 *
 * Lo que la hace grave es que no es una rebuscadura: formatear un importe para
 * leerlo es LA cosa que se hace con el dinero, y este repo ya tiene un
 * `porcentaje.tsx` en Analisis. La familia es la misma que la del
 * `.toLowerCase()` que derrotaba los diecisiete a la vez, y la aguja que
 * faltaria es la forma localizada del valor.
 *
 * ⚠️ 2. UN NODO COLGADO DEL `<html>`, QUE NO ESTA NI EN EL `<head>` NI EN EL
 * `<body>`:
 *
 *     const marca = document.createElement('div');
 *     marca.textContent = JSON.stringify(packs.data);
 *     document.documentElement.append(marca);
 *
 * MEDIDO con el catalogo entero —los tres nombres y los dos precios en
 * claro—: pasa los 1841. Cae en el HUECO ENTRE TRES defensas: el tapon del
 * `<head>` mira los hijos del `<head>`, el de los atributos mira los
 * ATRIBUTOS del `<html>` y del `<body>` pero no sus hijos, y los tests de
 * pantalla miran lo que hay DENTRO del `<body>`. `cleanup()` tampoco lo
 * quita, asi que sobrevive a su propio test. No es la fuga de «los atributos
 * de los descendientes del `<body>`» que ya estaba reportada: aqui el nodo
 * esta FUERA del cuerpo, asi que ni siquiera hace falta esconderlo en un
 * atributo — su texto tampoco lo ve nadie.
 */

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'mi-gym' }),
  usePathname: () => '/mi-gym/admin/configuracion/packs',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-dinero.spec`, y que las tres
 * escrituras invaliden `['packs']` tambien. Lo que se audita aqui es un escalon
 * mas arriba: QUE pide esta pantalla, CON QUE CLAVE, QUE cuerpo manda y que
 * hace con lo que vuelve. `ErrorDeApi` se deja REAL porque `mensajeDeFallo`
 * ramifica con `instanceof` y el mensaje sale de la instancia.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
  // Los almacenes del navegador los deja como estaban —y ademas los AUDITA— el
  // tapon global de `vitest.setup.ts`. Limpiarlos aqui, en un `afterEach` del
  // spec que corre ANTES que el suyo, lo dejaria mirando unos almacenes vacios.
});

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * TRES PACKS, Y EL FIJO ES POSIBLE EN TODO. VERIFICADO EN `PacksService` CAMPO
 * POR CAMPO Y NO DEDUCIDO DEL CONTRATO.
 *
 * Son TRES y no uno por regla: con una sola fila, «edita el de ESA fila» y
 * «edita el primero de la lista» son la MISMA afirmacion y el test no puede
 * fallar. Y TODO lo que los distingue esta sembrado DISTINTO —id, nombre,
 * tipo, contador, precio, cancelaciones, estado—: en la Fase 13 una mutacion
 * no cayo porque el fijo tenia dos numeros iguales.
 *
 * LO QUE EL SERVICE GARANTIZA Y AQUI SE RESPETA:
 *
 * - LOS DOS CONTADORES NUNCA ESTAN PUESTOS A LA VEZ. `validarCoherencia` tira
 *   un 400 si llega `clasesTotales` con `tipo: 'MENSUAL'` o al reves, y
 *   `actualizar` ANULA explicitamente el del tipo viejo al cambiar de tipo
 *   («si no, la fila quedaria con los dos contadores puestos»). Un MENSUAL con
 *   `clasesTotales` no nulo no existe en la base.
 * - PERO LOS DOS PUEDEN SER NULOS. Los dos son `@IsOptional()` en
 *   `CrearPackDto` y `crear` escribe `clasesPorMes: dto.clasesPorMes ?? null`:
 *   un pack sin tope es una fila valida, y `topeDelPack` lo lee como «sin
 *   tope» y no como un dato que falte. Por eso `EL_DE_BAJA` tiene los dos en
 *   nulo y no es un fijo imposible.
 * - `precio` NULO ES «A CONSULTAR», no un fallo: `PackPublico.precio` es
 *   `string | null` y `aPackPublico` lo deja nulo cuando la columna lo esta.
 * - `cancelacionesPermitidas` ADMITE CERO (`@Min(0)`), que NO es lo mismo que
 *   nulo: por eso el fijo tiene uno de cada.
 * - EL LISTADO LLEGA ORDENADO POR NOMBRE ASCENDENTE y esta pantalla no
 *   reordena, asi que el fijo va en ese orden.
 * - Y LOS TRES LLEGAN JUNTOS AUNQUE UNO ESTE DE BAJA: la rama de personal de
 *   `listar` no pone `where.activo` si el filtro no lo trae. A un alumno le
 *   llegarian solo los dos activos, pero esta pantalla no se dibuja para un
 *   alumno.
 */
const EL_MENSUAL: PackPublico = {
  id: 'pk-del-abono',
  tenantId: CENTINELAS.tenantIdDelGimnasio,
  nombre: CENTINELAS.nombreDelMensual,
  salaId: null,
  tipo: 'MENSUAL',
  precio: CENTINELAS.elPrecioDelMensual,
  clasesPorMes: 8,
  clasesTotales: null,
  cancelacionesPermitidas: 2,
  activo: true,
};

const EL_TOTAL: PackPublico = {
  id: 'pk-del-bono',
  tenantId: CENTINELAS.tenantIdDelGimnasio,
  nombre: CENTINELAS.nombreDelTotal,
  salaId: 'sala-del-bono',
  tipo: 'TOTAL',
  precio: CENTINELAS.elPrecioDelTotal,
  clasesPorMes: null,
  clasesTotales: 24,
  cancelacionesPermitidas: 0,
  activo: true,
};

const EL_DE_BAJA: PackPublico = {
  id: 'pk-del-cupon',
  tenantId: CENTINELAS.tenantIdDelGimnasio,
  nombre: CENTINELAS.nombreDelDeBaja,
  salaId: null,
  tipo: 'MENSUAL',
  precio: null,
  clasesPorMes: null,
  clasesTotales: null,
  cancelacionesPermitidas: null,
  activo: false,
};

const EL_CATALOGO = [EL_MENSUAL, EL_TOTAL, EL_DE_BAJA];

/** Lo que dice la API cuando no se puede leer el catalogo. Palabra por palabra. */
const MENSAJE_DE_LA_API = 'La base de datos no contesta';

// ---------------------------------------------------------------------------
// El montaje
// ---------------------------------------------------------------------------

interface Peticion {
  ruta: string;
  metodo: string;
  cuerpo: unknown;
}

interface OpcionesDeMontaje {
  /** `null` se monta SIN proveedor: ver el comentario de `montar`. */
  rol?: RolUsuario | null;
  /** Lo que contesta `GET /packs`. */
  catalogo?: PackPublico[];
  /** Si se pasa, el `GET /packs` falla con esto en vez de contestar. */
  falloAlLeer?: ErrorDeApi;
  /** Lo que contesta cualquiera de las tres escrituras. */
  respuesta?: PackPublico;
  /** Si se pasa, la escritura falla con esto. */
  falloAlEscribir?: ErrorDeApi;
  /** Monta ademas una sonda que llama `usePacks()` de verdad. */
  conSonda?: boolean;
}

/**
 * LA SONDA: `usePacks()` DE VERDAD, el mismo hook que consumen la ficha del
 * alumno, el alta y el formulario de invitaciones.
 *
 * Es lo que le da dientes a «el listado usa la MISMA clave que el catalogo».
 * Un espia de `invalidateQueries` seria AUTORREFERENCIAL: compararia la clave
 * invalidada contra la misma que el hook usa, y seguiria verde con las dos
 * movidas a la vez. Esto no compara claves: monta el otro consumidor y mira si
 * la peticion VUELVE A SALIR.
 *
 * Pinta el numero de packs que vio para que la sonda no pueda quedar en verde
 * sin haberse suscrito a nada.
 */
function Sonda() {
  const packs = usePacks();
  return <span data-sonda>{packs.data === undefined ? 'nada' : String(packs.data.length)}</span>;
}

function montar({
  rol = 'ADMIN_SALON',
  catalogo = EL_CATALOGO,
  falloAlLeer,
  respuesta = EL_MENSUAL,
  falloAlEscribir,
  conSonda = false,
}: OpcionesDeMontaje = {}) {
  pedirEspia.mockImplementation(
    (ruta: string, opciones?: { metodo?: string; cuerpo?: unknown }) => {
      // El catalogo: `GET /packs` PELADO, sin query y sin opciones. Si la
      // pantalla le pegara un `?activo=false`, caeria por el `throw` de abajo en
      // vez de resolver en vacio, que es como tiene que verse.
      if (ruta === '/packs' && opciones === undefined) {
        return falloAlLeer === undefined ? Promise.resolve(catalogo) : Promise.reject(falloAlLeer);
      }

      const esAlta = ruta === '/packs' && opciones?.metodo === 'POST';
      const esDeUnPack = /^\/packs\/[^/?]+$/.test(ruta);

      if (esAlta || esDeUnPack) {
        return falloAlEscribir === undefined
          ? Promise.resolve(respuesta)
          : Promise.reject(falloAlEscribir);
      }

      throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
    },
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const pantalla = (
    <>
      <PaginaDePacks />
      {conSonda && <Sonda />}
    </>
  );

  render(
    <QueryClientProvider client={cliente}>
      {/* Sin rol se monta SIN proveedor: envolverla con un `rol={null}` no
          compila y, peor, probaria otra cosa —un contexto puesto en nulo— y no
          el caso que importa, que es la pantalla fuera del armazon del panel. */}
      {rol === null ? pantalla : <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol>}
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas y las mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}): Promise<void> {
  montar(opciones);
  await esperar();
}

/** Todo lo que paso por `pedir`, con el metodo resuelto como lo ve la API. */
function peticiones(): Peticion[] {
  return pedirEspia.mock.calls.map((llamada) => {
    const ruta = String(llamada[0]);
    const opciones = llamada[1] as { metodo?: string; cuerpo?: unknown } | undefined;

    return { ruta, metodo: opciones?.metodo ?? 'GET', cuerpo: opciones?.cuerpo };
  });
}

/** Las escrituras, que son las que llevan cuerpo. */
function escrituras(): Peticion[] {
  return peticiones().filter((peticion) => peticion.metodo !== 'GET');
}

/** La unica escritura que hubo. Si hubo cero o dos, se ve como tal. */
function laEscritura(): Peticion {
  const todas = escrituras();
  if (todas.length !== 1) {
    throw new Error(`Se esperaba UNA escritura y hubo ${todas.length}: ${JSON.stringify(todas)}`);
  }
  // `noUncheckedIndexedAccess`: el largo ya esta comprobado, pero el tipo no lo
  // sabe. Un `!` seria la misma afirmacion sin el mensaje de arriba.
  const unica = todas[0];
  if (unica === undefined) throw new Error('Inalcanzable');
  return unica;
}

/** El texto del nodo marcado con ese selector, o `null` si no esta. */
function textoDe(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

/** Los encabezados de la tabla, en orden y del marcado crudo. */
function encabezados(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent ?? '');
}

/** Las celdas de una fila, en orden. */
function celdasDeLaFila(indice: number): string[] {
  const filas = [...document.querySelectorAll('tbody tr')];
  const fila = filas[indice];
  if (fila === undefined) throw new Error(`No hay fila ${indice}: hay ${filas.length}`);

  return [...fila.querySelectorAll('td')].map((td) => td.textContent ?? '');
}

/** Los botones del marcado CRUDO, no los del arbol de accesibilidad. */
function botonesDelDocumento(): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')];
}

/** Los formularios que hay en pantalla, por su nombre accesible. */
function formulariosDelDocumento(): (string | null)[] {
  return [...document.querySelectorAll('form')].map((form) => form.getAttribute('aria-label'));
}

function elAlta(): HTMLElement {
  return screen.getByRole('form', { name: 'Crear un pack' });
}

function laEdicion(): HTMLElement {
  return screen.getByRole('form', { name: 'Editar el pack' });
}

/** Abre el panel de edicion del pack que lleva ese nombre. */
async function editar(nombre: string): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

/** Escribe un valor en un campo de un formulario, borrando lo que hubiera. */
async function escribir(formulario: HTMLElement, etiqueta: string, texto: string): Promise<void> {
  const usuario = userEvent.setup();
  const campo = within(formulario).getByLabelText(etiqueta);

  await usuario.clear(campo);
  if (texto !== '') await usuario.type(campo, texto);
}

async function pulsar(formulario: HTMLElement, nombre: string): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(within(formulario).getByRole('button', { name: nombre }));
  await esperar();
}

// ---------------------------------------------------------------------------
// La puerta de rol
// ---------------------------------------------------------------------------

describe('la puerta de rol', () => {
  /**
   * LA PUERTA SE REPITE EN ESTA PANTALLA Y NO SE HEREDA DEL INDICE.
   *
   * Comprobado en el arbol antes de escribirla: NO HAY `layout.tsx` en
   * `configuracion/`. El indice es una pagina hermana, no un envoltorio, asi
   * que entrar directo a `/mi-gym/admin/configuracion/packs` no monta el
   * indice ni su puerta. Las tres pantallas de la Fase 12 —`web`, `email` y
   * `checkin`— tienen las cinco lineas de la puerta cada una por esto mismo, y
   * esta las tiene tambien.
   *
   * SON DOS MITADES Y HACEN FALTA LAS DOS: no se dibuja, Y NO PIDE. Una
   * pantalla que no se ve pero pide igual filtra lo mismo que una dibujada: la
   * respuesta viaja al navegador y queda en la cache de TanStack, legible desde
   * las herramientas del navegador de la maquina del mostrador.
   *
   * Y aqui la mitad de «no pide» SI puede fallar, al reves que en el indice:
   * esta pantalla tiene una consulta de verdad.
   */
  it('un ADMIN_OPERATIVO no tiene la pantalla en el marcado, y no se le pide nada', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    // Se pulsa PRIMERO y se afirma despues, en este orden a proposito: con la
    // afirmacion sobre el marcado delante, el test abortaria ahi y la mitad de
    // «no pide» no llegaria a ejercitarse nunca. `fireEvent` dispara sobre lo
    // oculto igual, asi que una puerta hecha con CSS no pasaria por aqui.
    for (const boton of botonesDelDocumento()) fireEvent.click(boton);
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(botonesDelDocumento()).toEqual([]);
    expect(peticiones()).toEqual([]);
  });

  /**
   * FALLA CERRADA. Sin proveedor no hay rol, y «no hay rol» vale «no alcanza
   * para nada»: si un reordenamiento del layout dejara esta pantalla fuera del
   * armazon del panel, lo que no puede pasar es que eso abra el editor de los
   * precios del gimnasio.
   */
  it('sin proveedor de rol tampoco se dibuja ni pide', async () => {
    montar({ rol: null });
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(peticiones()).toEqual([]);
  });

  /**
   * `rolAlcanza` ES UNA JERARQUIA, no una lista de roles exactos. Sin este
   * test, un `rol === 'ADMIN_SALON'` dejaria al superadmin fuera de su propio
   * sistema y a nadie mas.
   */
  it('un SUPERADMIN entra, porque la puerta es una jerarquia', async () => {
    await montarYEsperar({ rol: 'SUPERADMIN' });

    expect(encabezados()).toEqual(['Pack', 'Tipo', 'Clases', 'Precio', 'Estado']);
  });
});

// ---------------------------------------------------------------------------
// La clave del catalogo
// ---------------------------------------------------------------------------

describe('el listado', () => {
  /**
   * LA MISMA CLAVE QUE EL CATALOGO, MEDIDA MONTANDO EL OTRO CONSUMIDOR.
   *
   * `usePacks()` de `use-catalogos` pide `GET /packs` con la clave `['packs']`,
   * y lo consumen el alta de alumno, el formulario de invitaciones y el bloque
   * de datos de la ficha. Si esta pantalla abriera una clave paralela
   * —`['packs', 'admin']`, o la misma ruta con un `?activo=false` pegado—
   * React Query la trataria como otra consulta y la peticion saldria DOS
   * veces: dos copias de la misma respuesta, que se desincronizan en cuanto
   * una de las dos se invalida.
   *
   * ⚠️ NO SE ESPIA `invalidateQueries`. Ese test seria autorreferencial:
   * compararia la clave que la pantalla invalida contra la misma que la
   * pantalla usa, y seguiria verde con las dos movidas a la vez. Aqui se monta
   * `usePacks()` DE VERDAD y se cuenta cuantas veces sale la peticion.
   *
   * LAS DOS AFIRMACIONES HACEN FALTA. Con el recuento solo, una pantalla que
   * no pidiera NADA pasaria en verde; por eso la sonda pinta cuantos packs
   * vio, y ese numero solo puede salir de una respuesta de verdad.
   */
  it('usa la MISMA clave que el catalogo: la peticion no vuelve a salir', async () => {
    await montarYEsperar({ conSonda: true });

    expect(peticiones()).toEqual([{ ruta: '/packs', metodo: 'GET', cuerpo: undefined }]);
    expect(textoDe('[data-sonda]')).toBe('3');
  });

  /**
   * LAS CINCO COLUMNAS, POR IGUALDAD Y EN ORDEN.
   *
   * Lista blanca y no lista de presencia: una columna de mas —un `salaId`
   * crudo, un `tenantId` que se colo— es la familia de error que ningun
   * `getByText(...)` ve.
   */
  it('muestra ESTAS columnas y solo estas', async () => {
    await montarYEsperar();

    expect(encabezados()).toEqual(['Pack', 'Tipo', 'Clases', 'Precio', 'Estado']);
  });

  /**
   * LAS TRES FILAS ENTERAS, CELDA POR CELDA Y POR IGUALDAD EXACTA.
   *
   * ⚠️ POR IGUALDAD Y NO POR `toContain`: un `toContain('25000')` pasa en
   * verde sobre `250000`, y `toContain('8')` pasa sobre `18`, sobre `80` y
   * sobre la mitad de los identificadores. La casualidad ortografica ya mordio
   * tres veces en las fases anteriores.
   *
   * ⚠️ Y EL PRECIO ES LA SONDA DEL FLOAT: `25000.10` pintado por un
   * `Number(pack.precio)` sale `25000.1`, que no es esta cadena. Lo mismo con
   * un `toLocaleString`, que ademas mete separadores de miles. Los dos precios
   * del fijo caen con esta sola afirmacion.
   *
   * EL ORDEN ES EL DEL SERVIDOR (`orderBy: { nombre: 'asc' }`) y esta pantalla
   * no reordena: dos criterios de orden sobre la misma lista son dos listas
   * distintas segun quien mire.
   */
  it('y pinta cada pack tal cual, en el orden en que llego', async () => {
    await montarYEsperar();

    expect(celdasDeLaFila(0)).toEqual([
      'Abono Centinela Bronce',
      'Mensual',
      '8 por mes',
      '25000.10',
      'Activo',
    ]);
    expect(celdasDeLaFila(1)).toEqual([
      'Bono Centinela Diamante',
      'Total',
      '24 en total',
      '9900.25',
      'Activo',
    ]);
    expect(celdasDeLaFila(2)).toEqual([
      'Cupon Centinela Esmeralda',
      'Mensual',
      'Sin limite',
      'A consultar',
      'De baja',
    ]);
  });

  /**
   * UN PACK DE BAJA SE DISTINGUE DE UNO ACTIVO, Y SE MIDE CON DOS MONTAJES.
   *
   * La tecnica es la de siempre: para afirmar que algo NO se dice —que no hay
   * ninguna otra diferencia escondida, ni un texto de mas ni una columna que
   * cambie— se monta DOS VECES el MISMO pack con lo unico distinto cambiado y
   * se compara el resto POR IGUALDAD.
   *
   * Y la diferencia se afirma sobre un ATRIBUTO PROPIO —`data-estado`— ademas
   * del texto: por el color no se distingue en un test, y un lector de
   * pantalla tampoco lo lee.
   */
  it('un pack dado de baja se distingue de uno activo', async () => {
    await montarYEsperar({ catalogo: [{ ...EL_MENSUAL, activo: true }] });

    const celdasDelActivo = celdasDeLaFila(0);
    const estadoDelActivo = document.querySelector('[data-estado]')?.getAttribute('data-estado');

    cleanupEntreMontajes();

    await montarYEsperar({ catalogo: [{ ...EL_MENSUAL, activo: false }] });

    const celdasDelDeBaja = celdasDeLaFila(0);
    const estadoDelDeBaja = document.querySelector('[data-estado]')?.getAttribute('data-estado');

    // La diferencia, por el atributo Y por el texto.
    expect([estadoDelActivo, estadoDelDeBaja]).toEqual(['activo', 'de-baja']);
    expect([celdasDelActivo[4], celdasDelDeBaja[4]]).toEqual(['Activo', 'De baja']);

    // Y NADA MAS cambia: las otras cuatro celdas, por igualdad.
    expect(celdasDelDeBaja.slice(0, 4)).toEqual(celdasDelActivo.slice(0, 4));
  });

  /**
   * UN FALLO AL LEER NO SE PARECE A UN GIMNASIO SIN PACKS.
   *
   * Son los dos unicos estados sin ni una fila y son OPUESTOS: uno es un dato
   * verdadero —todavia no se creo ninguno— y el otro es la ausencia de dato.
   * Es el mismo error que el 404 deducido de la Fase 10, y aqui seria peor que
   * vacio: seria PLAUSIBLE, porque un gimnasio recien dado de alta no tiene
   * packs de verdad, y quien lo mire se va creyendo que el catalogo esta vacio
   * cuando lo que pasa es que no se pudo leer.
   *
   * SE MIDE CON DOS MONTAJES Y LAS DOS MITADES SE AFIRMAN EN LOS DOS: en el
   * vacio no hay cartel de fallo, y en el fallo no hay cartel de vacio. Con
   * una sola de las dos, una pantalla que pintara los dos a la vez pasaria.
   *
   * Y EL CUERPO ENTERO POR IGUALDAD en la rama del fallo: eso es lo que fija
   * que tampoco queden el formulario de alta ni la tabla. Un alta puesta
   * encima de un catalogo que no se pudo leer es como se crea el pack que ya
   * existia.
   */
  it('un fallo al leer no se parece a un gimnasio sin packs', async () => {
    await montarYEsperar({ catalogo: [] });

    expect(textoDe('[data-fallo="lectura"]')).toBeNull();
    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByText('Este gimnasio todavia no tiene ningun pack.')).toBeTruthy();
    // El alta sigue en pie: sin ella no habria forma de crear el primero.
    expect(formulariosDelDocumento()).toEqual(['Crear un pack']);

    cleanupEntreMontajes();

    await montarYEsperar({ falloAlLeer: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });

    expect(textoDe('[data-fallo="lectura"]')).toBe(
      `No se pudo leer el catalogo de packs: ${MENSAJE_DE_LA_API}`,
    );
    expect(document.querySelector('table')).toBeNull();
    expect(formulariosDelDocumento()).toEqual([]);
    expect(document.body.textContent).toBe(
      `Los packsNo se pudo leer el catalogo de packs: ${MENSAJE_DE_LA_API}`,
    );
  });
});

// ---------------------------------------------------------------------------
// El alta
// ---------------------------------------------------------------------------

describe('crear un pack', () => {
  /**
   * EL PRECIO VIAJA COMO CADENA CON DOS DECIMALES.
   *
   * Las tres afirmaciones son distintas y hacen falta las tres:
   *
   *  1. El cuerpo ENTERO por igualdad, que fija ademas que lo vacio se omite.
   *  2. El `typeof`, que dice en una linea cual es la regla.
   *  3. El segundo decimal completado: `12500.5` es un precio que el DTO
   *     ACEPTA tal cual (`^\d{1,8}(\.\d{1,2})?$`), asi que no mandarlo con dos
   *     decimales no seria un 400 — seria un importe que se lee distinto en
   *     cada pantalla. Se completa recortando la cadena, sin `Number`.
   *
   * ⚠️ `toEqual` DISTINGUE `'25000.10'` DE `25000.1`: una cadena y un numero no
   * son iguales para Vitest ni aunque se parezcan al leerlos. Esa es
   * exactamente la diferencia que un `Number()` por el camino introduce.
   */
  it('el precio viaja como CADENA con dos decimales', async () => {
    await montarYEsperar();

    await escribir(elAlta(), 'Nombre', 'Pack nuevo del mostrador');
    await escribir(elAlta(), 'Precio', CENTINELAS.elPrecioDelMensual);
    await pulsar(elAlta(), 'Crear el pack');

    const alta = laEscritura();
    expect(alta.ruta).toBe('/packs');
    expect(alta.metodo).toBe('POST');
    expect(alta.cuerpo).toEqual({
      tipo: 'MENSUAL',
      nombre: 'Pack nuevo del mostrador',
      precio: '25000.10',
    });
    expect(typeof (alta.cuerpo as { precio: unknown }).precio).toBe('string');
  });

  it('y un precio con UN decimal se completa a dos, sin pasar por un float', async () => {
    await montarYEsperar();

    await escribir(elAlta(), 'Nombre', 'Pack de medio centavo');
    await escribir(elAlta(), 'Precio', '12500.5');
    await pulsar(elAlta(), 'Crear el pack');

    expect(laEscritura().cuerpo).toEqual({
      tipo: 'MENSUAL',
      nombre: 'Pack de medio centavo',
      precio: '12500.50',
    });
  });

  /**
   * LO QUE ESTA VACIO SE OMITE, no viaja como cadena vacia ni como cero.
   *
   * `precio: ''` seria un 400 del `@Matches`, y un `cancelacionesPermitidas: 0`
   * seria una decision que nadie tomo: `Number('')` es CERO, y sin el corte del
   * vacio un campo en blanco se mandaria como «cero cancelaciones».
   *
   * El cuerpo se afirma ENTERO: lo que prueba que se omite es que el objeto no
   * tenga esas claves, y eso no lo dice ningun `toContain`.
   */
  it('los campos vacios NO viajan: un pack puede nacer a consultar y sin tope', async () => {
    await montarYEsperar();

    await escribir(elAlta(), 'Nombre', 'Pack a consultar');
    await pulsar(elAlta(), 'Crear el pack');

    expect(laEscritura().cuerpo).toEqual({ tipo: 'MENSUAL', nombre: 'Pack a consultar' });
  });

  /**
   * UN SOLO CONTADOR EN PANTALLA, el del tipo elegido, y es el unico que viaja.
   *
   * `validarCoherencia` tira un 400 si llega `clasesTotales` con
   * `tipo: 'MENSUAL'`. Con los dos campos dibujados habria que acordarse de no
   * mandar uno; con uno solo, lo que no se puede mandar no existe.
   */
  it('un pack TOTAL manda clasesTotales y NUNCA clasesPorMes', async () => {
    await montarYEsperar();

    const usuario = userEvent.setup();
    await usuario.selectOptions(within(elAlta()).getByLabelText('Tipo'), 'TOTAL');

    await escribir(elAlta(), 'Nombre', 'Pack de veinte clases');
    await escribir(elAlta(), 'Clases en total', '20');
    await pulsar(elAlta(), 'Crear el pack');

    expect(laEscritura().cuerpo).toEqual({
      tipo: 'TOTAL',
      nombre: 'Pack de veinte clases',
      clasesTotales: 20,
    });
  });

  /** Sin nombre no hay pack, y no se manda nada: el 400 se ataja antes. */
  it('sin nombre no se manda nada', async () => {
    await montarYEsperar();

    await escribir(elAlta(), 'Precio', '1000.00');
    await pulsar(elAlta(), 'Crear el pack');

    expect(escrituras()).toEqual([]);
    expect(screen.getByText('El pack necesita un nombre.')).toBeTruthy();
  });

  /**
   * EL EXITO DICE LO QUE HIZO Y, EN LA MISMA FRASE, LO QUE NO.
   *
   * El texto esta escrito ENTERO y a mano aqui, y se afirma por IGUALDAD. Si
   * se importara la constante de la pagina —cosa que ademas Next prohibe en un
   * `page.tsx`—, cambiarla por un «listo» moveria los dos lados a la vez y el
   * test seguiria verde.
   */
  it('el exito aclara que el pack todavia no lo tiene nadie', async () => {
    await montarYEsperar();

    await escribir(elAlta(), 'Nombre', 'Pack recien nacido');
    await pulsar(elAlta(), 'Crear el pack');

    expect(textoDe('[data-resultado="alta"]')).toBe(
      'Pack creado. Todavia no lo tiene nadie: el pack de cada alumno se elige en su ficha.',
    );
    expect(textoDe('[data-fallo="alta"]')).toBeNull();
  });

  /**
   * UN FALLO NO SE PARECE A UN EXITO, y se distingue por un ATRIBUTO PROPIO.
   *
   * Las dos afirmaciones hacen falta: con la del error sola, una pantalla que
   * pintara los dos carteles a la vez pasaria en verde. Y el mensaje de la API
   * va TAL CUAL: «precio debe ser un numero con hasta 2 decimales» dice que
   * pasa; un «hubo un problema» no.
   */
  it('un fallo del alta se distingue de un exito', async () => {
    await montarYEsperar({
      falloAlEscribir: new ErrorDeApi('Ya hay un pack con ese nombre', 409),
    });

    await escribir(elAlta(), 'Nombre', 'Pack repetido');
    await pulsar(elAlta(), 'Crear el pack');

    expect(textoDe('[data-resultado="alta"]')).toBeNull();
    expect(textoDe('[data-fallo="alta"]')).toBe(
      'No se pudo crear el pack: Ya hay un pack con ese nombre',
    );
  });
});

// ---------------------------------------------------------------------------
// La edicion
// ---------------------------------------------------------------------------

describe('editar un pack', () => {
  /**
   * SE EDITA EL DE ESA FILA, con tres sembrados y todos distintos.
   *
   * Con un solo pack en el fijo, «edita el de esa fila» y «edita el primero de
   * la lista» serian la misma afirmacion.
   */
  it('se abre el de ESA fila, no el primero', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelTotal);

    expect(textoDe('[data-pack-elegido]')).toBe('Bono Centinela Diamante');
    expect(within(laEdicion()).getByLabelText('Precio')).toHaveValue('9900.25');
    expect(within(laEdicion()).getByLabelText('Clases en total')).toHaveValue(24);
  });

  /**
   * EDITAR MANDA SOLO LO QUE CAMBIO.
   *
   * No es «lo mismo pero de mas»: el PATCH pisa cada clave que llega, asi que
   * mandar el formulario entero reescribiria con los valores que esta pantalla
   * leyo hace cinco minutos lo que otro admin acabe de cambiar — y en silencio,
   * porque el PATCH contesta 200. Es la misma regla que los ocho ajustes de la
   * ficha de sala.
   *
   * EL CUERPO SE AFIRMA ENTERO: lo que prueba que NO viajan el precio, el tipo,
   * el contador ni las cancelaciones es que el objeto tenga una sola clave, y
   * eso no lo dice ningun `toContain`. Y el fijo de este pack tiene los cuatro
   * campos con valor —`9900.25`, `TOTAL`, `24`, `0`—, asi que un formulario
   * entero traeria cuatro claves de mas y no cero.
   */
  it('editar manda solo lo que cambio', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelTotal);

    await escribir(laEdicion(), 'Nombre', 'Bono con otro nombre');
    await pulsar(laEdicion(), 'Guardar el pack');

    const patch = laEscritura();
    expect(patch.ruta).toBe('/packs/pk-del-bono');
    expect(patch.metodo).toBe('PATCH');
    expect(patch.cuerpo).toEqual({ nombre: 'Bono con otro nombre' });
  });

  /**
   * UN CAMPO ESCRITO Y DEVUELTO A COMO ESTABA NO VIAJA.
   *
   * Se compara contra el DATO y no contra un «esto lo toque»: un `dirty` por
   * campo mandaria el precio de vuelta tal cual, que parece inofensivo y es
   * justo la escritura que pisa lo que otro acaba de cambiar.
   */
  it('y un campo devuelto a como estaba tampoco', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    await escribir(laEdicion(), 'Precio', '30000.00');
    await escribir(laEdicion(), 'Precio', CENTINELAS.elPrecioDelMensual);
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(escrituras()).toEqual([]);
    expect(textoDe('[data-resultado="sin-cambios"]')).toBe('No cambiaste nada.');
  });

  /**
   * AL CAMBIAR DE TIPO, EL CONTADOR NUEVO VIAJA Y EL VIEJO NO.
   *
   * MEDIDO en `PacksService.actualizar`, que NO hereda el contador viejo
   * cuando el tipo cambia —`const porMes = cambiaTipo ? dto.clasesPorMes : …`—
   * y ademas anula el del tipo viejo explicitamente. O sea que el contador
   * nuevo tiene que viajar aunque el texto no se haya tocado, y mandar el
   * viejo seria el 400 de coherencia.
   */
  it('cambiar de MENSUAL a TOTAL manda el contador nuevo y nunca el viejo', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    const usuario = userEvent.setup();
    await usuario.selectOptions(within(laEdicion()).getByLabelText('Tipo'), 'TOTAL');
    await escribir(laEdicion(), 'Clases en total', '36');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(laEscritura().cuerpo).toEqual({ tipo: 'TOTAL', clasesTotales: 36 });
  });

  /**
   * EL PRECIO EDITADO TAMBIEN VIAJA COMO CADENA CON DOS DECIMALES.
   *
   * El alta y la edicion son dos caminos distintos hasta el mismo cuerpo: con
   * el test del alta solo, una conversion metida en el camino de la edicion
   * pasaria en verde.
   */
  it('el precio editado viaja como CADENA con dos decimales', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    await escribir(laEdicion(), 'Precio', '31000.7');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(laEscritura().cuerpo).toEqual({ precio: '31000.70' });
    expect(typeof (laEscritura().cuerpo as { precio: unknown }).precio).toBe('string');
  });

  /**
   * VACIAR UN CAMPO QUE TENIA VALOR SE DICE, NO SE TRAGA.
   *
   * `ActualizarPackDto` declara `precio?: string` con `@IsOptional()` y sin
   * ninguna forma de mandar `null`: omitir la clave es «no lo toques», no
   * «dejalo sin valor». O sea que un pack con precio NO puede volver a «a
   * consultar» desde ninguna pantalla. Un formulario que aceptara el borrado y
   * guardara sin la clave dejaria al admin creyendo que lo consiguio.
   */
  it('vaciar el precio de un pack que lo tiene se explica y no se manda', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    await escribir(laEdicion(), 'Precio', '');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(escrituras()).toEqual([]);
    expect(
      screen.getByText(
        'No se puede volver a dejarlo vacio desde aca: la API admite cambiar este valor, no borrarlo.',
      ),
    ).toBeTruthy();
  });

  /**
   * EL EXITO DICE LO QUE ARRASTRA, porque no es solo esta pantalla.
   *
   * MEDIDO en `PacksService.actualizar`, que invalida la cache de reportes con
   * un comentario que lo explica: «EL PRECIO DE UN PACK ES EL
   * `pendienteEstimado` DE TODOS SUS ALUMNOS».
   */
  it('el exito dice que el precio mueve lo que la caja dice que falta cobrar', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    await escribir(laEdicion(), 'Nombre', 'Abono con otro nombre');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(textoDe('[data-resultado="guardado"]')).toBe(
      'Pack guardado. Si cambiaste el precio, cambia tambien lo que la caja dice que falta ' +
        'cobrarle a cada alumno que tiene este pack.',
    );
    expect(textoDe('[data-fallo="guardado"]')).toBeNull();
  });

  it('y un fallo al guardar se distingue de un exito', async () => {
    await montarYEsperar({
      falloAlEscribir: new ErrorDeApi('Un pack MENSUAL se mide en clasesPorMes', 400),
    });
    await editar(CENTINELAS.nombreDelMensual);

    await escribir(laEdicion(), 'Nombre', 'Abono roto');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(textoDe('[data-resultado="guardado"]')).toBeNull();
    expect(textoDe('[data-fallo="guardado"]')).toBe(
      'No se pudo guardar el pack: Un pack MENSUAL se mide en clasesPorMes',
    );
  });
});

// ---------------------------------------------------------------------------
// La baja
// ---------------------------------------------------------------------------

describe('dar de baja un pack', () => {
  /**
   * DAR DE BAJA DICE QUE PASA CON QUIEN LO TIENE, Y LO QUE DICE ESTA MEDIDO.
   *
   * `PacksService.darDeBaja` es, entera, un `pack.update({ data: { activo: false } })`
   * mas una linea de historial: NO toca `Perfil`, no cuenta cuantos alumnos
   * tienen el pack, no reasigna a nadie y NO HAY 409. A diferencia de la baja
   * de una sala de la Fase 10 —dos puertas y un 409 que contaba los turnos
   * futuros—, esta sale siempre.
   *
   * Y lo que NO pasa tambien esta medido FUERA de `packs.service.ts`, porque
   * desde ahi solo se ve la mitad:
   *
   *  - `UsuariosService.resolverPack` hace `findFirst({ where: { id } })` sin
   *    mirar `activo`: la ficha del alumno lo sigue mostrando.
   *  - `stats.datos.ts#perfilesConPack` se baja TODOS los packs sin filtro
   *    para armar el `precioPack`: el pendiente de la caja y la cobranza
   *    siguen contandolo.
   *  - El procesador de recordatorios filtra por `packId: { not: null }` y no
   *    por si el pack sigue en pie: los avisos de pago siguen saliendo.
   *
   * ⚠️ Y LA ULTIMA FRASE ES LA QUE MAS IMPORTA: el `DELETE` devuelve un
   * `PackPublico` y ahi NO hay ningun recuento, ni lo hay en el `GET /packs`.
   * Un «no afecta a nadie» seria una frase tranquilizadora que la respuesta no
   * sostiene, y un «afecta a N alumnos» seria un numero inventado. Se dice lo
   * que PASA y se dice que el CUANTO no se sabe.
   *
   * EL TEXTO VA ESCRITO ENTERO Y A MANO, y por IGUALDAD: importar la constante
   * de la pagina la compararia contra si misma y un cambio a «no pasa nada»
   * moveria los dos lados a la vez.
   */
  it('dar de baja dice que pasa con quien lo tiene', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Dar de baja el pack' }));
    await esperar();

    const dialogo = screen.getByRole('dialog');

    // LA PREGUNTA NOMBRA EL PACK: una pestaña vieja es como se da de baja el
    // que no era.
    expect(within(dialogo).getByText('Dar de baja el pack Abono Centinela Bronce')).toBeTruthy();

    expect(
      within(dialogo).getByText(
        'A los alumnos que ya lo tienen no les pasa nada: conservan el pack, lo siguen viendo en ' +
          'su ficha y su precio sigue contando en la caja y en la cobranza. Lo que cambia es que ' +
          'deja de verse en el catalogo de los alumnos y deja de poder elegirse en una invitacion ' +
          'nueva. Cuantos alumnos lo tienen, la API no lo dice en ningun sitio y esta pantalla no ' +
          'lo inventa.',
      ),
    ).toBeTruthy();

    // Y hasta aqui no se mando nada: preguntar no es hacer.
    expect(escrituras()).toEqual([]);
  });

  /**
   * LA BAJA ES UN `DELETE` SIN CUERPO, SOBRE EL PACK DE ESA FILA.
   *
   * Y el exito dice que el pack sigue existiendo: un «pack borrado» seria
   * falso —la fila sobrevive con `activo: false`— y ademas esconderia que hay
   * forma de volver a ofrecerlo.
   */
  it('confirmar manda el DELETE del pack elegido, y el exito dice que no se borro', async () => {
    await montarYEsperar({ respuesta: { ...EL_TOTAL, activo: false } });
    await editar(CENTINELAS.nombreDelTotal);

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Dar de baja el pack' }));
    await esperar();
    await usuario.click(screen.getByRole('button', { name: 'Dar de baja' }));
    await esperar();

    expect(laEscritura()).toEqual({
      ruta: '/packs/pk-del-bono',
      metodo: 'DELETE',
      cuerpo: undefined,
    });
    expect(textoDe('[data-resultado="baja"]')).toBe(
      'Pack dado de baja. Sigue existiendo y quien lo tenia lo conserva: para volver a ofrecerlo, ' +
        'poné «Activo» en «Sí» y guarda.',
    );
  });

  /** Cancelar no manda nada. Un dialogo que escribe al abrirse no es un dialogo. */
  it('cancelar no manda nada', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelMensual);

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: 'Dar de baja el pack' }));
    await esperar();
    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * UN PACK YA DE BAJA NO SE VUELVE A DAR DE BAJA.
   *
   * El `DELETE` es IDEMPOTENTE —`if (!existente.activo) return existente`, sin
   * escribir en el historial— asi que el boton contestaria 200 y no haria
   * nada: un gesto que parece hacer algo y no lo hace. En su sitio se dice
   * como reactivarlo, que es lo unico que el `DELETE` no sabe hacer y el PATCH
   * si (`ActualizarPackDto` admite `activo`).
   */
  it('un pack que ya esta de baja no ofrece el boton: ofrece como reactivarlo', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelDeBaja);

    expect(screen.queryByRole('button', { name: 'Dar de baja el pack' })).toBeNull();
    expect(textoDe('[data-resultado="baja"]')).toBe('Este pack ya esta de baja.');
    expect(within(laEdicion()).getByLabelText('Activo')).toHaveValue('false');
  });

  /**
   * LA OTRA PUERTA A LA MISMA BAJA: el PATCH con `activo: false`.
   *
   * No es una duplicacion por descuido —es el mismo reparto que la ficha de
   * sala—: `ActualizarPackDto` admite `activo`, asi que esa puerta esta
   * abierta en la API la dibuje la pantalla o no, y ademas es la UNICA forma
   * de REACTIVAR un pack.
   */
  it('y el interruptor de Activo lo reactiva con un PATCH de una sola clave', async () => {
    await montarYEsperar();
    await editar(CENTINELAS.nombreDelDeBaja);

    const usuario = userEvent.setup();
    await usuario.selectOptions(within(laEdicion()).getByLabelText('Activo'), 'true');
    await pulsar(laEdicion(), 'Guardar el pack');

    expect(laEscritura()).toEqual({
      ruta: '/packs/pk-del-cupon',
      metodo: 'PATCH',
      cuerpo: { activo: true },
    });
  });
});

/**
 * El desmontaje entre los DOS montajes de un mismo test.
 *
 * `cleanup()` corre solo en el `afterEach` global, o sea DESPUES del test. Los
 * dos tests que montan dos veces —la tecnica de los dos montajes— tienen que
 * desmontar en medio: sin esto, el segundo `render` apila su arbol sobre el
 * primero y `celdasDeLaFila(0)` leeria la fila del montaje viejo.
 *
 * Se declara al final porque es andamiaje y no un caso; se usa el `cleanup` de
 * Testing Library y no se reinventa. Y se limpian tambien las llamadas: el
 * `GET /packs` del primer montaje no es una peticion del segundo.
 */
function cleanupEntreMontajes(): void {
  cleanup();
  vi.clearAllMocks();
}
