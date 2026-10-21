import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlantillaPublica, TipoPlantilla } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { LasPlantillas } from './plantillas';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

/**
 * Se dobla `pedir`, y NADA MAS QUE `pedir`.
 *
 * Que `pedir` arme la URL y que `useGuardarPlantilla` saque el `tipo` del
 * cuerpo y lo ponga en la ruta ya lo fija `use-configuracion.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE dibuja esta pantalla, de donde
 * saca la lista de marcadores, donde mete el HTML ajeno y que manda al guardar.
 *
 * `ErrorDeApi` se deja REAL: es lo que `pedir` rechaza de verdad y lo que la
 * pantalla pinta.
 *
 * NO SE INSTALA NINGUN OTRO DOBLE. Todo lo que vigilan los trece tapones
 * globales y los dos ejes —consola, titulo, `window.name`, el `<head>`, los
 * cinco almacenes, User Timing, el `src` de una imagen, las tres salidas
 * laterales, el service worker, los atributos del `<html>` y del `<body>`, la
 * URL, el rato libre y la salida de la pestaña— se deja como esta: un doble
 * local tapa al tapon global EN ESTE ARCHIVO, que es como un spec de la Fase 9
 * paso 24 de 25 tests con una fuga delante.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/** Las dos rutas, escritas a mano: son el contrato, no lo que diga el hook. */
const RUTA_DE_LAS_PLANTILLAS = '/config/plantillas';
const rutaDeUnTipo = (tipo: TipoPlantilla): string => `${RUTA_DE_LAS_PLANTILLAS}/${tipo}`;

/**
 * LO QUE ESTA PANTALLA TIENE EN LA MANO.
 *
 * El cuerpo y el asunto de una plantilla NO son un secreto —vuelven enteros en
 * cada `GET` y la pantalla los dibuja—, pero sí son contenido del gimnasio, y
 * los trece tapones existen para que lo que esta pantalla toque no salga por un
 * canal que ningun test de marcado mira. El `data-de-la-plantilla` es ademas el
 * centinela del test de inyeccion.
 *
 * Son cadenas largas y distintivas a proposito: un centinela corto es
 * subcadena de cualquier clase de Tailwind y daria falsos positivos en los
 * trece ejes a la vez.
 */
const CENTINELAS = {
  cuerpoDeLaPlantilla: 'cuerpo-centinela-de-la-plantilla-9041',
  asuntoDeLaPlantilla: 'asunto-centinela-de-la-plantilla-9041',
};

vigilarEstosDatos(CENTINELAS);

/**
 * LAS CINCO PLANTILLAS POR DEFECTO, COPIADAS DE `apps/api/src/comunicacion/plantillas.ts`.
 *
 * ⚠️ ESTA COPIA NO CONTRADICE NADA DE LO QUE LA PANTALLA EVITA. La pantalla no
 * lleva ninguna lista de marcadores escrita: los extrae del texto que manda la
 * API, que es `plantillas.ts` viajando por el cable. Lo que hay aqui es un FIJO
 * DE TEST que hace de API, igual que `SMTP` hace de `ConfiguracionSmtpPublica`
 * en el spec de al lado. Si mañana alguien le agrega un `{{hora}}` al texto por
 * defecto de `VENCIMIENTO_PACK`, este fijo se queda viejo y no pasa nada: lo
 * que mide es que la pantalla saca la lista DEL TEXTO QUE LE DAN, y eso sigue
 * siendo verdad con el texto que sea.
 *
 * Se copian las de verdad y no unas inventadas porque los TRES tipos que se
 * afirman tienen tres listas de marcadores DISTINTAS, y es eso lo que convierte
 * «lista los marcadores» en «los de ESE tipo».
 */
const PLANTILLAS_POR_DEFECTO: Record<TipoPlantilla, { asunto: string; cuerpoHtml: string }> = {
  CONFIRMACION: {
    asunto: 'Reservaste {{clase}} para el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Te reservamos <strong>{{clase}}</strong> el {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  CANCELACION: {
    asunto: 'Cancelaste {{clase}} del {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Cancelamos tu lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}}.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  RECORDATORIO_PAGO: {
    asunto: 'Tenés un pago pendiente en {{gimnasio}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Nos figura un pago pendiente. Si ya lo hiciste, subí el comprobante desde la ' +
      'app y lo revisamos.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  LISTA_ESPERA: {
    asunto: 'Se liberó un lugar en {{clase}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Se liberó un lugar en <strong>{{clase}}</strong> del {{fecha}} a las {{hora}} ' +
      'y te lo asignamos. Ya no estás en la lista de espera.</p>' +
      '<p>{{gimnasio}}</p>',
  },
  VENCIMIENTO_PACK: {
    asunto: 'Tu pack vence el {{fecha}}',
    cuerpoHtml:
      '<p>Hola {{alumno}},</p>' +
      '<p>Después del {{fecha}} no vas a poder reservar hasta que lo renueves. ' +
      'Pasá por el gimnasio o escribinos y lo dejamos listo.</p>' +
      '<p>{{gimnasio}}</p>',
  },
};

