import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguracionWebSalon, RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDeLaWeb from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'mi-gym' }),
  usePathname: () => '/mi-gym/admin/configuracion/web',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-configuracion.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide esta pantalla, CUANDO, con
 * que cuerpo y —en una pantalla de SEIS endpoints— A CUAL de los seis. El
 * `ErrorDeApi` se deja REAL: el fijo del fallo es un error de la API de verdad
 * y no un `Error` pelado.
 *
 * ⚠️ Y NO SE INSTALA NINGUN DOBLE MAS. Nada de `location`, `history`,
 * `console`, `localStorage` ni `document.title`: de todo eso ya hay un tapon
 * GLOBAL en `vitest.setup.ts`, y un doble local lo TAPA en este archivo. Medido
 * en la fase anterior: un doble local de la URL dejo 24 de 25 tests pasando con
 * una fuga delante.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * LAS TRES RUTAS, ESCRITAS A MANO. Son el contrato, leido del controller:
 * `@Controller('config/web-salon')` con `GET /`, `PUT /`, `POST testimonios`,
 * `DELETE testimonios/:id`, `POST faq` y `DELETE faq/:id`.
 *
 * A mano y no importadas de `use-configuracion`: importarlas compararia la
 * constante contra si misma y cambiar la ruta moveria los dos lados a la vez.
 */
const RUTA_DE_LA_WEB = '/config/web-salon';
const RUTA_DE_LOS_TESTIMONIOS = '/config/web-salon/testimonios';
const RUTA_DE_LAS_PREGUNTAS = '/config/web-salon/faq';

/** Lo que dice la API cuando algo falla. Palabra por palabra. */
const MENSAJE_DE_LA_API = 'La base de datos del gimnasio no contesta';

// ---------------------------------------------------------------------------
// El fixture
// ---------------------------------------------------------------------------

/**
 * EL FIXTURE HABLA EL IDIOMA DEL CONTRATO, NO EL DEL CODIGO.
 *
 * Las dos listas vienen con DOS elementos cada una, y no con uno: con una sola
 * fila por lista, «borra el de esa fila» y «borra el primero de la lista» son
 * la misma llamada y el test no puede distinguirlos. Con una sola lista
 * sembrada, «borra de la suya» y «borra de la primera» tampoco.
 *
 * Y LOS IDS DE LAS DOS LISTAS NO SE PARECEN: `tst-…` y `faq-…`, con cuerpos
 * distintos. Si un testimonio y una pregunta pudieran confundirse, una pantalla
 * que borrara de la lista equivocada mandaria un id que igual existe y el test
 * no lo veria.
 *
 * ES INCOHERENTE EN LO DERIVADO Y POSIBLE EN TODO LO DEMAS: hay DOS
 * testimonios cargados con `mostrarTestimonios` en FALSE. Eso pasa de verdad
 * —se cargan y se publican en dos momentos distintos— y es justo el estado en
 * el que una lista fija de «que deja de verse» mentiria.
 */
const ID_DEL_PRIMER_TESTIMONIO = 'tst-9f2c4a7b';
const ID_DEL_SEGUNDO_TESTIMONIO = 'tst-4d10e63f';
const ID_DE_LA_PRIMERA_PREGUNTA = 'faq-3e81d60c';
const ID_DE_LA_SEGUNDA_PREGUNTA = 'faq-b7a25194';
const ID_DEL_PLAN_DESTACADO = 'pack-77c1';

const NOMBRE_DEL_PRIMER_TESTIMONIO = 'Lucia Ferrer';
const NOMBRE_DEL_SEGUNDO_TESTIMONIO = 'Marcos Iriarte';
const LA_SEGUNDA_PREGUNTA = 'Se puede congelar el pack?';

const TAGLINE = 'Entrenamos en grupos de ocho';

const WEB_COMPLETA: ConfiguracionWebSalon = {
  activa: true,
  colorPrimario: '#1d4ed8',
  colorSecundario: '#f8fafc',
  tituloPrincipal: 'Entrena en Nucleo',
  tagline: TAGLINE,
  sobreElSalon: 'Un galpon reciclado con ocho estaciones y dos profesoras.',
  imagenPrincipalUrl: 'https://cdn.ejemplo.com/portada.jpg',
  whatsapp: '+54 11 5555 0000',
  instagram: '@nucleo.box',
  linkExtra: 'https://nucleo.ejemplo.com/horarios',
  mostrarPrecios: true,
  mostrarTestimonios: false,
  mostrarFAQ: true,
  mostrarTurnosLibres: false,
  planDestacadoId: ID_DEL_PLAN_DESTACADO,
  testimonios: [
    {
      id: ID_DEL_PRIMER_TESTIMONIO,
      nombre: NOMBRE_DEL_PRIMER_TESTIMONIO,
      texto: 'Llegue sin poder hacer una dominada y ahora hago cinco.',
      orden: 10,
    },
    {
      id: ID_DEL_SEGUNDO_TESTIMONIO,
      nombre: NOMBRE_DEL_SEGUNDO_TESTIMONIO,
      texto: 'Las clases de las siete son un clasico de mi semana.',
      orden: 20,
    },
  ],
  preguntas: [
    {
      id: ID_DE_LA_PRIMERA_PREGUNTA,
      pregunta: 'Hace falta experiencia previa?',
      respuesta: 'No: la primera semana se arma un plan de adaptacion.',
      orden: 5,
    },
    {
      id: ID_DE_LA_SEGUNDA_PREGUNTA,
      pregunta: LA_SEGUNDA_PREGUNTA,
      respuesta: 'Si, una vez por año y hasta treinta dias.',
      orden: 15,
    },
  ],
};

/**
 * EXACTAMENTE lo que devuelve `WebSalonService.ver()` cuando no hay fila: los
 * `@default` del schema, con `activa: false` y los dos colores puestos.
 *
 * Es la forma PLAUSIBLE contra la que se compara el fallo de lectura, y es la
 * otra mitad del par: si un gimnasio sin configurar no se dibujara, «el fallo
 * no se parece a una web sin configurar» pasaria en verde sin significar nada.
 */
const WEB_SIN_CONFIGURAR: ConfiguracionWebSalon = {
  activa: false,
  colorPrimario: '#000000',
  colorSecundario: '#ffffff',
  tituloPrincipal: null,
  tagline: null,
  sobreElSalon: null,
  imagenPrincipalUrl: null,
  whatsapp: null,
  instagram: null,
  linkExtra: null,
  mostrarPrecios: false,
  mostrarTestimonios: false,
  mostrarFAQ: false,
  mostrarTurnosLibres: false,
  planDestacadoId: null,
  testimonios: [],
  preguntas: [],
};

