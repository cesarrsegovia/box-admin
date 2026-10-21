import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfiguracionSmtpPublica, PlantillaPublica, RolUsuario } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDelEmail from './page';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

/**
 * Se dobla `pedir`, y NADA MAS QUE `pedir`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-configuracion.spec`. Lo que se
 * audita aqui es un escalon mas arriba: QUE pide esta pantalla, QUE manda
 * dentro y —lo que importa de verdad— que la contraseña no sale por ningun
 * otro sitio.
 *
 * `ErrorDeApi` se deja REAL, y aqui no es una comodidad: la pantalla hace
 * `error instanceof ErrorDeApi` para separar el 404 (gimnasio sin correo) de un
 * fallo de lectura. Con una clase de mentira, ese `instanceof` seria `false`
 * para siempre y el 404 caeria del lado equivocado en verde.
 *
 * NO SE INSTALA NINGUN OTRO DOBLE. Todo lo que vigilan los trece tapones
 * globales —consola, titulo, `window.name`, el `<head>`, los cinco almacenes,
 * User Timing, el `src` de una imagen, las tres salidas laterales, el service
 * worker, los atributos del `<html>` y del `<body>` y la URL— se deja como
 * esta: un doble local tapa al tapon global EN ESTE ARCHIVO, que es como un
 * spec de la Fase 9 paso 24 de 25 tests con una fuga delante.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/** La ruta del SMTP. Escrita a mano: es el contrato, no lo que diga el hook. */
const RUTA_DEL_SMTP = '/config/smtp';

/**
 * LA OTRA RUTA DE LA PANTALLA, QUE DESDE LA TAREA 6 TAMBIEN SE PIDE.
 *
 * `PantallaDelEmail` monta `<ElServidorDeCorreo />` y `<LasPlantillas />`, que
 * son dos recursos independientes con dos consultas. Este archivo audita el
 * PRIMERO; el segundo tiene su propio spec en `plantillas.spec.tsx`. Lo que se
 * dobla aqui de las plantillas es lo MINIMO para que la seccion se dibuje sin
 * errores, porque una seccion rota al lado cambia lo que hay en el documento y
 * los tests de este archivo que comparan documentos enteros lo notarian.
 */
const RUTA_DE_LAS_PLANTILLAS = '/config/plantillas';

/**
 * LOS TRES DATOS QUE ESTA PANTALLA TIENE EN LA MANO, Y SUS TRES DESTINOS
 * DISTINTOS.
 *
 * Los tres se registran para que los trece tapones globales los busquen en la
 * consola, el titulo, el `<head>`, los cinco almacenes, el buffer de User
 * Timing, el `src` de una imagen, las salidas laterales, el service worker, los
 * atributos del `<html>` y del `<body>` y la URL. Eso es lo que convierte esos
 * trece ejes en una auditoria de ESTA pantalla.
 *
 * Pero no se afirma lo mismo de los tres, y el matiz es el de la Tarea 1: el
 * HOST y el USUARIO vuelven LEGITIMAMENTE en `ConfiguracionSmtpPublica` y
 * viven en la cache de consultas con todo derecho —son lo que la pantalla
 * dibuja—. De ellos se vigila que no salgan por los trece canales. SOLO DE LA
 * CLAVE se afirma, ademas, que no esta en ninguna cache.
 *
 * Las tres son cadenas largas y distintivas a proposito: un centinela corto
 * —`'587'`, `'0'`— es subcadena de cualquier clase de Tailwind y daria falsos
 * positivos en los trece ejes a la vez.
 */
const CENTINELAS = {
  hostSmtp: 'smtp.centinela-del-correo.test',
  usuarioSmtp: 'casillero@centinela-del-correo.test',
  claveSmtp: 'Clave-SMTP-Del-Mostrador-77',
};

vigilarEstosDatos(CENTINELAS);

/** Lo que contesta `GET /config/smtp`. SIN la clave, que es como contesta la API. */
const SMTP: ConfiguracionSmtpPublica = {
  host: CENTINELAS.hostSmtp,
  puerto: 587,
  seguro: false,
  usuario: CENTINELAS.usuarioSmtp,
  emailOrigen: 'avisos@centinela-del-correo.test',
  emailDestino: 'respuestas@centinela-del-correo.test',
  tieneClave: true,
  actualizadoEn: '2026-10-19T10:00:00.000Z',
};

/**
 * DOS MENSAJES DE SERVIDOR SMTP DE VERDAD, los dos ya pasados por
 * `motivoSeguro`.
 *
 * Uno es el `code` de nodemailer, que es lo que devuelve el paso 1 de
 * `motivoSeguro`; el otro es la respuesta literal de un servidor que rechaza la
 * autenticacion, que es lo que devuelve el paso 2. Son DOS y no uno porque es
 * la unica forma de que «se muestra tal cual» tenga dientes: con un solo
 * mensaje, una pantalla que lo tuviera escrito a mano pasaria en verde.
 */
/**
 * Las cinco, como las manda `listarPlantillas()` para un gimnasio que no toco
 * ninguna. Son el decorado de la seccion de al lado y no se afirma nada de
 * ellas aqui: eso es `plantillas.spec.tsx`.
 */
const PLANTILLAS: PlantillaPublica[] = [
  {
    tipo: 'CONFIRMACION',
    asunto: 'Reservaste {{clase}}',
    cuerpoHtml: '<p>{{alumno}}</p>',
    esPorDefecto: true,
  },
  {
    tipo: 'CANCELACION',
    asunto: 'Cancelaste {{clase}}',
    cuerpoHtml: '<p>{{alumno}}</p>',
    esPorDefecto: true,
  },
  {
    tipo: 'RECORDATORIO_PAGO',
    asunto: 'Pago pendiente',
    cuerpoHtml: '<p>{{alumno}}</p>',
    esPorDefecto: true,
  },
  {
    tipo: 'LISTA_ESPERA',
    asunto: 'Se libero un lugar',
    cuerpoHtml: '<p>{{alumno}}</p>',
    esPorDefecto: true,
  },
  {
    tipo: 'VENCIMIENTO_PACK',
    asunto: 'Tu pack vence',
    cuerpoHtml: '<p>{{alumno}}</p>',
    esPorDefecto: true,
  },
];