/** El orden en el que `listarPlantillas()` las devuelve (`TIPOS_DE_PLANTILLA`). */
const LOS_CINCO_TIPOS: TipoPlantilla[] = [
  'CONFIRMACION',
  'CANCELACION',
  'RECORDATORIO_PAGO',
  'LISTA_ESPERA',
  'VENCIMIENTO_PACK',
];

/** Las cinco por defecto, como las manda un gimnasio que no toco ninguna. */
function lasCincoPorDefecto(): PlantillaPublica[] {
  return LOS_CINCO_TIPOS.map((tipo) => ({
    tipo,
    ...PLANTILLAS_POR_DEFECTO[tipo],
    esPorDefecto: true,
  }));
}

/**
 * DOS ERRORES DE HANDLEBARS DE VERDAD, de los que devuelve
 * `motivoDePlantillaInvalida` y que la API empaqueta en un 400 con
 * `La plantilla no es valida: ${motivo}`.
 *
 * SON DOS Y NO UNO porque es la unica forma de que «se muestra el motivo de la
 * API» tenga dientes: con uno solo, una pantalla que lo tuviera escrito a mano
 * pasaria en verde.
 */
const MOTIVOS_DE_LA_API = [
  "La plantilla no es valida: Parse error on line 1:\n{{#if x}}sin cerrar\n--^\nExpecting 'OPEN_INVERSE_CHAIN', 'INVERSE', 'OPEN_ENDBLOCK', got 'EOF'",
  "La plantilla no es valida: Parse error on line 1:\n{{alumno\n--^\nExpecting 'CLOSE', got 'INVALID'",
];

interface OpcionesDeMontaje {
  /** Lo que contesta `GET /config/plantillas`. */
  plantillas?: PlantillaPublica[];
  /** Si se pasa, la LECTURA falla con esto en vez de contestar. */
  falloAlLeer?: ErrorDeApi;
  /** Si se pasa, CUALQUIER `PUT` falla con esto en vez de escribir. */
  falloAlGuardar?: ErrorDeApi;
}

/**
 * EL DOBLE GUARDA DE VERDAD, Y NO ES UN LUJO.
 *
 * Guardar una plantilla invalida `['config', 'plantillas']` y la consulta se
 * vuelve a pedir: si el `GET` de despues contestara el fijo original, la
 * pantalla volveria a dibujar lo de antes y «guardar una no toca las otras
 * cuatro» pasaria en verde incluso con un servidor que las pisara todas. Con un
 * almacen que escribe lo que recibe, lo que se mide es el ESTADO DESPUES, que
 * es donde el daño se ve.
 */
let almacen: PlantillaPublica[] = [];