/**
 * LO QUE ESTA PANTALLA TIENE EN LA MANO Y NO DEBERIA SALIR POR NINGUN CANAL.
 *
 * Son NOMBRES DE PERSONAS —los testimonios llevan el nombre de alumnos de
 * verdad— y LO ANCHO DEL CONTRATO: los cuatro ids de las filas y el del plan
 * destacado, que son justo lo que `SalonPublico` NO lleva.
 *
 * Los trece tapones globales de `vitest.setup.ts` buscan lo vigilado en la
 * consola, el titulo, `window.name`, el `<head>`, los cinco almacenes, el
 * buffer de User Timing, el `src` de una imagen, las tres salidas laterales,
 * el service worker, los atributos del `<html>` y del `<body>` y la URL.
 * Sembrarlos aqui es lo que convierte esos trece ejes en una auditoria de ESTA
 * pantalla.
 *
 * El `orden` y las banderas NO se siembran: `10`, `20`, `true` y `false` son
 * subcadenas de cualquier cosa y darian falsos positivos en los trece ejes a la
 * vez. Es la casualidad ortografica, del lado del tapon.
 */
vigilarEstosDatos({
  nombreDeQuienDioElTestimonio: NOMBRE_DEL_PRIMER_TESTIMONIO,
  nombreDelSegundoTestimonio: NOMBRE_DEL_SEGUNDO_TESTIMONIO,
  idDelPrimerTestimonio: ID_DEL_PRIMER_TESTIMONIO,
  idDelSegundoTestimonio: ID_DEL_SEGUNDO_TESTIMONIO,
  idDeLaPrimeraPregunta: ID_DE_LA_PRIMERA_PREGUNTA,
  idDeLaSegundaPregunta: ID_DE_LA_SEGUNDA_PREGUNTA,
  idDelPlanDestacado: ID_DEL_PLAN_DESTACADO,
  loQueElGimnasioPublica: TAGLINE,
  loQueDijoLaApi: MENSAJE_DE_LA_API,
});

// ---------------------------------------------------------------------------
// Los textos, escritos A MANO
// ---------------------------------------------------------------------------

/**
 * Repetidos aqui y no importados de `page.tsx`.
 *
 * Importar la constante y compararla contra si misma es la primera de las
 * cinco formas de que un test no pueda fallar: cambiar el texto por «la web
 * esta en 0%» moveria los dos lados a la vez y el test seguiria verde. Ademas,
 * `page.tsx` NO PUEDE exportarlas: Next 15 prohibe que un `page.tsx` exporte
 * nada que no sea el `default`.
 */
const ESTADO_ENCENDIDA =
  'La web publica esta ENCENDIDA: cualquiera que entre a la direccion del gimnasio, sin cuenta y ' +
  'sin que nadie le de permiso, ve lo que este marcado aqui abajo.';

const ESTADO_APAGADA =
  'La web publica esta APAGADA: la direccion del gimnasio contesta lo mismo que la de un ' +
  'gimnasio que no existe. Lo de aqui abajo se puede editar y guardar igual, pero no lo ve nadie.';

const CONSECUENCIA_DE_LOS_TURNOS_LIBRES =
  'Publica la agenda: cualquiera ve que turnos quedan libres y, con eso, cuan vacio esta el ' +
  'gimnasio.';

const CONSECUENCIA_DE_LOS_PRECIOS =
  'Pone la lista de precios de los packs en una pagina que puede leer cualquiera y que los ' +
  'buscadores indexan.';

const PREGUNTA_DE_APAGAR = 'Apagar la web publica del gimnasio';

/** Con `WEB_COMPLETA`: precios y FAQ encendidos, testimonios y turnos NO. */
const DETALLE_DE_APAGAR =
  'Ahora mismo se ve, sin cuenta y desde cualquier sitio: la portada con el nombre, el titulo y ' +
  'el texto del gimnasio, los precios de los packs y las preguntas frecuentes. Al apagarla deja ' +
  'de verse todo eso. No se borra nada: volver a encenderla lo devuelve tal cual.';

/** Con las cuatro banderas encendidas. La otra mitad del par. */
const DETALLE_DE_APAGAR_CON_TODO_ENCENDIDO =
  'Ahora mismo se ve, sin cuenta y desde cualquier sitio: la portada con el nombre, el titulo y ' +
  'el texto del gimnasio, los precios de los packs, los testimonios, las preguntas frecuentes y ' +
  'los turnos libres. Al apagarla deja de verse todo eso. No se borra nada: volver a encenderla ' +
  'lo devuelve tal cual.';

/** Los cuatro interruptores, por su nombre accesible. */
const PRECIOS = 'Mostrar los precios de los packs';
const TESTIMONIOS = 'Mostrar los testimonios';
const FAQ = 'Mostrar las preguntas frecuentes';
const TURNOS_LIBRES = 'Mostrar los turnos libres';

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

interface Opciones {
  metodo?: string;
  cuerpo?: unknown;
}

interface OpcionesDeMontaje {
  /** `null` se monta SIN proveedor: ver el comentario de `montar`. */
  rol?: RolUsuario | null;
  /** Lo que contesta la PRIMERA lectura de `GET /config/web-salon`. */
  web?: ConfiguracionWebSalon;
  /** Lo que contestan la SEGUNDA lectura y las siguientes, si es distinto. */
  webDespues?: ConfiguracionWebSalon;
  /** Si se pasa, la LECTURA falla con esto. */
  falloAlLeer?: ErrorDeApi;
  /** Si se pasa, el `PUT` falla con esto. */
  falloAlGuardar?: ErrorDeApi;
  /** Si se pasa, el `POST` y el `DELETE` de las dos listas fallan con esto. */
  falloEnLasListas?: ErrorDeApi;
}