const MOTIVOS_DEL_SERVIDOR_DE_CORREO = [
  'No se pudo conectar al servidor SMTP: ECONNREFUSED',
  'No se pudo conectar al servidor SMTP: 535 5.7.8 Error: authentication failed: [redactado]',
];

interface OpcionesDeMontaje {
  /** `null` se monta SIN proveedor: ver el comentario de `montar`. */
  rol?: RolUsuario | null;
  /** Lo que contesta `GET /config/smtp`. */
  smtp?: ConfiguracionSmtpPublica;
  /** Si se pasa, la LECTURA falla con esto en vez de contestar. */
  falloAlLeer?: ErrorDeApi;
  /** Si se pasa, el `PUT` falla con esto en vez de contestar. */
  falloAlGuardar?: ErrorDeApi;
}

function montar({
  rol = 'ADMIN_SALON',
  smtp = SMTP,
  falloAlLeer,
  falloAlGuardar,
}: OpcionesDeMontaje = {}) {
  pedirEspia.mockImplementation(
    (ruta: string, opciones?: { metodo?: string; cuerpo?: unknown }) => {
      // La seccion de al lado, contestada y nada mas. Ver `RUTA_DE_LAS_PLANTILLAS`.
      if (ruta === RUTA_DE_LAS_PLANTILLAS) return Promise.resolve(PLANTILLAS);

      if (ruta !== RUTA_DEL_SMTP) {
        throw new Error(`La pantalla pidio una ruta que nadie espera: ${ruta}`);
      }

      if (opciones?.metodo === 'PUT') {
        // LA RESPUESTA DEL `PUT` NO HACE ECO DEL CUERPO, y esto es el contrato
        // y no una comodidad del doble: `guardarSmtp` termina con un
        // `return await this.verSmtp()`, que arma la respuesta campo a campo
        // desde la base y no incluye la clave. Un doble que devolviera
        // `opciones.cuerpo` le pondria la clave de vuelta en la mano a la
        // pantalla y los tests de fuga medirian otra cosa.
        return falloAlGuardar === undefined
          ? Promise.resolve(smtp)
          : Promise.reject(falloAlGuardar);
      }

      return falloAlLeer === undefined ? Promise.resolve(smtp) : Promise.reject(falloAlLeer);
    },
  );

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const pantalla = <PaginaDelEmail />;

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

/** Deja que la consulta y la mutacion se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Monta y espera a que la primera lectura haya llegado. */
async function montarYEsperar(opciones: OpcionesDeMontaje = {}) {
  const cliente = montar(opciones);
  await esperar();
  return cliente;
}

/**
 * Las llamadas DEL SERVIDOR DE CORREO, que es lo que audita este archivo.
 *
 * Se filtran por ruta y no se cuentan todas: la pantalla pide ademas las
 * plantillas de la seccion de al lado, que son otro recurso con su propio spec
 * y que —segun cuando conteste— se meterian en medio de los indices de abajo.
 * Lo que una ruta ajena NO puede hacer es colarse sin que nadie la vea: el
 * doble de `pedir` tira si le piden cualquier cosa que no sean estas dos.
 */
function llamadasDelSmtp(): [string, { metodo?: string; cuerpo?: unknown } | undefined][] {
  return pedirEspia.mock.calls.filter(([ruta]) => ruta === RUTA_DEL_SMTP) as [
    string,
    { metodo?: string; cuerpo?: unknown } | undefined,
  ][];
}

/** Las rutas del SMTP que pasaron por `pedir`, en orden. */
function rutasPedidas(): string[] {
  return llamadasDelSmtp().map(([ruta]) => ruta);
}

/** Lo que `pedir` recibio en la llamada numero `indice` DEL SMTP. */
function llamada(indice: number): { ruta: string; metodo: string | undefined; cuerpo: unknown } {
  const argumentos = llamadasDelSmtp()[indice];
  if (argumentos === undefined) throw new Error(`No hubo llamada numero ${indice}`);

  const [ruta, opciones] = argumentos;
  return { ruta, metodo: opciones?.metodo, cuerpo: opciones?.cuerpo };
}

/** El texto del nodo marcado con ese selector, con los espacios normalizados. */
function textoDe(selector: string): string | null {
  const nodo = document.querySelector(selector);
  if (nodo === null) return null;

  // El colapso de espacios es por el FORMATO del JSX —los saltos de linea del
  // archivo acaban en el texto—, no una rebaja de la afirmacion: lo que se
  // compara sigue siendo el contenido entero y por igualdad.
  return (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** El valor que tiene escrito un campo, como cadena. `null` = no esta. */
function valorDelCampo(id: string): string | null {
  const campo = document.querySelector<HTMLInputElement>(`#${id}`);
  return campo === null ? null : campo.value;
}

/**
 * Un ATRIBUTO del marcado crudo de un campo, no la propiedad.
 *
 * `getAttribute` y no `.type` ni `.placeholder`: las propiedades tienen valores
 * por defecto —`type` es `'text'` aunque no se haya escrito, `placeholder` es
 * `''`— y lo que se quiere afirmar es que el atributo NO ESTA, que es distinto
 * de que este vacio.
 */
function atributoDelCampo(id: string, atributo: string): string | null {
  const campo = document.querySelector(`#${id}`);
  if (campo === null) throw new Error(`No hay ningun campo con id ${id}`);
  return campo.getAttribute(atributo);
}

/**
 * Los botones DE LA SECCION DEL SERVIDOR DE CORREO.
 *
 * Acotado por `data-seccion` desde la Tarea 6: la seccion de las plantillas,
 * que es un recurso aparte y se dibuja aunque la lectura del SMTP falle, trae
 * sus propios botones de guardar. Lo que estos tests afirman es que NO HAY
 * FORMULARIO DE SMTP, y eso se mide dentro de su seccion.
 */
const botonesDelDocumento = () => [
  ...document.querySelectorAll('[data-seccion="servidor-de-correo"] button'),
];

/** Los campos de contraseña del marcado CRUDO. */
function camposDeContrasena(): Element[] {
  return [...document.querySelectorAll('input[type="password"]')];
}

beforeEach(() => {
  pedirEspia.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// LA CLAVE NO SE PUEDE CONSERVAR, Y LA PANTALLA LO DICE
// ---------------------------------------------------------------------------

describe('el campo de la contraseña', () => {
  /**
   * EL CAMPO ARRANCA VACIO Y SIN NADA QUE PAREZCA UN VALOR.
   *
   * Las cuatro afirmaciones son sobre el MARCADO y cada una tapa una forma
   * distinta de fingir que la clave sigue puesta:
   *
   *  1. `value` en `''` —la propiedad— es lo que se ve en el campo.
   *  2. `placeholder` AUSENTE: un `'••••••••'` ahi es la mentira entera en
   *     ocho caracteres, y se ve exactamente igual que un valor.
   *  3. el ATRIBUTO `value` ausente, que no es lo mismo que la propiedad: un
   *     `defaultValue` de relleno no se ve en la propiedad si algo lo pisa
   *     despues, y queda escrito en el marcado igual. Que este ausente es
   *     ademas lo que dice que el campo NO ES CONTROLADO, que es lo que
   *     mantiene la clave tecleada fuera del HTML (ver el test de los trece
   *     canales, donde esto se midio).
   *  4. `type="password"`, que es lo que impide leerla por encima del hombro.
   *
   * Y EL ESCENARIO DONDE LA DISTINCION EXISTE es `tieneClave: true` CON los
   * demas campos sembrados: la pantalla SI rellena lo que el servidor manda,
   * asi que un campo vacio aqui es una decision y no una pantalla que no sabe
   * sembrar nada.
   */
  it('el campo de clave arranca VACIO, nunca con puntitos de relleno', async () => {
    await montarYEsperar({ smtp: { ...SMTP, tieneClave: true } });

    expect(valorDelCampo('clave')).toBe('');
    expect(atributoDelCampo('clave', 'placeholder')).toBeNull();
    expect(atributoDelCampo('clave', 'value')).toBeNull();
    expect(atributoDelCampo('clave', 'type')).toBe('password');

    // La otra mitad: los demas campos SI vienen sembrados del servidor.
    expect(valorDelCampo('host')).toBe(CENTINELAS.hostSmtp);
    expect(valorDelCampo('puerto')).toBe('587');
    expect(valorDelCampo('usuario')).toBe(CENTINELAS.usuarioSmtp);
    expect(valorDelCampo('email-origen')).toBe('avisos@centinela-del-correo.test');
    expect(valorDelCampo('email-destino')).toBe('respuestas@centinela-del-correo.test');
  });

  /**
   * Y DESPUES DE GUARDAR VUELVE A ESTAR VACIO.
   *
   * El `onSuccess` suelta el borrador entero, que es el unico sitio del
   * cliente donde la contraseña seguia viva despues del guardado. Un
   * formulario que la dejara escrita la deja en el estado de React de una
   * pestaña que no se cierra hasta que cierra el gimnasio.
   */
  it('y vuelve a estar vacio despues de guardar', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    expect(valorDelCampo('clave')).toBe(CENTINELAS.claveSmtp);

    await pulsarGuardar();

    expect(textoDe('[data-resultado="exito"]')).not.toBeNull();
    expect(valorDelCampo('clave')).toBe('');
  });
});

describe('lo que se dice de la clave guardada', () => {
  /**
   * SE DICE QUE LA HAY, Y NADA MAS QUE QUE LA HAY.
   *
   * `tieneClave` es un booleano y es TODO lo que trae la respuesta: ni
   * longitud, ni fecha, ni primeras letras. La frase se afirma por IGUALDAD
   * ENTERA —no con un `not.toContain('caracteres')`, que pasaria en verde
   * sobre «27 simbolos»— asi que cualquier cosa que alguien le añada dentro
   * tira el test.
   *
   * El valor va ademas en un ATRIBUTO PROPIO (`si`/`no`) y no deducido del
   * texto: es lo que permite afirmar CUAL de los dos casos se dibujo sin
   * buscar subcadenas.
   */
  it('dice si hay una clave guardada, sin decir nada de ella', async () => {
    await montarYEsperar({ smtp: { ...SMTP, tieneClave: true } });

    expect(
      document.querySelector('[data-clave-guardada]')?.getAttribute('data-clave-guardada'),
    ).toBe('si');
    expect(textoDe('[data-clave-guardada]')).toBe(
      'Hay una contraseña guardada. Que la hay es lo unico que se puede saber de ella desde aca: ' +
        'la API no la devuelve ni enmascarada, porque una mascara ya confirmaria cuanto mide.',
    );

    cleanupEntreMontajes();

    await montarYEsperar({ smtp: { ...SMTP, tieneClave: false } });

    expect(
      document.querySelector('[data-clave-guardada]')?.getAttribute('data-clave-guardada'),
    ).toBe('no');
    expect(textoDe('[data-clave-guardada]')).toBe('No hay ninguna contraseña guardada.');
  });

  /**
   * ⚠️ COMO SE AFIRMA QUE ALGO NO SE DICE, SIN BUSCAR LA FRASE.
   *
   * Un `not.toContain('27 caracteres')` tiene dos agujeros: pasa en verde
   * sobre «veintisiete», sobre «empieza por Cl» y sobre «puesta el 19 de
   * octubre», y no cubre las otras veinte formas de decirlo. Asi que no se
   * busca NINGUNA palabra: se monta la pantalla DOS VECES —con clave guardada
   * y sin ella, y con TODO LO DEMAS IDENTICO— y se afirma que el documento
   * entero es EL MISMO salvo la frase que DEBE cambiar, que se saca del DOM
   * antes de comparar.
   *
   * Eso mata cualquier cartel, nota, asterisco, parentesis o `(27)` que
   * aparezca solo en uno de los dos casos, lo diga como lo diga y este donde
   * este —dentro del `<body>`, se entiende; lo de fuera son los trece
   * tapones—. Es la mejor idea de la Tarea 3 aplicada al unico dato de esta
   * pantalla que no se puede releer.
   *
   * Y el escenario donde la distincion existe es el propio par de montajes:
   * con uno solo el test no podria fallar.
   */
  it('los dos casos dicen exactamente lo mismo salvo esa frase', async () => {
    const cuerpoSinLaFrase = (): string => {
      // Se saca el nodo que DEBE cambiar y se compara todo lo demas. Sacarlo
      // del DOM y no recortarlo del texto: asi no hay que acertar con los
      // espacios ni se puede colar nada en los bordes.
      document.querySelector('[data-clave-guardada]')?.remove();
      return (document.body.textContent ?? '').replace(/\s+/g, ' ').trim();
    };

    await montarYEsperar({ smtp: { ...SMTP, tieneClave: true } });
    const conClave = cuerpoSinLaFrase();

    cleanupEntreMontajes();

    await montarYEsperar({ smtp: { ...SMTP, tieneClave: false } });
    const sinClave = cuerpoSinLaFrase();

    // La premisa del test: los dos montajes dibujaron algo. Sin esto, una
    // pantalla que no pintara nada pasaria en verde comparando '' contra ''.
    expect(conClave).not.toBe('');
    expect(conClave).toBe(sinClave);
  });

  /**
   * EL LIMITE SE EXPLICA, Y SE EXPLICA EN LOS DOS CASOS.
   *
   * No hay «dejá el campo vacio para conservar la que hay»: `GuardarSmtpDto`
   * declara `clave!: string` con `@IsNotEmpty()` y SIN `@IsOptional()` —a
   * diferencia de `seguro` y `emailDestino`, que lo llevan dos lineas mas
   * abajo—. Cambiar el puerto obliga a reescribir la contraseña entera, y eso
   * se dice ANTES de que alguien lo descubra con un 400.
   *
   * La frase va por igualdad entera y en los dos montajes: es verdad haya
   * clave guardada o no, y si viviera solo en uno de los dos casos la
   * comparacion de arriba la daria por buena.
   */
  it('explica que hay que reescribirla para cambiar cualquier otro campo', async () => {
    const LO_QUE_DICE =
      'La contraseña hay que escribirla entera cada vez que se guarde, aunque lo unico que se ' +
      'cambie sea el puerto: la API la pide siempre y no acepta el campo vacio. No existe un ' +
      '«dejalo en blanco para conservar la que hay», y esta pantalla no va a fingir que exista.';

    await montarYEsperar({ smtp: { ...SMTP, tieneClave: true } });
    expect(textoDe('[data-aviso="hay-que-reescribirla"]')).toBe(LO_QUE_DICE);

    cleanupEntreMontajes();

    await montarYEsperar({ smtp: { ...SMTP, tieneClave: false } });
    expect(textoDe('[data-aviso="hay-que-reescribirla"]')).toBe(LO_QUE_DICE);
  });

  /**
   * Y EL CAMPO VACIO NO SALE DE LA PANTALLA.
   *
   * La otra cara de la frase de arriba: si la explicacion dice que no se puede
   * dejar en blanco, dejarlo en blanco no puede mandar un `clave: ''` a que la
   * API lo rechace con un «clave should not be empty». Se ataja aqui, con el
   * motivo escrito en el campo que lo tiene.
   */
  it('guardar con el campo vacio no manda nada', async () => {
    await montarYEsperar();

    await pulsarGuardar();

    expect(rutasPedidas()).toEqual([RUTA_DEL_SMTP]);
    expect(llamada(0).metodo).toBeUndefined();
    expect(textoDe('#clave-error')).toBe(
      'Escribi la contraseña del servidor de correo: no se puede conservar la que hay.',
    );
  });
});

// ---------------------------------------------------------------------------
// Lo que viaja al guardar
// ---------------------------------------------------------------------------

describe('guardar el servidor de correo', () => {
  /**
   * LOS SIETE CAMPOS, Y `seguro` SIEMPRE CON SU VALOR.
   *
   * `guardarSmtp` hace `seguro: dto.seguro ?? true`: omitirlo le ENCIENDE el
   * TLS a un gimnasio que lo tenia apagado. Es exactamente el bug de
   * `mostrarPrecios` de la web publica, con la diferencia de que aqui el
   * defecto del servidor es el lado seguro y el que se pierde es el valor
   * elegido. El fijo trae `seguro: false` a proposito: con un `true`, omitirlo
   * daria el mismo resultado y el test no podria fallar.
   *
   * El cuerpo se afirma con `toEqual` sobre el objeto ENTERO y no campo a
   * campo: la API corre con `forbidNonWhitelisted`, asi que un campo de mas es
   * un 400 igual que uno de menos.
   */
  it('manda los siete campos, con `seguro` explicito', async () => {
    await montarYEsperar({ smtp: { ...SMTP, seguro: false } });

    // Se toca UN SOLO campo ademas de la clave: el que no se toca es el que un
    // guardado «solo lo que cambio» se dejaria fuera.
    await escribirEnElCampo('puerto', '465');
    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    expect(llamada(1)).toEqual({
      ruta: RUTA_DEL_SMTP,
      metodo: 'PUT',
      cuerpo: {
        host: CENTINELAS.hostSmtp,
        puerto: 465,
        seguro: false,
        usuario: CENTINELAS.usuarioSmtp,
        clave: CENTINELAS.claveSmtp,
        emailOrigen: 'avisos@centinela-del-correo.test',
        emailDestino: 'respuestas@centinela-del-correo.test',
      },
    });
  });

  /**
   * EL PUERTO VIAJA COMO NUMERO, Y UN PUERTO QUE NO ES UN NUMERO NO VIAJA.
   *
   * `Number('')` es CERO: sin el corte del vacio, borrar el campo mandaria un
   * puerto 0 que nadie escribio. Y `@IsInt()` rechaza una cadena, asi que un
   * `'465'` en vez de un `465` seria un 400 sin que la pantalla se enterara.
   */
  it('un puerto que no es un numero entero no se manda', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await escribirEnElCampo('puerto', '');
    await pulsarGuardar();

    expect(rutasPedidas()).toEqual([RUTA_DEL_SMTP]);
    expect(textoDe('#puerto-error')).toBe('Poné un numero entero de puerto.');
  });

  /**
   * LA DIRECCION DE RESPUESTA VACIA SE OMITE, NO VIAJA COMO `''`.
   *
   * `@IsOptional()` mas `@IsEmail()`: un `''` seria un 400 en vez del borrado
   * que quiere quien dejo el campo en blanco. Y omitirlo ES como se borra
   * —`emailDestino: dto.emailDestino ?? null` en el service—.
   */
  it('la direccion de respuesta vacia se omite del cuerpo', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await escribirEnElCampo('email-destino', '');
    await pulsarGuardar();

    const cuerpo = llamada(1).cuerpo as Record<string, unknown>;
    expect('emailDestino' in cuerpo).toBe(false);
    expect(cuerpo.emailOrigen).toBe('avisos@centinela-del-correo.test');
  });

  /** Y apagar el TLS viaja como `false`, no se omite. */
  it('apagar la conexion cifrada viaja como false', async () => {
    await montarYEsperar({ smtp: { ...SMTP, seguro: true } });

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    const usuario = userEvent.setup();
    await usuario.click(screen.getByLabelText('Conexion cifrada (TLS)'));
    await pulsarGuardar();

    expect((llamada(1).cuerpo as Record<string, unknown>).seguro).toBe(false);
  });

  /**
   * EL EXITO AFIRMA LO QUE LA API SI DEMUESTRA Y SE PARA AHI.
   *
   * `guardarSmtp` verifica la conexion ANTES de escribir y aborta si falla
   * —hay un test del repo que fija ese orden—, asi que un guardado bueno SI
   * prueba que el servidor de correo contesto. Lo que no prueba es que un
   * email haya llegado a nadie. Por igualdad entera: es la unica forma de que
   * no se le pueda colar un «ya estan saliendo los emails».
   */
  it('el exito dice lo que la verificacion previa demuestra, y lo que no', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    expect(textoDe('[data-resultado="exito"]')).toBe(
      'Guardado. La conexion se prueba ANTES de guardar, asi que esto dice ademas que el ' +
        'servidor de correo contesto y acepto estos datos. No dice que ningun email haya llegado ' +
        'a nadie: eso depende de la cola.',
    );
    expect(textoDe('[data-resultado="error"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El fallo del servidor de correo
// ---------------------------------------------------------------------------

describe('cuando el servidor de correo rechaza la conexion', () => {
  /**
   * EL MOTIVO DE LA API, ENTERO Y SIN REESCRIBIR.
   *
   * `guardarSmtp` verifica ANTES de guardar y, si falla, contesta un 400 con
   * `No se pudo conectar al servidor SMTP: ${motivoSeguro(error, clave,
   * usuario)}`. `motivoSeguro` —leido entero— garantiza UNA cosa: que la clave
   * no vuelve en ese texto, ni en claro, ni en sus cuatro formas base64
   * conocidas, ni partida por separadores, ni como cualquier cosa que parezca
   * base64 largo. Lo que NO garantiza es que el texto sea corto, bonito ni
   * familiar.
   *
   * Y ese texto es la UNICA pista de que esta mal: `ECONNREFUSED` es un puerto
   * cerrado, un `535 5.7.8` es una contraseña que el servidor no acepta.
   * Cambiarlo por «hubo un problema, intentalo de nuevo» tira justo eso.
   *
   * SON DOS MENSAJES Y NO UNO: con uno solo, una pantalla que lo tuviera
   * escrito a mano pasaria en verde. Y por IGUALDAD de la frase entera: un
   * `toContain(motivo)` pasaria sobre una pantalla que pintara el motivo Y
   * ADEMAS un cartel generico al lado.
   */
  it('el error del servidor de correo se muestra TAL CUAL', async () => {
    for (const motivo of MOTIVOS_DEL_SERVIDOR_DE_CORREO) {
      await montarYEsperar({ falloAlGuardar: new ErrorDeApi(motivo, 400) });

      await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
      await pulsarGuardar();

      expect(textoDe('[data-resultado="error"]')).toBe(
        `No se pudo guardar la configuracion del correo: ${motivo}`,
      );
      // Un fallo no se parece a un exito, y se distingue por un atributo
      // propio y no por el color.
      expect(textoDe('[data-resultado="exito"]')).toBeNull();

      cleanupEntreMontajes();
    }
  });

  /**
   * Y TRAS EL FALLO EL FORMULARIO SIGUE AHI, CON LO QUE YA SE HABIA ESCRITO.
   *
   * Menos la clave, que es justo lo que no se puede conservar: si el host
   * estaba mal tecleado, corregirlo obliga a escribir la contraseña otra vez.
   * Es desagradable y es verdad, y la pantalla ya lo explico arriba. Lo que no
   * puede pasar es que ademas se pierda el host corregido.
   */
  it('tras el fallo el formulario sigue ahi con lo tecleado', async () => {
    await montarYEsperar({
      falloAlGuardar: new ErrorDeApi(MOTIVOS_DEL_SERVIDOR_DE_CORREO[0] as string, 400),
    });

    await escribirEnElCampo('host', 'smtp.corregido.test');
    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    expect(valorDelCampo('host')).toBe('smtp.corregido.test');
    expect(valorDelCampo('clave')).toBe(CENTINELAS.claveSmtp);
  });
});

// ---------------------------------------------------------------------------
// La clave y las caches
// ---------------------------------------------------------------------------

describe('la clave no se queda en ninguna cache', () => {
  /**
   * MEDIDO SOBRE EL `QueryClient`, NO LEYENDO EL HOOK.
   *
   * Que `useGuardarSmtp` lleve `gcTime: 0` escrito lo comprueba el barrido
   * estatico de `src/hooks/mutaciones-sin-gctime.spec.ts`. Lo que ese barrido
   * NO puede comprobar es el EFECTO: por defecto TanStack conserva la mutacion
   * CINCO MINUTOS despues de que su componente se desmonte, con lo que se MANDO
   * (`variables`) dentro, en un `QueryClient` que dura lo que dura la pestaña
   * de la maquina del mostrador. Y lo que se mando aqui es la credencial del
   * servidor de correo del gimnasio.
   *
   * Por eso se desmonta DE VERDAD —`cleanup()`— y se mira el cache despues: es
   * el unico momento en el que el recolector entra, y es el escenario donde la
   * distincion existe. Antes del desmontaje, con `gcTime: 0` o sin el, la
   * mutacion esta ahi igual.
   */
  it('la clave NO queda en la cache de mutaciones', async () => {
    const cliente = await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    // La premisa: la clave LLEGO a salir. Sin esto, una pantalla que no
    // mandara nada pasaria este test en verde.
    expect((llamada(1).cuerpo as Record<string, unknown>).clave).toBe(CENTINELAS.claveSmtp);

    cleanup();
    await esperar();

    expect(cliente.getMutationCache().getAll()).toHaveLength(0);
    expect(JSON.stringify(cliente.getMutationCache().getAll())).not.toContain(CENTINELAS.claveSmtp);
  });

  /**
   * NI EN LA DE CONSULTAS —DONDE EL HOST Y EL USUARIO SI VIVEN CON TODO
   * DERECHO—.
   *
   * El matiz de la Tarea 1: `ConfiguracionSmtpPublica` lleva el host y el
   * usuario, la pantalla los dibuja y la cache de consultas los guarda porque
   * para eso existe. De ellos se vigila que no salgan por los trece canales, no
   * que no esten aqui. La clave es el unico dato del que se afirma que no esta
   * en NINGUNA cache: un `setQueryData` «por comodidad» tras guardar la dejaria
   * ahi, legible desde el devtools con una linea.
   *
   * Las dos afirmaciones hacen falta: sin la primera, un cache vacio —una
   * consulta que nunca llego— pasaria la segunda en verde.
   */
  it('ni en la de consultas, donde el host y el usuario si viven', async () => {
    const cliente = await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    const texto = JSON.stringify(
      cliente
        .getQueryCache()
        .getAll()
        .map((c) => [c.queryKey, c.state.data]),
    );

    expect(texto).toContain(CENTINELAS.hostSmtp);
    expect(texto).toContain(CENTINELAS.usuarioSmtp);
    expect(texto).not.toContain(CENTINELAS.claveSmtp);
  });

  /**
   * Y NO APARECE EN NINGUNO DE LOS TRECE CANALES.
   *
   * Los trece tapones de `vitest.setup.ts` corren SOLOS en el `afterEach` de
   * cada test de este archivo contra lo registrado arriba con
   * `vigilarEstosDatos`: consola, `document.title`, `window.name`, el `<head>`,
   * los tres almacenes, `performance.mark`/`measure`, el `src` de una imagen,
   * las salidas laterales, CacheStorage, el service worker, IndexedDB, los
   * atributos del `<html>` y del `<body>` y la URL del documento. Este test no
   * los repite: lo que hace es EJERCITAR el camino entero —leer, teclear,
   * guardar bien y guardar mal— para que tengan algo que auditar, porque un
   * tapon sobre una pantalla que no hizo nada no prueba nada.
   *
   * Lo que si afirma por su cuenta es el DECIMOCUARTO sitio, que ninguno de los
   * trece mira y que los demas tests de pantalla tampoco: el MARCADO
   * SERIALIZADO del documento entero. La clave tiene que estar en la PROPIEDAD
   * `value` del campo y en ningun otro sitio del HTML: ni en un `data-`, ni en
   * un `title`, ni en un `aria-label`, ni en el `href` de un enlace, que es por
   * donde saldria sin que ningun test de texto la viera.
   *
   * ⚠️ Y ESTO NO ES TEORIA: ESTE TEST FALLO. Un `<input type="password">`
   * CONTROLADO —`value={campos.clave}`, que es como esta escrito cualquier otro
   * campo de esta pantalla y de todo el panel— pone la contraseña en el
   * ATRIBUTO `value` del marcado, porque React sincroniza el `defaultValue` del
   * nodo con el valor controlado y `defaultValue` ES el atributo. La pantalla
   * dejo el campo de la clave NO CONTROLADO por esto y solo por esto.
   *
   * EL CASO CIEGO ESTA CUBIERTO con la afirmacion contraria: el host SI
   * aparece en el marcado serializado, con todo derecho y por el mismo
   * mecanismo —es un campo controlado—. Sin ella, un `outerHTML` que por
   * cualquier motivo no trajera los valores de los campos daria esto por bueno
   * sin mirar nada.
   */
  it('la clave no aparece en ninguno de los trece canales', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);

    // La premisa, otra vez: la clave esta de verdad en la pantalla. Si no
    // estuviera, todo lo de abajo seria verde por el motivo equivocado.
    expect(valorDelCampo('clave')).toBe(CENTINELAS.claveSmtp);
    // Y el escenario donde la distincion existe: un campo CONTROLADO si deja su
    // valor escrito en el marcado, asi que la ausencia de la clave es una
    // decision de esta pantalla y no una propiedad del serializador.
    expect(document.documentElement.outerHTML).toContain(CENTINELAS.hostSmtp);
    expect(document.documentElement.outerHTML).not.toContain(CENTINELAS.claveSmtp);

    await pulsarGuardar();
    expect(document.documentElement.outerHTML).not.toContain(CENTINELAS.claveSmtp);

    // Y por el camino del fallo, que es el que arrastra un mensaje de error de
    // un servidor ajeno hasta la pantalla.
    cleanupEntreMontajes();
    await montarYEsperar({
      falloAlGuardar: new ErrorDeApi(MOTIVOS_DEL_SERVIDOR_DE_CORREO[1] as string, 400),
    });
    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    expect(textoDe('[data-resultado="error"]')).not.toBeNull();
    expect(document.documentElement.outerHTML).not.toContain(CENTINELAS.claveSmtp);
  });
});

// ---------------------------------------------------------------------------
// Lo que el navegador hace SOLO con un campo de contraseña
// ---------------------------------------------------------------------------

/**
 * EL CANAL QUE NO NECESITA UNA LINEA DE JAVASCRIPT PARA ABRIRSE.
 *
 * La Tarea 1 cerro `navigator.credentials.store` —el gestor de contraseñas del
 * navegador, que no es de este origen ni de esta maquina: lo que guarda se
 * sincroniza con la cuenta de quien este en el mostrador y aparece en SU
 * telefono—. Pero ese canal tiene una puerta de atras que no pasa por ninguna
 * linea de codigo: un `<input type="password">` al lado de un campo de usuario
 * es, para el heuristico de Chrome y de Firefox, un formulario de login. Se
 * ofrecen a guardarla, la autorrellenan y la meten en el historial de
 * formularios, y el unico sitio donde eso se puede declarar es el MARCADO.
 *
 * Los trece tapones globales no lo ven: miran los atributos de
 * `document.documentElement` y de `document.body` —LOS DOS ELEMENTOS, no sus
 * descendientes—. Un atributo en un `<input>` de dentro no lo mira nadie.
 *
 * Que los navegadores honran `autocomplete="off"` de forma desigual esta dicho
 * en el docblock de la pantalla y no se finge aqui: esto no afirma que el
 * navegador obedezca, afirma que la pantalla lo PIDE. La defensa de verdad es
 * que nada vuelve a leer el campo y que la mutacion lleva `gcTime: 0`.
 */
describe('lo que el marcado le pide al navegador que NO haga', () => {
  it('el campo de la clave declara `autocomplete="off"`, y el formulario tambien', async () => {
    await montarYEsperar();

    expect(atributoDelCampo('clave', 'autocomplete')).toBe('off');
    expect(document.querySelector('form')?.getAttribute('autocomplete')).toBe('off');

    // Y el de usuario NO dice `username`, que es el valor que le dice al gestor
    // «la credencial de este sitio es la de aqui al lado, ofrecete a
    // guardarla». Es la mitad del par que dispara el heuristico.
    expect(atributoDelCampo('usuario', 'autocomplete')).toBe('off');
  });

  /**
   * NINGUN CONTROL LLEVA `name`, Y ESO ES LO QUE NADIE MIRA.
   *
   * Un `<form>` sin `action` al que se le envia de forma NATIVA navega a la URL
   * actual con los controles que tengan `name` serializados en la query. El
   * `onSubmit` de React que hace `preventDefault()` solo existe DESPUES de la
   * hidratacion: entre que llega el HTML y que llega el JavaScript —o si el
   * chunk no llega nunca, que es un martes cualquiera en la wifi de un
   * gimnasio— pulsar Enter en el campo de la contraseña es un envio NATIVO, y
   * con un `name="clave"` la credencial del servidor de correo acaba en la
   * barra de direcciones, en el historial de la maquina del mostrador y en el
   * `Referer` del siguiente salto.
   *
   * No es un canal que se pueda ejercitar: jsdom NO IMPLEMENTA el envio nativo
   * de formularios, asi que ese camino no existe en ningun test y el tapon de
   * la URL —que si existe— no puede verlo nunca. Lo que se afirma es el
   * MARCADO, que es donde se decide.
   *
   * Se afirma sobre TODOS los controles y por igualdad de la lista: con un
   * `expect(clave.name).toBe('')` a secas, un `name="usuario"` en el campo de
   * al lado seguiria yendose a la URL en el mismo envio.
   */
  it('ningun control del formulario lleva `name`, ni el formulario `action`', async () => {
    await montarYEsperar();

    const formulario = document.querySelector('form');
    const controles = [...document.querySelectorAll('form input, form select, form textarea')];

    // La premisa: hay controles que mirar.
    expect(controles.length).toBeGreaterThanOrEqual(7);
    expect(controles.map((control) => control.getAttribute('name'))).toEqual(
      controles.map(() => null),
    );
    expect(formulario?.getAttribute('action')).toBeNull();
    expect(formulario?.getAttribute('method')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cuando no hay nada que leer, y cuando no se pudo leer
// ---------------------------------------------------------------------------

describe('un 404 no es un fallo', () => {
  /**
   * UN GIMNASIO SIN CORREO CONFIGURADO TIENE FORMULARIO.
   *
   * `verSmtp()` lanza `NotFoundException('Este gimnasio no tiene SMTP
   * configurado')` cuando no hay fila. Si el 404 se dibujara como los demas
   * errores —el motivo y nada mas— un gimnasio recien dado de alta no tendria
   * formulario, y esta pantalla es el UNICO sitio del producto desde el que se
   * puede configurar el correo: seria la bandera apagada que no se puede
   * encender, con el area entera adentro.
   *
   * Y se DICE que los campos estan vacios porque no hay nada, para que un
   * formulario en blanco no se lea como una lectura que fallo.
   */
  it('con un 404 se abre el formulario vacio y se dice por que', async () => {
    await montarYEsperar({
      falloAlLeer: new ErrorDeApi('Este gimnasio no tiene SMTP configurado', 404),
    });

    expect(textoDe('[data-sin-configurar]')).toBe(
      'Este gimnasio todavia no tiene correo configurado: los avisos no salen por ningun lado. ' +
        'Los campos de abajo estan vacios porque no hay nada guardado, no porque no se haya ' +
        'podido leer.',
    );
    expect(textoDe('[data-fallo="lectura"]')).toBeNull();

    // El formulario esta y esta vacio, menos el TLS, que arranca encendido
    // —el lado seguro y el mismo defecto del service— y viaja explicito.
    expect(valorDelCampo('host')).toBe('');
    expect(valorDelCampo('puerto')).toBe('');
    expect(valorDelCampo('clave')).toBe('');
    expect(textoDe('[data-clave-guardada]')).toBe('No hay ninguna contraseña guardada.');

    await escribirEnElCampo('host', 'smtp.nuevo.test');
    await escribirEnElCampo('puerto', '465');
    await escribirEnElCampo('usuario', 'alta@nuevo.test');
    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await escribirEnElCampo('email-origen', 'avisos@nuevo.test');
    await pulsarGuardar();

    expect(llamada(1).cuerpo).toEqual({
      host: 'smtp.nuevo.test',
      puerto: 465,
      seguro: true,
      usuario: 'alta@nuevo.test',
      clave: CENTINELAS.claveSmtp,
      emailOrigen: 'avisos@nuevo.test',
    });
  });

  /**
   * LA OTRA MITAD DEL PAR: UN FALLO DE VERDAD NO TIENE FORMULARIO.
   *
   * Unos campos vacios encima de una configuracion que SI existe se leen como
   * «este gimnasio no tiene correo», y guardar encima la pisaria entera. Es el
   * 404-dibujado-como-dato-vacio de la Fase 10 mirado del otro lado: aqui lo
   * que separa los dos casos es el ESTADO y no el mensaje.
   *
   * Sin este test, el de arriba se cumpliria abriendo el formulario ante
   * cualquier error.
   */
  it('pero un 503 no abre ningun formulario', async () => {
    await montarYEsperar({
      falloAlLeer: new ErrorDeApi('La base de datos del gimnasio no contesta', 503),
    });

    expect(textoDe('[data-fallo="lectura"]')).toBe(
      'No se pudo leer la configuracion del correo: La base de datos del gimnasio no contesta',
    );
    expect(textoDe('[data-sin-configurar]')).toBeNull();
    expect(valorDelCampo('clave')).toBeNull();
    expect(camposDeContrasena()).toEqual([]);
    expect(botonesDelDocumento()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// La puerta de rol
// ---------------------------------------------------------------------------

describe('la puerta de rol', () => {
  /**
   * PARA UN OPERATIVO NO HAY MARCADO, NO HAY PETICION Y NO HAY CAMPO DE
   * CONTRASEÑA.
   *
   * Los cuatro endpoints de correo piden `ADMIN_SALON`. La tercera afirmacion
   * es la de esta pantalla: un `hidden` dejaria el `<input type="password">` en
   * el marcado, y un campo de contraseña en el marcado es lo que el gestor de
   * contraseñas del navegador mira, lo vea alguien o no.
   */
  it('un ADMIN_OPERATIVO no tiene nada en el marcado, ni el campo de la clave', async () => {
    montar({ rol: 'ADMIN_OPERATIVO' });

    // Se pulsa PRIMERO y se afirma despues: con la afirmacion del marcado
    // delante, el test abortaria ahi y la mitad de «no pide» no se ejercitaria.
    for (const boton of botonesDelDocumento()) fireEvent.click(boton);
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(camposDeContrasena()).toEqual([]);
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /** FALLA CERRADA: sin proveedor no hay rol, y eso no alcanza para nada. */
  it('sin proveedor de rol tampoco se dibuja', async () => {
    montar({ rol: null });
    await esperar();

    expect(document.body.textContent).toBe('');
    expect(camposDeContrasena()).toEqual([]);
    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * `rolAlcanza` ES UNA JERARQUIA: un `rol === 'ADMIN_SALON'` dejaria al
   * superadmin fuera de su propio sistema y pasaria todos los demas tests.
   */
  it('un SUPERADMIN entra, porque la puerta es una jerarquia', async () => {
    await montarYEsperar({ rol: 'SUPERADMIN' });

    expect(rutasPedidas()).toEqual([RUTA_DEL_SMTP]);
    expect(camposDeContrasena()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// El eje de la URL, que con una credencial detras es el peor de todos
// ---------------------------------------------------------------------------

/**
 * LA URL SE COPIA SOLA: al historial en disco, al portapapeles de quien comparte
 * el enlace y al `Referer` del siguiente salto, sin dejar rastro en la pestaña
 * de red ni en el marcado. Con la contraseña del servidor de correo delante es
 * el peor canal del navegador, y `cleanup()` no lo toca.
 *
 * El tapon global ya lo vigila contra los centinelas registrados; esto afirma
 * ademas que la URL no cambia EN ABSOLUTO, aunque sea para poner algo inocente.
 */
describe('lo que la pantalla NO escribe en la URL', () => {
  const URL_AL_EMPEZAR = window.location.href;

  it('la URL del documento queda como estaba', async () => {
    await montarYEsperar();

    await escribirEnElCampo('clave', CENTINELAS.claveSmtp);
    await pulsarGuardar();

    expect(window.location.href).toBe(URL_AL_EMPEZAR);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Utilidades que usan `screen` y hay que declarar despues del andamiaje
// ---------------------------------------------------------------------------

/**
 * Desmonta lo montado para poder montar otra vez DENTRO del mismo test.
 *
 * El `cleanup()` global corre entre tests, no entre montajes: sin esto, el
 * segundo `render` de los tests de pares dejaria los dos documentos juntos.
 */
function cleanupEntreMontajes(): void {
  cleanup();
  pedirEspia.mockReset();
}

/** Escribe un valor en un campo, reemplazando lo que hubiera. */
async function escribirEnElCampo(id: string, valor: string): Promise<void> {
  const campo = document.querySelector<HTMLInputElement>(`#${id}`);
  if (campo === null) throw new Error(`No hay ningun campo con id ${id}`);

  const usuario = userEvent.setup();
  await usuario.clear(campo);
  if (valor !== '') await usuario.type(campo, valor);
  await esperar();
}

async function pulsarGuardar(): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: 'Guardar el servidor de correo' }));
  await esperar();
}