function montar({
  plantillas = lasCincoPorDefecto(),
  falloAlLeer,
  falloAlGuardar,
}: OpcionesDeMontaje = {}) {
  almacen = plantillas.map((plantilla) => ({ ...plantilla }));

  pedirEspia.mockImplementation(
    (ruta: string, opciones?: { metodo?: string; cuerpo?: unknown }) => {
      if (ruta === RUTA_DE_LAS_PLANTILLAS && opciones?.metodo === undefined) {
        return falloAlLeer === undefined
          ? // Copias: asi la pantalla no puede quedar en verde mutando el fijo.
            Promise.resolve(almacen.map((plantilla) => ({ ...plantilla })))
          : Promise.reject(falloAlLeer);
      }

      const prefijo = `${RUTA_DE_LAS_PLANTILLAS}/`;
      if (ruta.startsWith(prefijo) && opciones?.metodo === 'PUT') {
        if (falloAlGuardar !== undefined) return Promise.reject(falloAlGuardar);

        const tipo = ruta.slice(prefijo.length) as TipoPlantilla;
        const cuerpo = opciones.cuerpo as { asunto: string; cuerpoHtml: string };

        // Como el service: escribe SOLO esa fila y devuelve `esPorDefecto: false`.
        const guardada: PlantillaPublica = { tipo, ...cuerpo, esPorDefecto: false };
        almacen = almacen.map((plantilla) => (plantilla.tipo === tipo ? guardada : plantilla));

        return Promise.resolve(guardada);
      }

      throw new Error(
        `La pantalla pidio una ruta que nadie espera: ${opciones?.metodo ?? 'GET'} ${ruta}`,
      );
    },
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  /**
   * SE MONTA `LasPlantillas` SOLA Y NO LA PAGINA ENTERA.
   *
   * Es la unidad: no mira el rol ni toca el SMTP. La PUERTA —que un
   * `ADMIN_OPERATIVO` no ve nada de esta pantalla— vive en `PaginaDelEmail` y
   * la fija `page.spec.tsx`, que la monta entera; repetirla aqui mediria el
   * mismo `if` dos veces y obligaria a doblar ademas el `GET /config/smtp`.
   */
  render(
    <QueryClientProvider client={cliente}>
      <LasPlantillas />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que la consulta y la mutacion se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}) {
  const cliente = montar(opciones);
  await esperar();
  return cliente;
}

/** Desmonta para poder montar otra vez DENTRO del mismo test. */
function cleanupEntreMontajes(): void {
  cleanup();
  pedirEspia.mockReset();
}

/** El bloque de un tipo. Lanza si no esta: un `null` silencioso da verdes. */
function articuloDe(tipo: TipoPlantilla): HTMLElement {
  const nodo = document.querySelector<HTMLElement>(`[data-plantilla="${tipo}"]`);
  if (nodo === null) throw new Error(`No hay ningun bloque para ${tipo}`);
  return nodo;
}

/** El texto de un nodo de ESE bloque, con los espacios normalizados. */
function textoDe(tipo: TipoPlantilla, selector: string): string | null {
  const nodo = articuloDe(tipo).querySelector(selector);
  if (nodo === null) return null;

  // El colapso de espacios es por el FORMATO del JSX —los saltos de linea del
  // archivo acaban en el texto—, no una rebaja: lo que se compara sigue siendo
  // el contenido entero y por igualdad.
  return (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
}

const asuntoDe = (tipo: TipoPlantilla): string =>
  (articuloDe(tipo).querySelector<HTMLInputElement>(`#asunto-${tipo}`) as HTMLInputElement).value;

const cuerpoDe = (tipo: TipoPlantilla): string =>
  (articuloDe(tipo).querySelector<HTMLTextAreaElement>(`#cuerpo-${tipo}`) as HTMLTextAreaElement)
    .value;

const marcoDe = (tipo: TipoPlantilla): Element => {
  const marco = articuloDe(tipo).querySelector('[data-previsualizacion="cuerpo"]');
  if (marco === null) throw new Error(`No hay previsualizacion para ${tipo}`);
  return marco;
};

const botonDe = (tipo: TipoPlantilla): HTMLButtonElement => {
  const boton = articuloDe(tipo).querySelector('button');
  if (boton === null) throw new Error(`No hay boton de guardar para ${tipo}`);
  return boton as HTMLButtonElement;
};

/** Los marcadores que ese bloque lista, por sus atributos propios. */
function marcadoresListadosDe(tipo: TipoPlantilla): string[] {
  return [...articuloDe(tipo).querySelectorAll('[data-marcador]')].map(
    (nodo) => nodo.getAttribute('data-marcador') ?? '',
  );
}

/**
 * Escribe en un campo con `fireEvent.change` y no con `userEvent.type`.
 *
 * ⚠️ NO ES COMODIDAD: `userEvent.type` interpreta las llaves. `{` abre un
 * descriptor de tecla —`{Enter}`, `{Shift}`— y `{{` es su forma de escapar una
 * llave literal, asi que teclear `{{alumno}}` con `type` escribe otra cosa, que
 * es precisamente el caracter sobre el que gira esta pantalla entera. Con
 * `change` lo que llega al `onChange` es el texto tal cual.
 */
function escribir(selector: string, valor: string): void {
  const campo = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (campo === null) throw new Error(`No hay ningun campo ${selector}`);
  fireEvent.change(campo, { target: { value: valor } });
}

async function pulsarGuardar(tipo: TipoPlantilla): Promise<void> {
  fireEvent.click(botonDe(tipo));
  await esperar();
}

/** Las escrituras que pasaron por `pedir`, con su ruta y su cuerpo. */
function escrituras(): { ruta: string; cuerpo: unknown }[] {
  return (pedirEspia.mock.calls as [string, { metodo?: string; cuerpo?: unknown } | undefined][])
    .filter(([, opciones]) => opciones?.metodo === 'PUT')
    .map(([ruta, opciones]) => ({ ruta, cuerpo: opciones?.cuerpo }));
}

beforeEach(() => {
  pedirEspia.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// De quien es el texto que se esta viendo
// ---------------------------------------------------------------------------

describe('una plantilla por defecto no es una plantilla tuya', () => {
  /**
   * EL ESCENARIO DONDE LA DISTINCION EXISTE: UNA DE CADA, EN EL MISMO MONTAJE.
   *
   * `listarPlantillas()` devuelve las cinco SIEMPRE —las que no tienen fila
   * salen de `PLANTILLAS_POR_DEFECTO`— y `esPorDefecto` es lo unico que separa
   * «el texto del codigo» de «el que escribio el gimnasio». Pintar el primero
   * sin decirlo le hace creer al admin que lo escribio el, y que cambiarlo es
   * editar «su» texto cuando lo que hace es crear el primero.
   *
   * El valor va en un ATRIBUTO PROPIO (`si`/`no`) y no deducido de la frase: es
   * lo que permite afirmar CUAL de los dos casos se dibujo sin buscar
   * subcadenas, donde una casualidad ortografica da verdes. Y las dos frases,
   * ademas, por IGUALDAD ENTERA.
   */
  it('una plantilla por defecto se distingue de una propia', async () => {
    await montarYEsperar({
      plantillas: [
        { tipo: 'CONFIRMACION', ...PLANTILLAS_POR_DEFECTO.CONFIRMACION, esPorDefecto: true },
        {
          tipo: 'CANCELACION',
          asunto: CENTINELAS.asuntoDeLaPlantilla,
          cuerpoHtml: `<p>${CENTINELAS.cuerpoDeLaPlantilla}</p>`,
          esPorDefecto: false,
        },
      ],
    });

    expect(
      articuloDe('CONFIRMACION')
        .querySelector('[data-por-defecto]')
        ?.getAttribute('data-por-defecto'),
    ).toBe('si');
    expect(textoDe('CONFIRMACION', '[data-por-defecto]')).toBe(
      'Esta es la plantilla que trae el sistema. El gimnasio no escribio la suya, asi que lo de ' +
        'abajo no es tu texto: es el del codigo. Guardar aca no edita el tuyo, lo crea por ' +
        'primera vez, y desde entonces las mejoras que le hagamos al texto del sistema dejan de ' +
        'llegarte.',
    );

    expect(
      articuloDe('CANCELACION')
        .querySelector('[data-por-defecto]')
        ?.getAttribute('data-por-defecto'),
    ).toBe('no');
    expect(textoDe('CANCELACION', '[data-por-defecto]')).toBe(
      'Esta plantilla la escribio el gimnasio. Lo de abajo es tu texto y guardar lo reemplaza; el ' +
        'del sistema ya no se usa para este aviso.',
    );
  });

  /**
   * LAS CINCO, Y EN EL ORDEN QUE MANDA LA API.
   *
   * El fijo va DESORDENADO a proposito: si la pantalla llevara su propia lista
   * de tipos escrita —una segunda fuente de verdad que el dia que haya un sexto
   * aviso deja un hueco mudo— dibujaria el orden del codigo y no el de la
   * respuesta, y este test lo veria. Con el fijo en el orden natural, los dos
   * casos se verian igual y el test no podria fallar.
   *
   * Se compara la LISTA ENTERA por igualdad: con un `toContain` por tipo, una
   * pantalla que dibujara seis —o la misma dos veces— pasaria en verde.
   */
  it('las cinco estan, y solo esas cinco', async () => {
    const desordenadas: TipoPlantilla[] = [
      'VENCIMIENTO_PACK',
      'CONFIRMACION',
      'LISTA_ESPERA',
      'CANCELACION',
      'RECORDATORIO_PAGO',
    ];

    await montarYEsperar({
      plantillas: desordenadas.map((tipo) => ({
        tipo,
        ...PLANTILLAS_POR_DEFECTO[tipo],
        esPorDefecto: true,
      })),
    });

    expect(
      [...document.querySelectorAll('[data-plantilla]')].map((nodo) =>
        nodo.getAttribute('data-plantilla'),
      ),
    ).toEqual(desordenadas);

    // Y cada una con su formulario y su previsualizacion: cinco bloques vacios
    // cumplirian la lista de arriba sin dibujar nada.
    expect(document.querySelectorAll('form')).toHaveLength(5);
    expect(document.querySelectorAll('[data-previsualizacion="cuerpo"]')).toHaveLength(5);
    expect(new Set(LOS_CINCO_TIPOS.map((tipo) => cuerpoDe(tipo))).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// La previsualizacion
// ---------------------------------------------------------------------------

describe('la previsualizacion', () => {
  /**
   * SE AFIRMA SOBRE EL MARCADO, PORQUE «SE VE BIEN» NO PRUEBA NADA.
   *
   * Un `sandbox="allow-scripts allow-same-origin"` dibuja exactamente la misma
   * caja con exactamente el mismo contenido dentro, y es un iframe SIN
   * aislamiento: con esos dos permisos juntos el documento anidado corre
   * JavaScript Y comparte origen con el panel, o sea que puede leer sus
   * cookies, su `localStorage` y su DOM. Lo unico que distingue los dos casos
   * es el ATRIBUTO.
   *
   * `sandbox` IGUAL A LA CADENA VACIA, no `toContain` ni `not.toContain`: la
   * cadena vacia es «ningun permiso» y cualquier otro valor es «alguno». Un
   * `not.toContain('allow-scripts')` pasaria en verde sobre
   * `allow-same-origin`, que sin scripts ya deja al documento anidado leer la
   * sesion del panel desde la consola del navegador.
   *
   * Y el `src` AUSENTE, que es la otra mitad: un marco que cargara una URL
   * seria una peticion de red que no pasa por `pedir` y que ningun test de
   * rutas veria.
   *
   * Se afirma de los CINCO. Con uno solo, cuatro marcos abiertos pasarian.
   */
  it('la previsualizacion va en un iframe con sandbox SIN permisos', async () => {
    await montarYEsperar();

    const marcos = [...document.querySelectorAll('[data-previsualizacion="cuerpo"]')];
    expect(marcos).toHaveLength(5);

    for (const marco of marcos) {
      expect(marco.tagName).toBe('IFRAME');
      expect(marco.getAttribute('sandbox')).toBe('');
      expect(marco.getAttribute('src')).toBeNull();
      // La premisa: el marco lleva algo dentro. Uno vacio cumpliria todo lo de
      // arriba sin previsualizar nada.
      expect(marco.getAttribute('srcdoc')).not.toBe('');
    }
  });

  /**
   * EL HTML DE LA PLANTILLA NO SE CONVIERTE EN NODOS DEL PANEL.
   *
   * Lo escribe un admin y lo mira otro —o un superadmin—. Con un
   * `dangerouslySetInnerHTML` ese HTML seria DOM del panel: sus `<script>`
   * corren con la sesion de quien mira, sus `<style>` pintan toda la pagina y
   * su `<form action>` manda a donde quiera. Entra por el ATRIBUTO `srcdoc`,
   * que el navegador parsea en el documento ANIDADO y aislado.
   *
   * SE AFIRMA POR SELECTOR Y NO POR TEXTO, y es la unica forma honesta: el
   * texto de la plantilla SI esta en el marcado del panel —como atributo
   * `srcdoc`, y como texto hijo del `<textarea>`, que React sincroniza igual
   * que sincroniza el `value` de un `<input>` (medido: `<textarea
   * id="t">CENTINELA</textarea>` en `document.body.innerHTML`)—. Lo que no
   * puede estar es convertido en NODOS, y eso lo dice `querySelectorAll`.
   *
   * ⚠️ MEDIDO EN JSDOM, que no es lo mismo que en el navegador: jsdom NO
   * CARGA el `srcdoc` —el `contentDocument` del marco queda vacio—. O sea que
   * aqui la mitad «el HTML vive dentro del marco» no se puede ejercitar y lo
   * que este test fija de verdad es la mitad que importa: que NO esta en el
   * documento de arriba. La premisa de abajo tapa el caso ciego: sin ella, una
   * pantalla que no previsualizara nada pasaria en verde.
   */
  it('el HTML de la plantilla NO se inyecta en el documento del panel', async () => {
    const cuerpo =
      `<p data-de-la-plantilla id="centinela-inyectado">${CENTINELAS.cuerpoDeLaPlantilla} ` +
      '{{alumno}}</p>';

    await montarYEsperar({
      plantillas: [
        {
          tipo: 'CONFIRMACION',
          asunto: CENTINELAS.asuntoDeLaPlantilla,
          cuerpoHtml: cuerpo,
          esPorDefecto: false,
        },
      ],
    });

    // NINGUN nodo de la plantilla en el documento del panel, mirado por dos
    // selectores distintos que solo existen en ella.
    expect(document.querySelectorAll('[data-de-la-plantilla]')).toHaveLength(0);
    expect(document.querySelectorAll('#centinela-inyectado')).toHaveLength(0);

    // Y la premisa, por IGUALDAD del documento anidado entero: el HTML si esta,
    // dentro del marco, con el marcador ya cambiado por su ejemplo.
    expect(marcoDe('CONFIRMACION').getAttribute('srcdoc')).toBe(
      '<!doctype html><html lang="es"><head><meta charset="utf-8"></head><body>' +
        `<p data-de-la-plantilla id="centinela-inyectado">${CENTINELAS.cuerpoDeLaPlantilla} ` +
        '«alumno»</p>' +
        '</body></html>',
    );

    // El ASUNTO va aparte y como TEXTO: `resolverMensaje` lo renderiza sin
    // escapar y termina en el `subject` de nodemailer, que es texto plano.
    expect(textoDe('CONFIRMACION', '[data-previsualizacion="asunto"]')).toBe(
      CENTINELAS.asuntoDeLaPlantilla,
    );
  });
});

// ---------------------------------------------------------------------------
// Los marcadores
// ---------------------------------------------------------------------------

describe('los marcadores', () => {
  /**
   * LOS DE ESE TIPO, Y NO UNA LISTA PARA TODOS.
   *
   * `DatosDePlantilla` es `Record<string, string>` y los marcadores validos de
   * cada tipo NO ESTAN DECLARADOS EN NINGUN SITIO: son los que cada emisor
   * pasa. La unica lista real del repo es la que usa la plantilla POR DEFECTO
   * de ese tipo, y la pantalla la saca del TEXTO que manda la API —que es
   * `plantillas.ts` viajando por el cable—, no de una copia.
   *
   * TRES TIPOS CON TRES LISTAS DISTINTAS, que es el escenario donde la
   * distincion existe: con uno solo, una pantalla que listara siempre los cinco
   * nombres pasaria en verde, y seria justo el bug —prometerle `{{clase}}` a
   * `RECORDATORIO_PAGO`, que no lo recibe—.
   *
   * Por IGUALDAD de la lista y por ATRIBUTO PROPIO: buscar `'gimnasio'` dentro
   * del texto del bloque lo encuentra en la frase que explica de donde sale la
   * lista.
   */
  it('lista los marcadores de ESE tipo', async () => {
    await montarYEsperar();

    expect(marcadoresListadosDe('CONFIRMACION')).toEqual([
      'alumno',
      'clase',
      'fecha',
      'gimnasio',
      'hora',
    ]);
    expect(marcadoresListadosDe('RECORDATORIO_PAGO')).toEqual(['alumno', 'gimnasio']);
    expect(marcadoresListadosDe('VENCIMIENTO_PACK')).toEqual(['alumno', 'fecha', 'gimnasio']);

    // Y se dice de donde sale la lista y que puede quedarse corta. Por
    // igualdad: una frase que prometiera «estos son todos» seria falsa.
    expect(textoDe('RECORDATORIO_PAGO', '[data-marcadores="se-saben"] p')).toBe(
      'Estos son los marcadores que usa la plantilla por defecto de este aviso, que es la unica ' +
        'lista que el panel puede saber de verdad. Los que figuran llegan siempre. Puede faltar ' +
        'alguno: si quien manda este aviso incluye mas datos de los que el texto por defecto ' +
        'gasta, el panel no tiene de donde enterarse. Se prefiere que falte uno a prometer uno ' +
        'que no llega.',
    );
  });

  /**
   * DE UN TIPO QUE EL GIMNASIO YA REESCRIBIO NO SE LISTA NINGUNO.
   *
   * Es el limite del metodo, y se dice en vez de taparlo: la API manda la
   * plantilla EN USO, asi que de un tipo con `esPorDefecto: false` la del
   * codigo no viaja y no hay de donde sacar la lista. Inventar una seria la
   * segunda fuente de verdad que todo esto existe para no crear.
   *
   * El par de bloques en el mismo montaje es el escenario: uno lista y el otro
   * explica por que no, con el resto de la pantalla identico.
   */
  it('de una plantilla que ya es del gimnasio no se listan marcadores', async () => {
    await montarYEsperar({
      plantillas: [
        { tipo: 'CONFIRMACION', ...PLANTILLAS_POR_DEFECTO.CONFIRMACION, esPorDefecto: true },
        {
          tipo: 'CANCELACION',
          asunto: 'Cancelaste {{clase}}',
          cuerpoHtml: '<p>{{alumno}}</p>',
          esPorDefecto: false,
        },
      ],
    });

    expect(marcadoresListadosDe('CONFIRMACION')).toHaveLength(5);
    expect(marcadoresListadosDe('CANCELACION')).toEqual([]);
    expect(textoDe('CANCELACION', '[data-marcadores="no-se-saben"]')).toBe(
      'Los marcadores de este aviso no se pueden listar: el panel los saca de la plantilla por ' +
        'defecto, y la API solo manda la que esta en uso, que en este caso es la del gimnasio. ' +
        'Antes que inventar una lista que podria prometer un dato que no llega, no se lista ' +
        'ninguna.',
    );
  });

  /**
   * Y LO QUE SE VIO LLEGAR NO SE PIERDE AL GUARDAR.
   *
   * Guardar invalida la clave y la respuesta nueva de ESE tipo ya viene con
   * `esPorDefecto: false`. Sin memoria, la lista de marcadores desapareceria
   * en el instante siguiente a guardar, que es justo cuando el admin la esta
   * usando para seguir editando. Lo que se conserva se VIO: llego por defecto
   * en esta misma sesion.
   *
   * El escenario donde la distincion existe: ANTES de guardar la lista esta, y
   * el `esPorDefecto` tiene que haber cambiado de verdad —si no cambiara, el
   * test pasaria sin que la memoria hiciera nada—.
   */
  it('los marcadores que se vieron llegar siguen puestos despues de guardar', async () => {
    await montarYEsperar();

    expect(marcadoresListadosDe('RECORDATORIO_PAGO')).toEqual(['alumno', 'gimnasio']);

    escribir('#cuerpo-RECORDATORIO_PAGO', '<p>Hola {{alumno}}, pasá por {{gimnasio}}.</p>');
    await pulsarGuardar('RECORDATORIO_PAGO');

    // La premisa: el tipo dejo de ser por defecto de verdad.
    expect(
      articuloDe('RECORDATORIO_PAGO')
        .querySelector('[data-por-defecto]')
        ?.getAttribute('data-por-defecto'),
    ).toBe('no');
    expect(marcadoresListadosDe('RECORDATORIO_PAGO')).toEqual(['alumno', 'gimnasio']);
  });

  /**
   * UN MARCADOR DE FUERA AVISA Y NO BLOQUEA, Y EL CASO ES EL DE VERDAD.
   *
   * `{{clase}}` en `RECORDATORIO_PAGO`, que solo recibe `alumno` y `gimnasio`.
   * Handlebars no lo deja escrito: lo reemplaza por NADA, asi que al alumno le
   * llega «Te esperamos en » y un hueco. De este lado nadie se entera nunca.
   *
   * Y NO BLOQUEA, porque la lista under-reporta A PROPOSITO: un marcador que no
   * figure puede ser un hueco de verdad o un dato que el emisor manda y el
   * texto por defecto no gasta. Cortar el guardado convertiria el
   * conservadurismo de la lista en un impedimento.
   *
   * ⚠️ COMO SE AFIRMA QUE EL AVISO NO BLOQUEA, SIN BUSCAR LA PALABRA
   * «bloqueado»: se guarda el `outerHTML` del BOTON antes de escribir el
   * marcador raro y se compara despues por IGUALDAD. Eso mata el `disabled`, el
   * `aria-disabled`, el `type` cambiado, la clase que lo apaga y cualquier otra
   * forma de frenarlo, la tenga el nombre que la tenga. Y despues se pulsa y se
   * mira que el `PUT` salio CON el marcador raro dentro, que es la unica prueba
   * de que no se corto.
   */
  it('usar un marcador de fuera AVISA pero no bloquea', async () => {
    await montarYEsperar();

    // El estado de partida: ningun aviso y el boton tal cual.
    expect(textoDe('RECORDATORIO_PAGO', '[data-marcadores-desconocidos]')).toBeNull();
    const botonAntes = botonDe('RECORDATORIO_PAGO').outerHTML;
    const bloqueAntes = restoDelBloque('RECORDATORIO_PAGO');

    const cuerpoConClase = '<p>Hola {{alumno}}, te esperamos en {{clase}}.</p>';
    escribir('#cuerpo-RECORDATORIO_PAGO', cuerpoConClase);
    await esperar();

    // AVISA, por igualdad entera y nombrando el marcador.
    expect(textoDe('RECORDATORIO_PAGO', '[data-marcadores-desconocidos]')).toBe(
      'Handlebars no deja escrito un marcador que no exista: lo reemplaza por nada, asi que la ' +
        'frase le llega al alumno con un hueco en medio y nadie se entera de este lado. Estos no ' +
        'figuran entre los de este aviso, y pueden ser justo eso o datos que la lista no alcanza ' +
        'a ver. Se guarda igual: {{clase}}',
    );

    // Y NO BLOQUEA: el boton es el MISMO marcado, y el resto del bloque dice lo
    // mismo que antes —el aviso y el campo que cambio se sacan del DOM para
    // comparar, asi no hay que acertar con los espacios ni se puede colar nada
    // en los bordes—.
    expect(botonDe('RECORDATORIO_PAGO').outerHTML).toBe(botonAntes);
    expect(restoDelBloque('RECORDATORIO_PAGO')).toBe(bloqueAntes);

    await pulsarGuardar('RECORDATORIO_PAGO');

    // La prueba de que no se corto: el `PUT` salio, y con el marcador dentro.
    expect(escrituras()).toEqual([
      {
        ruta: rutaDeUnTipo('RECORDATORIO_PAGO'),
        cuerpo: {
          asunto: PLANTILLAS_POR_DEFECTO.RECORDATORIO_PAGO.asunto,
          cuerpoHtml: cuerpoConClase,
        },
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Guardar
// ---------------------------------------------------------------------------

describe('guardar una plantilla', () => {
  /**
   * EL MOTIVO DE LA API, ENTERO Y SIN REESCRIBIR.
   *
   * `guardarPlantilla` llama a `motivoDePlantillaInvalida(dto)` ANTES DE
   * ESCRIBIR y contesta un 400 con `La plantilla no es valida: ${motivo}`, que
   * es el error de Handlebars sobre el texto que el propio admin acaba de
   * escribir —con su linea y su columna—. No pasa por `motivoSeguro` a
   * proposito: no hay ninguna credencial que sanear ahi.
   *
   * Cambiarlo por un «no se pudo guardar» deja al admin buscando a ojo una
   * llave sin cerrar en un HTML de cuarenta lineas. Se muestra tal cual.
   *
   * SON DOS MOTIVOS Y POR IGUALDAD ENTERA: con uno, una pantalla que lo
   * tuviera escrito a mano pasaria; con un `toContain`, una que pintara el
   * motivo Y ADEMAS un cartel generico al lado tambien.
   */
  it('una plantilla mal formada muestra el motivo de la API', async () => {
    for (const motivo of MOTIVOS_DE_LA_API) {
      await montarYEsperar({ falloAlGuardar: new ErrorDeApi(motivo, 400) });

      escribir('#cuerpo-CONFIRMACION', '<p>{{#if alumno}}sin cerrar</p>');
      await pulsarGuardar('CONFIRMACION');

      expect(textoDe('CONFIRMACION', '[data-resultado="error"]')).toBe(
        `No se pudo guardar la plantilla: ${motivo}`.replace(/\s+/g, ' ').trim(),
      );
      // Un fallo no se parece a un exito, y se distingue por un atributo propio
      // y no por el color.
      expect(textoDe('CONFIRMACION', '[data-resultado="exito"]')).toBeNull();
      // Y el fallo de una no pinta nada en las otras cuatro.
      expect(document.querySelectorAll('[data-resultado="error"]')).toHaveLength(1);

      cleanupEntreMontajes();
    }
  });

  /**
   * GUARDAR UNA NO TOCA LAS OTRAS CUATRO.
   *
   * `guardarPlantilla` escribe UNA fila y `useGuardarPlantilla` invalida la
   * clave COMPARTIDA de las cinco, asi que despues de guardar las cinco se
   * vuelven a leer y se vuelven a dibujar. Ahi es donde una pantalla puede
   * pisar las otras cuatro sin que ningun test de ruta ni de cuerpo lo note:
   * un borrador compartido, un estado levantado, un `setQueryData` optimista
   * mal hecho.
   *
   * ⚠️ LAS CINCO SE SIEMBRAN DISTINTAS —texto distinto Y `esPorDefecto`
   * distinto—, que es el escenario donde la distincion existe: con las cinco
   * iguales, pisarlas todas con la misma se veria exactamente igual de bien.
   *
   * Y el doble ESCRIBE: el `GET` de despues contesta lo que el `PUT` dejo. Con
   * un doble que devolviera siempre el fijo, un servidor que las pisara todas
   * pasaria este test en verde.
   */
  it('guardar una plantilla no toca las otras cuatro', async () => {
    const distintas: PlantillaPublica[] = LOS_CINCO_TIPOS.map((tipo, indice) => ({
      tipo,
      asunto: `asunto propio numero ${indice} de ${tipo}`,
      cuerpoHtml: `<p>cuerpo propio numero ${indice} de ${tipo}</p>`,
      // Mezclados: asi tambien se mira que no se les cambie el cartel.
      esPorDefecto: indice % 2 === 0,
    }));

    await montarYEsperar({ plantillas: distintas });

    const nuevoCuerpo = `<p>${CENTINELAS.cuerpoDeLaPlantilla}</p>`;
    escribir('#asunto-CONFIRMACION', CENTINELAS.asuntoDeLaPlantilla);
    escribir('#cuerpo-CONFIRMACION', nuevoCuerpo);
    await pulsarGuardar('CONFIRMACION');

    // UNA escritura, a UNA ruta, con UN cuerpo.
    expect(escrituras()).toEqual([
      {
        ruta: rutaDeUnTipo('CONFIRMACION'),
        cuerpo: { asunto: CENTINELAS.asuntoDeLaPlantilla, cuerpoHtml: nuevoCuerpo },
      },
    ]);

    // La premisa: la que se guardo SI cambio, y dejo de ser la del sistema.
    expect(asuntoDe('CONFIRMACION')).toBe(CENTINELAS.asuntoDeLaPlantilla);
    expect(cuerpoDe('CONFIRMACION')).toBe(nuevoCuerpo);
    expect(
      articuloDe('CONFIRMACION')
        .querySelector('[data-por-defecto]')
        ?.getAttribute('data-por-defecto'),
    ).toBe('no');

    // Y las otras cuatro, intactas: texto y cartel.
    for (const plantilla of distintas.slice(1)) {
      expect(asuntoDe(plantilla.tipo)).toBe(plantilla.asunto);
      expect(cuerpoDe(plantilla.tipo)).toBe(plantilla.cuerpoHtml);
      expect(
        articuloDe(plantilla.tipo)
          .querySelector('[data-por-defecto]')
          ?.getAttribute('data-por-defecto'),
      ).toBe(plantilla.esPorDefecto ? 'si' : 'no');
    }

    // Y el «guardada» aparece en UNA sola: cinco carteles de exito por un
    // guardado le dicen al admin que guardo cinco cosas.
    expect(document.querySelectorAll('[data-resultado="exito"]')).toHaveLength(1);
    expect(textoDe('CONFIRMACION', '[data-resultado="exito"]')).toBe(
      'Guardada. La API comprueba que la plantilla parsea ANTES de escribirla, asi que esto dice ' +
        'ademas que el texto no va a reventar al enviarse. No dice que los datos lleguen ni que ' +
        'el resultado se lea bien: eso lo muestran los marcadores y la previsualizacion.',
    );
  });
});

// ---------------------------------------------------------------------------
// Cuando no se pudo leer
// ---------------------------------------------------------------------------

describe('cuando la lectura falla', () => {
  /**
   * NO HAY FORMULARIO, Y AQUI NO HAY NINGUN 404 QUE PERDONAR.
   *
   * A diferencia del SMTP, `listarPlantillas()` devuelve SIEMPRE las cinco
   * —las que no tienen fila salen del codigo—, asi que un fallo es un fallo de
   * verdad. Unos formularios vacios encima de unas plantillas que SI existen se
   * guardarian encima de ellas.
   */
  it('un fallo al leer no deja ningun formulario', async () => {
    await montarYEsperar({
      falloAlLeer: new ErrorDeApi('La base de datos del gimnasio no contesta', 503),
    });

    const fallo = document.querySelector('[data-fallo="lectura-de-plantillas"]');
    expect((fallo?.textContent ?? '').replace(/\s+/g, ' ').trim()).toBe(
      'No se pudieron leer las plantillas: La base de datos del gimnasio no contesta',
    );
    expect(document.querySelectorAll('[data-plantilla]')).toHaveLength(0);
    expect(document.querySelectorAll('form')).toHaveLength(0);
    expect(document.querySelectorAll('iframe')).toHaveLength(0);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Utilidades que hay que declarar despues del andamiaje
// ---------------------------------------------------------------------------

/**
 * El texto de un bloque SIN el aviso de marcadores desconocidos y SIN el campo
 * que se acaba de escribir.
 *
 * Es la tecnica de las Tareas 3 y 5: para afirmar que algo NO se dice, se
 * montan los dos estados y se compara TODO LO DEMAS por igualdad, quitando del
 * DOM los nodos que DEBEN cambiar. Asi no hace falta buscar ninguna palabra, y
 * cae cualquier cartel, nota o asterisco que aparezca solo en uno de los dos
 * casos, lo diga como lo diga.
 *
 * Se quitan DOS nodos y no uno: el aviso (que debe aparecer) y el `<textarea>`
 * (cuyo texto hijo ES su valor, asi que cambia por definicion al escribir).
 */
function restoDelBloque(tipo: TipoPlantilla): string {
  const copia = articuloDe(tipo).cloneNode(true) as HTMLElement;
  copia.querySelector('[data-marcadores-desconocidos]')?.remove();
  copia.querySelector('textarea')?.remove();
  return (copia.textContent ?? '').replace(/\s+/g, ' ').trim();
}