function montar({
  rol = 'ADMIN_SALON',
  web = WEB_COMPLETA,
  webDespues,
  falloAlLeer,
  falloAlGuardar,
  falloEnLasListas,
}: OpcionesDeMontaje = {}) {
  let lecturas = 0;

  pedirEspia.mockImplementation((ruta: string, opciones?: Opciones) => {
    const metodo = opciones?.metodo ?? 'GET';

    if (ruta === RUTA_DE_LA_WEB && metodo === 'GET') {
      lecturas += 1;
      if (falloAlLeer !== undefined) return Promise.reject(falloAlLeer);

      return Promise.resolve(lecturas === 1 ? web : (webDespues ?? web));
    }

    if (ruta === RUTA_DE_LA_WEB && metodo === 'PUT') {
      return falloAlGuardar === undefined ? Promise.resolve(web) : Promise.reject(falloAlGuardar);
    }

    const esAltaDeLista =
      metodo === 'POST' && (ruta === RUTA_DE_LOS_TESTIMONIOS || ruta === RUTA_DE_LAS_PREGUNTAS);

    const esBorradoDeLista =
      metodo === 'DELETE' &&
      (ruta.startsWith(`${RUTA_DE_LOS_TESTIMONIOS}/`) ||
        ruta.startsWith(`${RUTA_DE_LAS_PREGUNTAS}/`));

    if (esAltaDeLista || esBorradoDeLista) {
      if (falloEnLasListas !== undefined) return Promise.reject(falloEnLasListas);

      // El `DELETE` contesta 204 sin cuerpo, y eso es `null` para `pedir`.
      return Promise.resolve(esBorradoDeLista ? null : opciones?.cuerpo);
    }

    // Cualquier otra ruta es un error del codigo bajo prueba y tiene que verse
    // como tal en vez de resolver en vacio.
    throw new Error(`La pantalla pidio una ruta que nadie espera: ${metodo} ${ruta}`);
  });

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const pantalla = <PaginaDeLaWeb />;

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

/** Deja que la consulta y las mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}) {
  const cliente = montar(opciones);
  await esperar();
  return cliente;
}

/**
 * Desmonta lo montado para poder montar otra vez DENTRO del mismo test.
 *
 * El `cleanup()` global corre entre tests, no entre montajes: sin esto, el
 * segundo `render` de los tests de dos montajes dejaria los dos documentos
 * juntos.
 */
function cleanupEntreMontajes(): void {
  cleanup();
  pedirEspia.mockReset();
}

// ---------------------------------------------------------------------------
// Lo que paso por `pedir`
// ---------------------------------------------------------------------------

interface Llamada {
  ruta: string;
  metodo: string;
  cuerpo: unknown;
}

function llamadas(): Llamada[] {
  return (pedirEspia.mock.calls as [string, Opciones | undefined][]).map(([ruta, opciones]) => ({
    ruta,
    metodo: opciones?.metodo ?? 'GET',
    cuerpo: opciones?.cuerpo,
  }));
}

/** `METODO ruta`, en orden, para afirmar la lista entera por igualdad. */
function rutasPedidas(): string[] {
  return llamadas().map(({ metodo, ruta }) => `${metodo} ${ruta}`);
}

function llamada(indice: number): Llamada {
  const encontrada = llamadas()[indice];
  if (encontrada === undefined) throw new Error(`No hubo llamada numero ${indice}`);

  return encontrada;
}

/** Las escrituras: todo lo que no fue una lectura. */
function escrituras(): Llamada[] {
  return llamadas().filter(({ metodo }) => metodo !== 'GET');
}

// ---------------------------------------------------------------------------
// Lo que hay en el marcado
// ---------------------------------------------------------------------------

/**
 * Del marcado CRUDO y no por `*ByRole`: el arbol de accesibilidad ya excluye
 * lo que lleva `hidden`, asi que un `queryByRole` en null no distingue «no
 * esta» de «esta y no se ve», que es justo la distincion que sostiene la
 * puerta de rol.
 */
function enlacesDelDocumento(): [string, string][] {
  return [...document.querySelectorAll('a')].map((a) => [
    a.textContent?.trim() ?? '',
    a.getAttribute('href') ?? '',
  ]);
}

const botonesDelDocumento = () => [...document.querySelectorAll('button')];

const casillasDelDocumento = () => [...document.querySelectorAll('input[type="checkbox"]')];

/** El texto del nodo marcado con ese selector, con los espacios normalizados. */
function textoDe(selector: string): string | null {
  const nodo = document.querySelector(selector);
  if (nodo === null) return null;

  // El colapso de espacios es por el FORMATO del JSX —los saltos de linea del
  // archivo acaban en el texto—, no una rebaja: lo que se compara sigue siendo
  // el contenido entero y por igualdad.
  return (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Los textos de todos los nodos con ese selector, en orden. */
function textosDe(selector: string): string[] {
  return [...document.querySelectorAll(selector)].map((nodo) =>
    (nodo.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

function valorDelCampo(id: string): string | null {
  const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  return campo === null ? null : campo.value;
}

function casilla(nombre: string): HTMLInputElement {
  return screen.getByRole('checkbox', { name: nombre });
}

/**
 * LA DESCRIPCION ACCESIBLE DE UN INTERRUPTOR, O `null` SI NO TIENE.
 *
 * Es lo que hace que «al lado» sea comprobable: no se busca la frase por la
 * pantalla —podria estar en un `title=`, en un «ver mas» plegado o tres
 * secciones mas abajo— sino que se sigue el `aria-describedby` DEL CONTROL
 * hasta el nodo que describe. Si la consecuencia se fuera a un atributo, aqui
 * no habria nada que seguir.
 */
function descripcionDe(nombre: string): string | null {
  const idDescripcion = casilla(nombre).getAttribute('aria-describedby');
  if (idDescripcion === null) return null;

  const nodo = document.getElementById(idDescripcion);
  return nodo === null ? null : (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Los parrafos del dialogo de confirmacion, en orden. Sin los botones. */
function parrafosDelDialogo(): string[] {
  return [...document.querySelectorAll('[role="dialog"] p')].map((nodo) =>
    (nodo.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

/**
 * TODOS LOS ATRIBUTOS DE TODO LO QUE HAY DENTRO DEL `<body>`.
 *
 * Ver el `describe` del final: es el eje que no mira nadie.
 */
function atributosDeDentroDelCuerpo(): string[] {
  return [document.body, ...document.body.querySelectorAll('*')].flatMap((nodo) =>
    [...nodo.attributes].map((atributo) => `${atributo.name}=${atributo.value}`),
  );
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

async function escribirEnElCampo(id: string, valor: string): Promise<void> {
  const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`);
  if (campo === null) throw new Error(`No hay ningun campo con id ${id}`);

  const usuario = userEvent.setup();
  await usuario.clear(campo);
  if (valor !== '') await usuario.type(campo, valor);
  await esperar();
}

async function pulsar(nombre: string): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

async function marcar(nombre: string): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(casilla(nombre));
  await esperar();
}

const guardarElFormulario = () => pulsar('Guardar los cambios');

beforeEach(() => {
  pedirEspia.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Las banderas
// ---------------------------------------------------------------------------

describe('las banderas de que se publica', () => {
  /**
   * UNA BANDERA APAGADA QUE NO SE DIBUJA ES UNA BANDERA QUE NO SE PUEDE
   * ENCENDER.
   *
   * El contrato lo dice con todas las letras: `ConfiguracionWebSalon` es
   * deliberadamente mas ancha que `SalonPublico` porque «el admin tiene que
   * poder verlas apagadas para encenderlas». Es lo contrario que los tres
   * campos muertos de la Fase 10, que no se dibujan porque no hacen nada.
   *
   * El escenario donde la distincion existe: se monta con las CUATRO apagadas,
   * asi que una pantalla que solo dibujara lo encendido no tendria ni un
   * interruptor. Y no basta con que esten: se enciende una y se comprueba que
   * el viaje de ida funciona.
   */
  it('las banderas apagadas SE VEN, para poder encenderlas', async () => {
    await montarYEsperar({ web: WEB_SIN_CONFIGURAR });

    expect(casillasDelDocumento()).toHaveLength(4);
    for (const nombre of [PRECIOS, TESTIMONIOS, FAQ, TURNOS_LIBRES]) {
      expect(casilla(nombre)).not.toBeChecked();
    }

    await marcar(TURNOS_LIBRES);
    expect(casilla(TURNOS_LIBRES)).toBeChecked();

    await guardarElFormulario();

    expect(llamada(1)).toEqual({
      ruta: RUTA_DE_LA_WEB,
      metodo: 'PUT',
      cuerpo: {
        activa: false,
        mostrarPrecios: false,
        mostrarTestimonios: false,
        mostrarFAQ: false,
        mostrarTurnosLibres: true,
        colorPrimario: '#000000',
        colorSecundario: '#ffffff',
      },
    });
  });

  /**
   * UNA BANDERA APAGADA VIAJA APAGADA, Y OMITIRLA ENCENDERIA LOS PRECIOS.
   *
   * `WebSalonService.guardar` hace `dto.mostrarPrecios ?? WEB_SALON_POR_DEFECTO
   * .mostrarPrecios`, y ese defecto es **`true`** —leido del service, no
   * deducido—. O sea que el reflejo de «los campos opcionales se omiten cuando
   * estan vacios», aplicado a los booleanos, APAGA tres banderas y ENCIENDE la
   * de los precios: un gimnasio que los tenia ocultos se los encuentra
   * publicados sin tocar nada.
   *
   * Se guarda SIN TOCAR NADA a proposito: lo que se audita es lo que viaja por
   * el solo hecho de pulsar guardar.
   */
  it('una bandera apagada viaja APAGADA: omitirla encenderia los precios', async () => {
    await montarYEsperar({ web: WEB_SIN_CONFIGURAR });

    await guardarElFormulario();

    expect(llamada(1).cuerpo).toEqual({
      activa: false,
      mostrarPrecios: false,
      mostrarTestimonios: false,
      mostrarFAQ: false,
      mostrarTurnosLibres: false,
      colorPrimario: '#000000',
      colorSecundario: '#ffffff',
    });
  });

  /**
   * LOS CAMPOS VACIOS SE OMITEN, NO VIAJAN EN BLANCO.
   *
   * Con el reemplazo completo del `PUT`, omitir es como se BORRA un campo —lo
   * dice `GuardarWebSalonDto`— y mandar `''` en `imagenPrincipalUrl` o en un
   * color seria un 400 (`@IsUrl`, `@IsHexColor`) en vez de un borrado. El
   * `toEqual` del test de arriba ya lo fija por el lado de la ausencia; este lo
   * fija por el lado del borrado deliberado.
   *
   * Y `planDestacadoId` VUELVE TAL CUAL: sin el, guardar el tagline borraria el
   * plan destacado de la landing sin decirselo a nadie.
   */
  it('un campo que se vacia se OMITE, y el plan destacado vuelve tal cual', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await escribirEnElCampo('tagline', '');
    await guardarElFormulario();

    const cuerpo = llamada(1).cuerpo as Record<string, unknown>;

    expect('tagline' in cuerpo).toBe(false);
    expect(cuerpo.planDestacadoId).toBe(ID_DEL_PLAN_DESTACADO);
    expect(cuerpo.tituloPrincipal).toBe('Entrena en Nucleo');
    expect(cuerpo.activa).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El aviso que tiene que estar AL LADO
// ---------------------------------------------------------------------------

describe('la consecuencia de publicar la agenda', () => {
  /**
   * «OJO: publica la agenda del gimnasio y cuan vacia esta», dice el contrato.
   *
   * Un gimnasio con la agenda vacia esta publicando que esta vacio, y eso no se
   * lee en el nombre del interruptor. La consecuencia tiene que estar AL LADO:
   * ni en un `title=` —que no existe en un telefono y que ningun lector de
   * pantalla anuncia solo— ni detras de un «ver mas».
   *
   * COMO SE COMPRUEBA «AL LADO» SIN BUSCAR LA FRASE POR LA PANTALLA: se sigue
   * el `aria-describedby` DEL CONTROL hasta el nodo que lo describe, y se exige
   * que ese nodo sea texto visible del cuerpo. Un `title=` no tiene nodo que
   * seguir y no aparece en el `textContent`.
   *
   * Y el escenario donde la distincion existe son las OTRAS dos banderas: no
   * todas llevan descripcion, asi que una pantalla que le colgara una a
   * cualquier cosa tampoco pasaria.
   */
  it('mostrarTurnosLibres dice su consecuencia AL LADO', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    expect(descripcionDe(TURNOS_LIBRES)).toBe(CONSECUENCIA_DE_LOS_TURNOS_LIBRES);
    expect(document.body.textContent).toContain(CONSECUENCIA_DE_LOS_TURNOS_LIBRES);

    // La otra bandera que publica algo que nadie escribio para publicarse.
    expect(descripcionDe(PRECIOS)).toBe(CONSECUENCIA_DE_LOS_PRECIOS);

    // Y las dos que no la llevan: lo que se publica ahi lo tecleo alguien
    // sabiendo que era para la web.
    expect(descripcionDe(TESTIMONIOS)).toBeNull();
    expect(descripcionDe(FAQ)).toBeNull();
  });

  /**
   * SE DICE IGUAL ENCENDIDA QUE APAGADA, y ese es el caso que importa.
   *
   * El momento en que la consecuencia hace falta es justo ANTES de encender la
   * bandera: un aviso que solo aparezca cuando ya esta encendida llega tarde.
   *
   * ⚠️ Y SE AFIRMA MONTANDO DOS VECES, no buscando una frase. Los dos montajes
   * se diferencian SOLO en esa bandera, y el texto del cuerpo tiene que ser
   * IDENTICO: eso mata cualquier cartel, nota o parentesis que aparezca en uno
   * y no en el otro, lo diga como lo diga y este donde este.
   */
  it('y la dice igual este encendida o apagada', async () => {
    const limpio = (texto: string) => texto.replace(/\s+/g, ' ').trim();

    await montarYEsperar({ web: { ...WEB_COMPLETA, mostrarTurnosLibres: false } });
    const conLaAgendaOculta = limpio(document.body.textContent ?? '');

    cleanupEntreMontajes();

    await montarYEsperar({ web: { ...WEB_COMPLETA, mostrarTurnosLibres: true } });
    const conLaAgendaPublicada = limpio(document.body.textContent ?? '');

    // La premisa: los dos montajes dibujaron algo. Sin esto, una pantalla que
    // no pintara nada pasaria en verde comparando '' contra ''.
    expect(conLaAgendaOculta).toContain(CONSECUENCIA_DE_LOS_TURNOS_LIBRES);
    expect(conLaAgendaOculta).toBe(conLaAgendaPublicada);
  });
});

// ---------------------------------------------------------------------------
// El interruptor maestro
// ---------------------------------------------------------------------------

describe('apagar la web publica', () => {
  /**
   * LA CONFIRMACION DICE QUE DEJA DE VERSE, NO «¿ESTAS SEGURO?».
   *
   * Apagar `activa` tira abajo el sitio entero: el endpoint publico pasa a dar
   * el mismo 404 que un slug inexistente. Quien lo apaga tiene que leer QUE se
   * deja de ver, y no una pregunta que no nombra nada.
   *
   * Tres cosas, y ninguna sobra:
   *  1. Pulsar NO manda nada todavia —con esta sola, un dialogo que no dijera
   *     nada pasaria igual—.
   *  2. El dialogo dice exactamente eso, por igualdad sobre sus parrafos.
   *  3. Y confirmar SI manda el `PUT`, con `activa: false` —sin esta, un boton
   *     que abriera un dialogo y no hiciera nada pasaria—.
   */
  it('apagar la web confirma diciendo QUE deja de verse', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await pulsar('Apagar la web publica');

    expect(escrituras()).toEqual([]);
    expect(parrafosDelDialogo()).toEqual([PREGUNTA_DE_APAGAR, DETALLE_DE_APAGAR]);

    await pulsar('Apagar la web');

    expect(llamada(1)).toEqual({
      ruta: RUTA_DE_LA_WEB,
      metodo: 'PUT',
      cuerpo: {
        activa: false,
        mostrarPrecios: true,
        mostrarTestimonios: false,
        mostrarFAQ: true,
        mostrarTurnosLibres: false,
        colorPrimario: '#1d4ed8',
        colorSecundario: '#f8fafc',
        tituloPrincipal: 'Entrena en Nucleo',
        tagline: TAGLINE,
        sobreElSalon: 'Un galpon reciclado con ocho estaciones y dos profesoras.',
        imagenPrincipalUrl: 'https://cdn.ejemplo.com/portada.jpg',
        whatsapp: '+54 11 5555 0000',
        instagram: '@nucleo.box',
        linkExtra: 'https://nucleo.ejemplo.com/horarios',
        planDestacadoId: ID_DEL_PLAN_DESTACADO,
      },
    });
  });

  /**
   * LO QUE EL DIALOGO ENUMERA ES LO QUE ESTA ENCENDIDO DE VERDAD.
   *
   * `WEB_COMPLETA` tiene los precios y las preguntas encendidos y los
   * testimonios y los turnos APAGADOS. Una lista escrita a mano —«dejan de
   * verse los precios, los testimonios, las preguntas y los turnos»— seria una
   * frase FALSA dentro del dialogo que decide si se apaga el sitio, y pasaria
   * el test de arriba si el fixture tuviera todo encendido.
   *
   * Por eso el par: el mismo dialogo, con las cuatro banderas encendidas, dice
   * otra cosa.
   */
  it('y enumera solo lo que hoy esta encendido', async () => {
    await montarYEsperar({
      web: {
        ...WEB_COMPLETA,
        mostrarPrecios: true,
        mostrarTestimonios: true,
        mostrarFAQ: true,
        mostrarTurnosLibres: true,
      },
    });

    await pulsar('Apagar la web publica');

    expect(parrafosDelDialogo()).toEqual([
      PREGUNTA_DE_APAGAR,
      DETALLE_DE_APAGAR_CON_TODO_ENCENDIDO,
    ]);
  });

  /** Cancelar no manda nada, y el dialogo se va. */
  it('cancelar no manda nada', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await pulsar('Apagar la web publica');
    await pulsar('Cancelar');

    expect(parrafosDelDialogo()).toEqual([]);
    expect(escrituras()).toEqual([]);
  });

  /**
   * ENCENDERLA NO PREGUNTA, Y ESE ES EL ESCENARIO DONDE LA DISTINCION EXISTE.
   *
   * Sin esta mitad, «apagar confirma» se cumpliria tambien en una pantalla que
   * preguntara SIEMPRE, por cualquier cosa — que es como se enseña a confirmar
   * sin leer. Encender es el movimiento reversible y el que la persona vino a
   * hacer.
   */
  it('encenderla no pregunta: el dialogo es solo para apagar', async () => {
    await montarYEsperar({ web: WEB_SIN_CONFIGURAR });

    await pulsar('Encender la web publica');

    expect(parrafosDelDialogo()).toEqual([]);
    expect(llamada(1).metodo).toBe('PUT');
    expect((llamada(1).cuerpo as Record<string, unknown>).activa).toBe(true);
  });

  /** Lo que falla al apagar se pinta DENTRO del dialogo, no detras. */
  it('si el apagado falla, el motivo se pinta dentro del dialogo', async () => {
    await montarYEsperar({
      web: WEB_COMPLETA,
      falloAlGuardar: new ErrorDeApi(MENSAJE_DE_LA_API, 503),
    });

    await pulsar('Apagar la web publica');
    await pulsar('Apagar la web');

    expect(textoDe('[role="dialog"]')).toContain(MENSAJE_DE_LA_API);
    expect(textoDe('[data-resultado="exito"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Los testimonios
// ---------------------------------------------------------------------------

describe('los testimonios', () => {
  /**
   * EL ALTA ES UN `POST` PROPIO Y NO DEPENDE DEL `PUT` GENERAL.
   *
   * `CrearTestimonioDto` declara `nombre`, `texto` y un `orden` opcional, y la
   * API corre con `forbidNonWhitelisted`: un `tagline` de mas en el cuerpo
   * convierte un alta valida en un 400. Por eso el cuerpo se afirma ENTERO con
   * `toEqual` y no campo a campo.
   *
   * Y la lista de peticiones tambien por igualdad: no hay ningun `PUT` por el
   * medio. Las dos afirmaciones hacen falta —un `PUT` de mas no se ve en el
   * cuerpo del `POST`—.
   */
  it('un testimonio se da de alta sin tocar el resto del formulario', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await escribirEnElCampo('testimonio-nombre', 'Ana Quiroga');
    await escribirEnElCampo('testimonio-texto', 'Vengo hace dos años y no falte una semana.');
    await escribirEnElCampo('testimonio-orden', '7');
    await pulsar('Agregar el testimonio');

    expect(llamada(1)).toEqual({
      ruta: RUTA_DE_LOS_TESTIMONIOS,
      metodo: 'POST',
      cuerpo: {
        nombre: 'Ana Quiroga',
        texto: 'Vengo hace dos años y no falte una semana.',
        orden: 7,
      },
    });

    // La lista entera: la lectura, el alta, y la relectura que dispara la
    // invalidacion. Ni un `PUT` ni una ruta de mas.
    expect(rutasPedidas()).toEqual([
      `GET ${RUTA_DE_LA_WEB}`,
      `POST ${RUTA_DE_LOS_TESTIMONIOS}`,
      `GET ${RUTA_DE_LA_WEB}`,
    ]);
  });

  /** El orden vacio se OMITE: mandar un cero seria elegir por quien no eligio. */
  it('el orden vacio se omite del cuerpo', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await escribirEnElCampo('testimonio-nombre', 'Ana Quiroga');
    await escribirEnElCampo('testimonio-texto', 'Vengo hace dos años.');
    await pulsar('Agregar el testimonio');

    expect(llamada(1).cuerpo).toEqual({ nombre: 'Ana Quiroga', texto: 'Vengo hace dos años.' });
  });

  /**
   * BORRA EL DE ESA FILA, Y POR ESO HAY DOS SEMBRADOS.
   *
   * Con un solo testimonio en la lista, «manda el id de la fila» y «manda el id
   * del primero» son exactamente la misma llamada y el test no podria fallar.
   * Se pulsa el de la SEGUNDA fila, que es el que un `testimonios[0].id`
   * delata.
   *
   * El id va en la RUTA y se afirma la ruta entera por igualdad: un
   * `toContain(ID)` pasaria en verde sobre cualquier ruta que lo llevara
   * dentro, incluida una mal armada.
   */
  it('borra el testimonio DE ESA FILA, con dos sembrados', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    expect(textosDe('[data-fila="testimonio"] [data-campo="nombre"]')).toEqual([
      NOMBRE_DEL_PRIMER_TESTIMONIO,
      NOMBRE_DEL_SEGUNDO_TESTIMONIO,
    ]);

    await pulsar(`Borrar el testimonio de ${NOMBRE_DEL_SEGUNDO_TESTIMONIO}`);

    expect(llamada(1)).toEqual({
      ruta: `${RUTA_DE_LOS_TESTIMONIOS}/${ID_DEL_SEGUNDO_TESTIMONIO}`,
      metodo: 'DELETE',
      cuerpo: undefined,
    });
  });

  /** Un borrado que falla dice el motivo y la fila sigue estando. */
  it('si el borrado falla, lo dice y la fila sigue ahi', async () => {
    await montarYEsperar({
      web: WEB_COMPLETA,
      falloEnLasListas: new ErrorDeApi(MENSAJE_DE_LA_API, 503),
    });

    await pulsar(`Borrar el testimonio de ${NOMBRE_DEL_PRIMER_TESTIMONIO}`);

    expect(textoDe('[data-fallo="borrar-testimonio"]')).toBe(
      `No se pudo borrar el testimonio: ${MENSAJE_DE_LA_API}`,
    );
    expect(textosDe('[data-fila="testimonio"] [data-campo="nombre"]')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Las preguntas, y que las dos listas no se pisan
// ---------------------------------------------------------------------------

describe('las preguntas frecuentes', () => {
  /**
   * LO MISMO QUE LOS TESTIMONIOS, Y LAS DOS LISTAS NO SE PISAN.
   *
   * Las dos listas estan sembradas con DOS filas cada una y con ids que no se
   * parecen (`tst-…` y `faq-…`). Con una sola lista sembrada, «borra de la
   * suya» y «borra de la primera» serian indistinguibles; con ids parecidos,
   * borrar de la lista equivocada mandaria algo que igual existe.
   *
   * Se pulsa la SEGUNDA fila de la SEGUNDA lista: la combinacion que delata a
   * la vez el `[0]` y la lista cruzada.
   */
  it('lo mismo con las preguntas, y las dos listas no se pisan', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await pulsar(`Borrar la pregunta: ${LA_SEGUNDA_PREGUNTA}`);

    expect(llamada(1)).toEqual({
      ruta: `${RUTA_DE_LAS_PREGUNTAS}/${ID_DE_LA_SEGUNDA_PREGUNTA}`,
      metodo: 'DELETE',
      cuerpo: undefined,
    });

    // Y el alta va a SU endpoint, con SUS campos: `CrearFaqDto` declara
    // `pregunta` y `respuesta`, no `nombre` y `texto`.
    await escribirEnElCampo('pregunta-pregunta', 'Hay duchas?');
    await escribirEnElCampo('pregunta-respuesta', 'Si, cuatro, con agua caliente todo el dia.');
    await pulsar('Agregar la pregunta');

    expect(llamada(3)).toEqual({
      ruta: RUTA_DE_LAS_PREGUNTAS,
      metodo: 'POST',
      cuerpo: { pregunta: 'Hay duchas?', respuesta: 'Si, cuatro, con agua caliente todo el dia.' },
    });

    // Ni una sola peticion toco la ruta de los testimonios.
    expect(rutasPedidas().filter((linea) => linea.includes('testimonios'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lo que un alta NO se puede llevar por delante
// ---------------------------------------------------------------------------

/**
 * EL ALTA DE UNA LISTA REFRESCA LA CONSULTA DEL FORMULARIO GRANDE.
 *
 * Las SEIS escrituras invalidan la misma clave `['config','web-salon']`, porque
 * `ConfiguracionWebSalon` lleva `testimonios` y `preguntas` DENTRO y no hay un
 * `GET /config/web-salon/testimonios` al que apuntar. O sea que dar de alta un
 * testimonio trae datos nuevos del servidor para el formulario de arriba.
 *
 * El escenario donde la distincion existe: la relectura devuelve un tagline
 * DISTINTO del que se tecleo. Si el borrador soltara el mando —o si alguien
 * sembrara el estado con un `useEffect` al llegar la respuesta— el campo
 * cambiaria solo delante de quien estaba escribiendo. Con la relectura
 * devolviendo lo mismo, el test no podria fallar.
 */
describe('un alta no pisa lo que se estaba escribiendo', () => {
  it('el alta de una lista no pierde lo que el formulario tenia a medio escribir', async () => {
    const TAGLINE_DEL_SERVIDOR = 'Otro tagline, escrito desde otra pestaña';

    await montarYEsperar({
      web: WEB_COMPLETA,
      webDespues: {
        ...WEB_COMPLETA,
        tagline: TAGLINE_DEL_SERVIDOR,
        testimonios: [
          ...WEB_COMPLETA.testimonios,
          { id: 'tst-00ffaa11', nombre: 'Ana Quiroga', texto: 'Recien llegada.', orden: 30 },
        ],
      },
    });

    await escribirEnElCampo('tagline', 'A medio escribir');
    await escribirEnElCampo('pregunta-pregunta', 'Hay duchas?');

    await escribirEnElCampo('testimonio-nombre', 'Ana Quiroga');
    await escribirEnElCampo('testimonio-texto', 'Recien llegada.');
    await pulsar('Agregar el testimonio');

    // La PREMISA: la relectura llego de verdad y traia algo distinto. Sin
    // esto, el test pasaria tambien si nunca hubiera habido refresco.
    expect(textosDe('[data-fila="testimonio"] [data-campo="nombre"]')).toHaveLength(3);

    // Lo que importa: el formulario grande sigue con lo tecleado y NO con lo
    // que acaba de llegar del servidor.
    expect(valorDelCampo('tagline')).toBe('A medio escribir');

    // Y la otra lista tampoco perdio lo suyo.
    expect(valorDelCampo('pregunta-pregunta')).toBe('Hay duchas?');

    // La que SI se limpia es la que se acaba de dar de alta: dejarla llena
    // invita a mandar el mismo testimonio dos veces.
    expect(valorDelCampo('testimonio-nombre')).toBe('');
    expect(valorDelCampo('testimonio-texto')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Cuando la lectura falla
// ---------------------------------------------------------------------------

describe('cuando no se puede leer la configuracion', () => {
  /**
   * UN FALLO AL LEER NO SE PARECE A UNA WEB SIN CONFIGURAR.
   *
   * Es el 404-pintado-como-dato-vacio de la Fase 10, y aqui la forma vacia es
   * PLAUSIBLE: un gimnasio que nunca toco la web tiene exactamente eso —la web
   * apagada, los textos en blanco y las dos listas sin nada—. Peor que
   * confundir: el formulario seguiria ahi, y guardarlo escribiria esos blancos
   * ENCIMA de lo que si hay, porque el `PUT` es un reemplazo completo.
   *
   * La otra mitad del par esta en el test de abajo: una web sin configurar DE
   * VERDAD si se dibuja, y se dibuja distinto. Sin ese par, «no hay
   * formulario» se cumpliria pintando nada nunca.
   */
  it('un fallo al leer no se parece a una web sin configurar', async () => {
    await montarYEsperar({ falloAlLeer: new ErrorDeApi(MENSAJE_DE_LA_API, 503) });

    expect(textoDe('[data-fallo="lectura"]')).toBe(
      `No se pudo leer la configuracion de la web: ${MENSAJE_DE_LA_API}`,
    );

    // Ni estado, ni banderas, ni listas, ni un boton que guarde blancos.
    expect(textoDe('[data-estado]')).toBeNull();
    expect(casillasDelDocumento()).toEqual([]);
    expect(botonesDelDocumento()).toEqual([]);
    expect(enlacesDelDocumento()).toEqual([]);
    expect(textoDe('[data-lista="testimonios"]')).toBeNull();
    expect(textoDe('[data-lista="preguntas"]')).toBeNull();
    expect(textoDe('[data-vacio="testimonios"]')).toBeNull();
    expect(valorDelCampo('tagline')).toBeNull();
  });

  /** La otra mitad: una web sin configurar de verdad SI se dibuja. */
  it('y una web sin configurar de verdad si se dibuja', async () => {
    await montarYEsperar({ web: WEB_SIN_CONFIGURAR });

    expect(textoDe('[data-fallo="lectura"]')).toBeNull();
    expect(textoDe('[data-estado]')).toBe(ESTADO_APAGADA);
    expect(casillasDelDocumento()).toHaveLength(4);
    expect(textoDe('[data-vacio="testimonios"]')).toBe('Todavia no hay ningun testimonio cargado.');
    expect(textoDe('[data-vacio="preguntas"]')).toBe('Todavia no hay ninguna pregunta cargada.');
    expect(valorDelCampo('tagline')).toBe('');
  });

  /** Y con la web encendida se dice eso, que es lo tercero y distinto. */
  it('con la web encendida el estado lo dice', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    expect(textoDe('[data-estado]')).toBe(ESTADO_ENCENDIDA);
  });
});

// ---------------------------------------------------------------------------
// Guardar el formulario
// ---------------------------------------------------------------------------

describe('guardar el formulario', () => {
  it('un fallo al guardar no se parece a un exito', async () => {
    await montarYEsperar({
      web: WEB_COMPLETA,
      falloAlGuardar: new ErrorDeApi(MENSAJE_DE_LA_API, 503),
    });

    await escribirEnElCampo('tagline', 'Otra cosa');
    await guardarElFormulario();

    expect(textoDe('[data-resultado="exito"]')).toBeNull();
    expect(textoDe('[data-resultado="error"]')).toBe(
      `No se pudo guardar la web: ${MENSAJE_DE_LA_API}`,
    );
  });

  it('y un guardado bueno lo dice', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await escribirEnElCampo('tagline', 'Otra cosa');
    await guardarElFormulario();

    expect(textoDe('[data-resultado="error"]')).toBeNull();
    expect(textoDe('[data-resultado="exito"]')).toBe('Cambios guardados.');
  });
});

// ---------------------------------------------------------------------------
// La puerta de rol
// ---------------------------------------------------------------------------

describe('la puerta de rol', () => {
  /**
   * PARA UN OPERATIVO NO HAY MARCADO Y NO HAY NINGUNA DE LAS SEIS PETICIONES.
   *
   * La puerta va ANTES de los hooks y en un componente aparte: no montar la
   * pantalla es no tener las consultas. Un `enabled: false` dejaria la peticion
   * escrita y a un refactor de distancia de salir, y un `hidden` dejaria el
   * marcado legible desde el inspector — y en verde para cualquier test que use
   * `*ByRole`, porque el arbol de accesibilidad ya excluye lo oculto.
   */
  it('un ADMIN_OPERATIVO no tiene nada en el marcado, ni pide nada', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    // Se pulsa PRIMERO y se afirma despues: con la afirmacion del marcado
    // delante, el test abortaria ahi y la mitad de «no pide» no se ejercitaria.
    for (const boton of botonesDelDocumento()) fireEvent.click(boton);
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(enlacesDelDocumento()).toEqual([]);
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /** FALLA CERRADA: sin proveedor no hay rol, y eso no alcanza para nada. */
  it('sin proveedor de rol tampoco se dibuja', async () => {
    montar({ rol: null });
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * `rolAlcanza` ES UNA JERARQUIA: un `rol === 'ADMIN_SALON'` dejaria al
   * superadmin fuera de su propio sistema y pasaria todos los demas tests.
   */
  it('un SUPERADMIN entra, porque la puerta es una jerarquia', async () => {
    await montarYEsperar({ rol: 'SUPERADMIN', web: WEB_COMPLETA });

    expect(rutasPedidas()).toEqual([`GET ${RUTA_DE_LA_WEB}`]);
    expect(casillasDelDocumento()).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// La URL del documento
// ---------------------------------------------------------------------------

/**
 * El canal trece ya lo tapa `vitest.setup.ts` para todos los specs; esto es el
 * caso concreto de esta pantalla, que es la que tiene nombres de personas y lo
 * ancho del contrato en la mano.
 */
describe('lo que la pantalla NO escribe en la URL', () => {
  const URL_AL_EMPEZAR = window.location.href;

  it('la URL del documento queda como estaba', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    await escribirEnElCampo('tagline', 'Otra cosa');
    await guardarElFormulario();
    await pulsar(`Borrar el testimonio de ${NOMBRE_DEL_PRIMER_TESTIMONIO}`);

    expect(window.location.href).toBe(URL_AL_EMPEZAR);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});

// ---------------------------------------------------------------------------
// EL EJE CATORCE: LOS ATRIBUTOS DE LO QUE HAY DENTRO DEL `<body>`
// ---------------------------------------------------------------------------

/**
 * EL HUECO ENTRE LAS DOS DEFENSAS, OTRA VEZ, UN NIVEL MAS ADENTRO.
 *
 * Los trece tapones globales miran todo lo que NO es el cuerpo, y entre ellos
 * los atributos del `<html>` y del `<body>` —`atributosDe(document.
 * documentElement)` y `atributosDe(document.body)`, los DOS ELEMENTOS, no sus
 * descendientes—. Los tests de pantalla miran el TEXTO del cuerpo
 * (`textContent`, `screen.*`) y la lista de peticiones.
 *
 * LOS ATRIBUTOS DE LO QUE HAY DENTRO DEL CUERPO NO CAEN EN NINGUNO DE LOS DOS
 * LADOS. `textContent` no los ve —ni el `href` de un enlace, ni un `data-`, ni
 * un `aria-`—, el tapon de los atributos no baja de `<body>`, y jsdom los
 * implementa enteros: la linea corre igual en el test y en el navegador.
 *
 * Y ESTA PANTALLA ES EXACTAMENTE DONDE DUELE. `ConfiguracionWebSalon` es
 * deliberadamente MAS ANCHA que `SalonPublico`: lleva los ids de las filas y el
 * `planDestacadoId`, y el contrato dice que «nada de esto sale por el endpoint
 * sin sesion». Un enlace de cortesia a la web publica —«ver como queda»— con la
 * configuracion serializada en la query seria lo ancho viajando a lo angosto
 * por el unico sitio que nadie mira; y la URL de ese enlace acaba en el
 * historial, en el portapapeles y en el `Referer` del primer clic.
 *
 * MEDIDO, no supuesto: con un
 * `href={`/${slug}?vista=${encodeURIComponent(JSON.stringify(web))}`}` en el
 * enlace de abajo —la configuracion ENTERA, ids incluidos, en la query— pasan
 * 26 de los 28 tests de este archivo y los trece tapones globales sin
 * despeinarse. Los dos que caen son los dos de aqui.
 *
 * ESTO DEBERIA SER EL EJE CATORCE de `vigilarLosCanalesDeSalida()` —es una
 * DIMENSION y no un caso, igual que lo fue la URL—. Vive aqui porque los
 * archivos compartidos no son de esta tarea.
 */
describe('lo que la pantalla NO escribe en los atributos del marcado', () => {
  /** Lo ANCHO del contrato: lo que `SalonPublico` no lleva. */
  const LO_QUE_NO_SALE_SIN_SESION = [
    ID_DEL_PRIMER_TESTIMONIO,
    ID_DEL_SEGUNDO_TESTIMONIO,
    ID_DE_LA_PRIMERA_PREGUNTA,
    ID_DE_LA_SEGUNDA_PREGUNTA,
    ID_DEL_PLAN_DESTACADO,
  ];

  it('ningun id del contrato ancho viaja en un atributo', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    // Se ejercita la pantalla entera antes de mirar: el dialogo abierto, el
    // formulario tocado y las dos listas con texto escrito.
    await escribirEnElCampo('tagline', 'A medio escribir');
    await escribirEnElCampo('testimonio-nombre', 'Ana Quiroga');
    await pulsar('Apagar la web publica');

    const atributos = atributosDeDentroDelCuerpo();

    // La PREMISA: hay atributos de sobra que mirar. Un barrido sobre una
    // pantalla vacia no puede fallar.
    expect(atributos.length).toBeGreaterThan(50);

    for (const dato of LO_QUE_NO_SALE_SIN_SESION) {
      expect(atributos.filter((atributo) => atributo.includes(dato))).toEqual([]);
    }
  });

  /**
   * Y EL UNICO ENLACE DE LA PANTALLA ES `/{slug}` PELADO.
   *
   * Por igualdad y no con un `not.toContain`: un dato de mas de CUALQUIER otra
   * forma —en un fragmento, en otro parametro, en un segundo enlace— tambien
   * tiene que caerse. Y el enlace existe de verdad, asi que el eje no es
   * teorico: hay un `href` que se puede ensanchar.
   */
  it('el enlace a la web publica es la direccion y nada mas', async () => {
    await montarYEsperar({ web: WEB_COMPLETA });

    expect(enlacesDelDocumento()).toEqual([['Ver la web publica', '/mi-gym']]);
  });

  /** Con la web apagada no se ofrece: llevaria al 404 que ella misma provoca. */
  it('y con la web apagada no se ofrece', async () => {
    await montarYEsperar({ web: WEB_SIN_CONFIGURAR });

    expect(enlacesDelDocumento()).toEqual([]);
  });
});
