import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, expect, vi } from 'vitest';

/**
 * LOS CANALES POR LOS QUE UNA PANTALLA DICE ALGO FUERA DEL `<body>`.
 *
 * `console.*`, `document.title`, `window.name`, el `<head>` del documento, los
 * tres almacenes del navegador, el buffer de User Timing
 * (`performance.mark` / `performance.measure`), el `src` de una imagen
 * —`new Image()`, que es una peticion de red que no pasa por `fetch` ni por el
 * `<body>`—, las SALIDAS LATERALES —`window.postMessage`,
 * `BroadcastChannel` y `navigator.sendBeacon`—, el almacen de respuestas del
 * navegador (`CacheStorage`), el SERVICE WORKER
 * (`navigator.serviceWorker.controller.postMessage`), que en este producto
 * esta instalado de verdad, INDEXEDDB, que es el QUINTO almacen en disco y
 * el unico sin tope de tamaño, LOS ATRIBUTOS DEL `<html>` Y DEL `<body>`,
 * que son los dos elementos que envuelven al cuerpo y que no desmonta nadie, y
 * LA URL DEL DOCUMENTO —`location` y las cinco puertas de la History API—, que
 * es el hueco ENTRE las dos defensas de este repo y el unico canal que se
 * copia solo. Ninguno lo mira un test de
 * pantalla: los tests
 * miran el marcado DEL CUERPO, los cuerpos de las peticiones, las rutas y las
 * dos caches. Se vigilan todos juntos, GLOBAL —desde `vitest.setup.ts`— y
 * contra EL MISMO registro de datos vigilados, por tres motivos que ya se
 * pagaron una vez cada uno:
 *
 * 1. GLOBAL, porque un agujero de canal no es de una pantalla. El espia de la
 *    consola empezo siendo manual y lo engancharon cinco specs de cuarenta y
 *    nueve: `console.*` estaba sin vigilar en el 90% del paquete, incluida la
 *    ficha de una persona, que es la que enseña la contraseña del reset.
 *
 * 2. UN SOLO REGISTRO, porque pasarle el centinela a cada tapon por separado es
 *    acordarse tres veces. Un spec declara UNA vez lo que sembro y TODOS lo
 *    cubren; el que viene detras no tiene que saber cuantos tapones hay.
 *
 * 3. Y EL REGISTRO ES ABIERTO, no una lista de tres literales. `vigilarElTitulo`
 *    nacio comparando contra `SECRETOS_DEL_PANEL` y nada mas: un `document.title`
 *    con el nombre de una profesora, o con la lista de turnos del dia, pasaba en
 *    verde. Era una lista negra —el patron contra el que este repo predica—
 *    puesta en infraestructura que comparten cuarenta y nueve specs.
 */

/**
 * LOS SECRETOS DEL PANEL, nombrados UNA VEZ CADA UNO.
 *
 * Son los tres datos que esta fase pone delante del mostrador y que no se
 * pueden releer: el codigo con el que un alumno se registra, la contraseña
 * temporal que sale del alta y la que sale del reset.
 *
 * Viven aqui y no en cada spec porque los siembran los specs y los vigila el
 * tapon de abajo: con la cadena escrita en los dos sitios, cambiar la de un
 * spec dejaria al tapon mirando un centinela que ya no existe y pasando en
 * verde para siempre. Cada spec importa de aqui el suyo para sembrarlo.
 *
 * Son LA BASE del registro, no todo el registro: valen en todos los specs
 * —incluidos los que no siembran ninguno, donde no cuestan nada y siguen siendo
 * ciertos— y cada spec agrega los suyos con `vigilarEstosDatos`.
 */
export const SECRETOS_DEL_PANEL = {
  /** El codigo de la clave de invitacion (`/{slug}/admin/invitaciones`). */
  codigoDeInvitacion: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  /** La contraseña temporal que devuelve el alta de un alumno. */
  claveDelAlta: 'Temp0ral!',
  /** La contraseña temporal que devuelve resetear la de alguien. */
  claveDelReset: 'Clave-Temporal-9',
} as const;

/**
 * Lo que ESTE spec considera sensible, ademas de los secretos del panel.
 *
 * Se llama UNA vez, en el cuerpo del modulo del spec —no dentro de un
 * `beforeEach`—: cada archivo de test corre aislado, asi que lo registrado vale
 * para ese archivo y para ninguno mas, y no hay que acordarse por test.
 *
 * Toma un objeto y no cadenas sueltas para que el fallo pueda decir QUE dato se
 * escapo sin ESCRIBIRLO: el mensaje nombra la clave («el titulo de la pagina
 * lleva nombreDeLaAnotada») y el valor no entra en el informe —que acaba en el
 * registro de CI, que lo guarda mas tiempo y lo lee mas gente que la consola
 * del mostrador—. Ver la forma de las afirmaciones en `vigilarLosCanalesDeSalida`.
 */
const vigilados = new Map<string, string>();

export function vigilarEstosDatos(datos: Record<string, string>): void {
  for (const [nombre, valor] of Object.entries(datos)) {
    if (valor.trim() !== '') vigilados.set(nombre, valor);
  }
}

function todoLoVigilado(): [string, string][] {
  return [...Object.entries(SECRETOS_DEL_PANEL), ...vigilados];
}

/**
 * Se vigilan TODOS los metodos de `console`, no una lista escrita a mano.
 *
 * Con cinco nombres fijos, un `console.table(respuesta)` el año que viene
 * vuelve a abrir el agujero entero y el tapon seguiria en verde diciendo otra
 * cosa.
 */
function metodosDeConsola(): string[] {
  const consola = console as unknown as Record<string, unknown>;

  return Object.keys(consola).filter(
    (nombre) =>
      typeof consola[nombre] === 'function' &&
      // `Console` es la clase, no una forma de decir algo. Doblarla rompe a
      // quien construya una consola propia y no aporta nada aqui.
      nombre[0] === nombre[0]?.toLowerCase(),
  );
}

/** Todo lo dicho por la consola, serializado, para buscar dentro. */
function comoTexto(dicho: unknown[]): string {
  return dicho
    .map((parte) => {
      try {
        return `${String(parte)} ${JSON.stringify(parte)}`;
      } catch {
        // Referencias circulares, getters que explotan: lo que no se pueda
        // serializar se mira igual por su representacion de texto.
        return String(parte);
      }
    })
    .join(' ');
}

// ---------------------------------------------------------------------------
// El cuarto canal: la cabecera del documento
// ---------------------------------------------------------------------------

/**
 * Los nodos que YA ESTABAN en el `<head>`, para saber cuales aparecieron.
 *
 * Se guardan los nodos y no su cuenta: con la cuenta sola, un nodo que
 * sustituye a otro pasa en verde.
 */
function nodosDeLaCabecera(): Element[] {
  return [...document.head.children];
}

/**
 * Como nombrar un nodo del `<head>` en un informe SIN publicar lo que lleva.
 *
 * Solo la etiqueta. Ni el `content`, ni el `href`, ni el texto: el nodo que
 * este tapon existe para cazar es justamente el que lleva el dato dentro, y un
 * mensaje de fallo que lo copiara lo mandaria al registro de CI, que es el
 * mismo modo de fallo que el espia de la consola documenta y evita.
 */
function etiquetaDe(nodo: Element): string {
  return `<${nodo.tagName.toLowerCase()}>`;
}

// ---------------------------------------------------------------------------
// El quinto canal: los tres almacenes del navegador
// ---------------------------------------------------------------------------

/**
 * `localStorage`, `sessionStorage` y las galletas, que son TRES sitios en disco.
 *
 * Los dos primeros sobreviven al logout y al cambio de persona —`localStorage`
 * hasta que alguien borre los datos del sitio—; las galletas ademas VIAJAN: se
 * adjuntan a cada peticion al mismo dominio y acaban en los registros de acceso
 * del servidor.
 */
type NombreDeAlmacen = 'localStorage' | 'sessionStorage' | 'galletas';

const ALMACENES: readonly NombreDeAlmacen[] = ['localStorage', 'sessionStorage', 'galletas'];

interface EscrituraEnAlmacen {
  almacen: NombreDeAlmacen;
  clave: string;
  valor: string;
}

/** Lo guardado en un `Storage`, ENTERO. Una lista negra va siempre por detras. */
function contenidoDe(almacen: Storage): Record<string, string> {
  const guardado: Record<string, string> = {};

  for (let indice = 0; indice < almacen.length; indice += 1) {
    const clave = almacen.key(indice);
    if (clave !== null) guardado[clave] = almacen.getItem(clave) ?? '';
  }

  return guardado;
}

/** Las galletas del documento, por nombre. */
function galletasDelDocumento(): Record<string, string> {
  const guardadas: Record<string, string> = {};

  for (const trozo of document.cookie.split(';')) {
    const limpio = trozo.trim();
    if (limpio === '') continue;

    const corte = limpio.indexOf('=');
    if (corte === -1) guardadas[limpio] = '';
    else guardadas[limpio.slice(0, corte)] = limpio.slice(corte + 1);
  }

  return guardadas;
}

/** El estado de los tres, en un objeto, para comparar antes y despues. */
function estadoDeLosAlmacenes(): Record<NombreDeAlmacen, Record<string, string>> {
  return {
    localStorage: contenidoDe(localStorage),
    sessionStorage: contenidoDe(sessionStorage),
    galletas: galletasDelDocumento(),
  };
}

/**
 * EL DESCRIPTOR ORIGINAL DE `document.cookie`, cogido UNA VEZ al cargar.
 *
 * Hay que guardarlo antes de doblar nada: si se leyera desde dentro del
 * `beforeEach` despues de haber enganchado una vez, el segundo enganche
 * envolveria al primero y cada escritura se contaria dos veces.
 */
const GALLETAS_ORIGINALES = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');

/** Lo mismo para `setItem`: el de verdad, cogido antes de doblarlo nunca. */
const PONER_EN_UN_ALMACEN = Storage.prototype.setItem;

/**
 * Deja los tres almacenes como estaban al empezar el test.
 *
 * Se llama DESPUES de haber sacado la foto de lo guardado y ANTES de afirmar
 * nada, para que un test que ensucie no arrastre a los que vengan detras.
 */
function restaurarLosAlmacenes(alEmpezar: Record<NombreDeAlmacen, Record<string, string>>): void {
  for (const [almacen, nombre] of [
    [localStorage, 'localStorage'],
    [sessionStorage, 'sessionStorage'],
  ] as const) {
    almacen.clear();

    for (const [clave, valor] of Object.entries(alEmpezar[nombre])) {
      PONER_EN_UN_ALMACEN.call(almacen, clave, valor);
    }
  }

  for (const clave of Object.keys(galletasDelDocumento())) {
    if (clave in alEmpezar.galletas) continue;
    document.cookie = `${clave}=; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  }
}

// ---------------------------------------------------------------------------
// El sexto canal: el buffer de User Timing
// ---------------------------------------------------------------------------

/**
 * `performance.mark` y `performance.measure`: los dos nombres que pone la pagina.
 *
 * Son el MISMO canal con dos puertas. `measure` crea una entrada con nombre
 * propio igual que `mark` —y acepta ademas un `detail`—, asi que vigilar solo
 * `mark` dejaria la puerta de al lado abierta con la misma linea de codigo.
 */
type TipoDeEntrada = 'mark' | 'measure';

const TIPOS_DE_ENTRADA: readonly TipoDeEntrada[] = ['mark', 'measure'];

/**
 * EL `performance` DE VERDAD Y SU PROTOTIPO, cogidos UNA VEZ al cargar.
 *
 * Dos cosas medidas con una sonda, las dos contraintuitivas:
 *
 * 1. `mark` y `measure` NO son propiedades del objeto `performance` sino de su
 *    prototipo, y ese prototipo NO es `globalThis.Performance.prototype`: en el
 *    entorno de Vitest el `Performance` global es el de Node y el `performance`
 *    global es el de jsdom. Un `vi.spyOn(Performance.prototype, 'mark')` revienta
 *    con «mark does not exist». Hay que sacarlo del objeto.
 *
 * 2. `vi.useFakeTimers()` SIN `toFake` SUSTITUYE EL OBJETO `performance` ENTERO
 *    por el falso de sinon. Guardando el de verdad, leer el buffer y vaciarlo
 *    siguen funcionando aunque un test deje los relojes falsos puestos. Ver el
 *    punto ciego documentado en `vigilarLosCanalesDeSalida`.
 */
const EL_CRONOMETRO = performance;
const PROTOTIPO_DEL_CRONOMETRO = Object.getPrototypeOf(performance) as Performance;
const MARCAR = PROTOTIPO_DEL_CRONOMETRO.mark;
const MEDIR = PROTOTIPO_DEL_CRONOMETRO.measure;

/** Una entrada de User Timing vista por el espia: el nombre y el `detail`. */
interface EntradaDeTiempo {
  tipo: TipoDeEntrada;
  nombre: string;
  detalle: unknown;
}

/**
 * El `detail` de una entrada, que es la SEGUNDA mitad del canal.
 *
 * `performance.mark(nombre, { detail })` guarda el `detail` en la entrada, y
 * `entrada.toJSON()` lo devuelve: sale entero en cualquier volcado de
 * rendimiento. Medido con una sonda en jsdom 26 —`{"secreto":"..."}` dentro del
 * `toJSON()`—, asi que no basta con mirar el nombre. El getter deserializa, y
 * si explota se mira la entrada igualmente por su nombre.
 */
function detalleDe(entrada: PerformanceEntry): unknown {
  try {
    return (entrada as { detail?: unknown }).detail;
  } catch {
    return undefined;
  }
}

/** Lo que haya en el buffer de verdad, aunque alguien haya cambiado `performance`. */
function entradasDelBuffer(tipo: TipoDeEntrada): EntradaDeTiempo[] {
  return EL_CRONOMETRO.getEntriesByType(tipo).map((entrada) => ({
    tipo,
    nombre: entrada.name,
    detalle: detalleDe(entrada),
  }));
}

/** El `detail` que lleva el segundo argumento de `mark` o de `measure`, si lo lleva. */
function detalleDeLasOpciones(opciones: unknown): unknown {
  if (typeof opciones !== 'object' || opciones === null) return undefined;
  return (opciones as { detail?: unknown }).detail;
}

/** Nombres y detalles de un tipo, serializados, para buscar centinelas dentro. */
function comoTextoLasEntradas(entradas: EntradaDeTiempo[], tipo: TipoDeEntrada): string {
  return entradas
    .filter((entrada) => entrada.tipo === tipo)
    .map((entrada) => `${entrada.nombre} ${comoTexto([entrada.detalle])}`)
    .join(' ');
}

// ---------------------------------------------------------------------------
// El septimo canal: las imagenes que la pagina pide por su cuenta
// ---------------------------------------------------------------------------

/**
 * `new Image().src = '…'`: UNA PETICION DE RED QUE NO PASA POR `fetch`.
 *
 * El canal es el `src` de una imagen, y lo que lo hace peligroso es que las
 * seis puertas de arriba y las listas blancas de peticiones lo dejan pasar
 * ENTERO. Una imagen creada con `new Image()` nunca se adjunta al documento:
 * no esta en el `<body>` —ni `screen.*`, ni `document.body.innerHTML`, ni los
 * `querySelectorAll` la ven—, no esta en el `<head>`, no dice nada por la
 * consola, no toca el titulo ni el nombre de la pestaña ni ninguno de los tres
 * almacenes, no deja marca de rendimiento, no entra en ninguna de las dos
 * caches y NO ES UN `fetch`, asi que el test de «no habla con la red por fuera
 * de `pedir`» —que dobla el `fetch` global— pasa en verde.
 *
 * Y sale igual. El navegador pide esa URL de verdad, CON LA COOKIE de sesion
 * si el destino la comparte, y la URL entera —con lo que lleve en el query—
 * queda en el registro de acceso del servidor del otro lado, en la pestaña de
 * red y en los breadcrumbs de cualquier SDK de errores que se enchufe mañana.
 * Medido en esta fase: un `pixel.src = \`…/uso.gif?d=${JSON.stringify(datos)}\``
 * en un `useEffect` de la pantalla de Analisis —con el reporte entero dentro—
 * paso los 1326 tests del paquete y el `tsc`.
 *
 * Y PASA UNA REVISION SIN HACER RUIDO: parece una precarga, o una metrica de
 * uso. Es la misma forma de las seis anteriores —agregar algo que no deberia
 * estar, sin quitar nada, donde nadie estaba mirando—.
 *
 * SE AFIRMA SOBRE CENTINELAS Y NO SOBRE «NINGUNA IMAGEN», que es la diferencia
 * con `window.name`. Pedir imagenes es legitimo y este repo ya lo hace: la
 * portada de un gimnasio pinta su logo con un `<img>` de URL externa y
 * arbitraria (`src/app/[slug]/page.tsx`). Un canal que prohiba las imagenes se
 * desactiva el dia que alguien necesite una. Lo que no es legitimo es meter un
 * dato del mostrador en la URL.
 */
const SRC_DE_UNA_IMAGEN = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');

// ---------------------------------------------------------------------------
// El octavo canal: las salidas laterales
// ---------------------------------------------------------------------------

/**
 * TRES PUERTAS QUE NO SON `fetch` NI EL DOM: mensajes, difusion y baliza.
 *
 * El septimo canal cubrio la peticion de red que no pasa por `fetch`. Este
 * cubre las que NI SIQUIERA SON UNA PETICION, o lo son por un camino que el
 * `fetch` doblado no toca:
 *
 * - `window.postMessage(datos, '*')`. No es red, no es DOM, no es almacen: es
 *   un evento `message` en esta misma ventana. Lo recibe CUALQUIER script que
 *   comparta la pagina —una etiqueta de analitica, un chat embebido, el
 *   content script de cualquier extension del navegador del mostrador— con
 *   una linea de `addEventListener('message', …)`. Y la forma de al lado,
 *   `parent.postMessage(datos, '*')`, se la lleva el documento que nos enmarca
 *   AUNQUE SEA DE OTRO ORIGEN, que es justamente lo que el segundo argumento
 *   existe para impedir y lo que `'*'` renuncia a impedir. En este entorno las
 *   dos caen por el mismo sitio: MEDIDO, `window.parent`, `window.top` y
 *   `window.self` son el MISMO objeto que `window`, asi que doblar una puerta
 *   cubre las tres escrituras.
 *
 * - `new BroadcastChannel(nombre).postMessage(datos)`. Lo recibe cualquier
 *   OTRA PESTAÑA del mismo origen, que en la maquina del mostrador es la
 *   pestaña que dejo abierta la persona del turno anterior. No hay peticion,
 *   no hay rastro en la pestaña de red y no sobrevive a ninguna revision
 *   porque parece sincronizacion entre pestañas, que es para lo que existe.
 *
 * - `navigator.sendBeacon(url, cuerpo)`. SI es una peticion de red, y es la
 *   peor de las tres: el navegador la manda aunque la pestaña se este
 *   cerrando —ese es su proposito—, no pasa por `fetch`, no se puede cancelar
 *   y no devuelve nada que mirar. El test de «no habla con la red por fuera de
 *   `pedir`», que dobla el `fetch` global, la deja pasar entera.
 *
 * SE AFIRMA POR CENTINELAS, no por «ninguna llamada», igual que el canal de
 * imagenes y por el mismo motivo: comunicarse es legitimo —sincronizar dos
 * pestañas del panel con un `BroadcastChannel` seria una buena idea el dia que
 * haga falta— y un canal que lo prohiba se desactiva el dia que alguien lo
 * necesite. Lo que no es legitimo es que el mensaje lleve un dato del
 * mostrador dentro.
 *
 * Y SE MIRA EL OBJETO ENTERO, serializado, no las cadenas de primer nivel: la
 * mutacion que abrio este canal mandaba `{ tipo: 'analisis:caja-lista', caja }`
 * con el reporte entero anidado en la segunda clave. Es lo mismo que hace el
 * canal del `detail` de `performance.mark`, y por eso reusa `comoTexto`.
 */

/**
 * `postMessage` ES UN ACCESOR DE `window`, Y NO ESTA EN NINGUN PROTOTIPO.
 *
 * La misma trampa que `performance`, en otra forma, y tambien MEDIDA en vez de
 * leida. Dos cosas que no se adivinan:
 *
 * 1. `Object.getPrototypeOf(window)` NO es `Window.prototype` en este entorno
 *    —es un `Object` pelado, porque Vitest monta el global de jsdom a mano—, y
 *    `postMessage` no esta en el prototipo sino como propiedad PROPIA de
 *    `window`. Un `vi.spyOn(Window.prototype, 'postMessage')` no existe y un
 *    `Object.getPrototypeOf(window)` no lleva a ninguna parte: hay que cogerlo
 *    del objeto.
 *
 * 2. Esa propiedad propia es un ACCESOR (`get`/`set`), no un metodo: su
 *    descriptor trae `get` y `set` y no trae `value`. Por eso se engancha
 *    redefiniendola —como las galletas y el `src` de una imagen— y no con un
 *    `vi.spyOn`, y por eso la funcion de verdad se lee UNA VEZ al cargar, por
 *    el getter, antes de redefinir nada: leerla desde dentro del `beforeEach`
 *    despues del primer enganche envolveria el envoltorio de ayer y contaria
 *    cada mensaje dos veces.
 */
const MANDAR_UN_MENSAJE = window.postMessage;

/**
 * EL PROTOTIPO DEL CANAL DE DIFUSION, sacado de UNA INSTANCIA y no de la clase.
 *
 * Por la leccion de `performance`: el global de una API y su clase pueden ser
 * dos cosas distintas. Aqui MEDIDO resultan ser la misma
 * —`Object.getPrototypeOf(new BroadcastChannel(…)) === BroadcastChannel.prototype`—,
 * pero se saca igual del objeto, que es lo que no depende de que siga siendo
 * cierto. El canal de la sonda se cierra en el acto: no escucha nada.
 */
const PROTOTIPO_DEL_CANAL = (() => {
  const sonda = new BroadcastChannel('espia-de-consola:sonda');
  const prototipo = Object.getPrototypeOf(sonda) as BroadcastChannel;
  sonda.close();
  return prototipo;
})();

const DIFUNDIR = PROTOTIPO_DEL_CANAL.postMessage;

/**
 * `navigator.sendBeacon` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido: `typeof navigator.sendBeacon` es `'undefined'` y no hay descriptor
 * en `Navigator.prototype`. Eso NO es cobertura, aunque lo parezca. Es verdad
 * que `navigator.sendBeacon(url, cuerpo)` a pelo revienta con un `TypeError` y
 * el test cae solo; pero la forma que escribe cualquiera que programe con
 * cuidado —`navigator.sendBeacon?.(url, cuerpo)`, o detras de un
 * `if ('sendBeacon' in navigator)`— no revienta: NO HACE NADA y pasa en verde,
 * mientras en el navegador del mostrador manda la peticion. El agujero se
 * cierra justo en la forma del codigo que mas probable es encontrar.
 *
 * Asi que el espia la DEFINE. El precio, dicho entero: a partir de aqui la
 * deteccion de capacidades ve una baliza que jsdom no tiene, y una pantalla
 * que pregunte `'sendBeacon' in navigator` tomara el camino de la baliza en
 * los tests. Hoy no lo pregunta nadie —no hay un solo `sendBeacon` en
 * `src/`—, y el cambio acerca el entorno al navegador de verdad en lugar de
 * alejarlo, que es la direccion correcta para una infraestructura de tests.
 *
 * Y es la UNICA puerta del espia que no «registra y deja pasar»: no hay nada
 * por debajo a lo que reenviar. Devuelve `true`, que es lo que devuelve un
 * navegador cuando acepta encolar la baliza.
 */
const PROTOTIPO_DEL_NAVEGANTE = Object.getPrototypeOf(navigator) as Navigator;

/**
 * El cuerpo de una baliza, en texto, para buscar centinelas dentro.
 *
 * `sendBeacon` acepta cualquier `BodyInit`, y el dato se puede ir por
 * cualquiera de esas formas. Un `JSON.stringify` del objeto no sirve: un
 * `URLSearchParams` serializa a `{}` y un `FormData` tambien.
 */
function cuerpoDeUnaBaliza(cuerpo: unknown): string {
  if (cuerpo === undefined || cuerpo === null) return '';
  if (typeof cuerpo === 'string') return cuerpo;
  if (cuerpo instanceof URLSearchParams) return cuerpo.toString();

  if (cuerpo instanceof FormData) {
    return [...cuerpo.entries()].map(([clave, valor]) => `${clave}=${String(valor)}`).join('&');
  }

  if (cuerpo instanceof ArrayBuffer || ArrayBuffer.isView(cuerpo)) {
    try {
      return new TextDecoder().decode(cuerpo as ArrayBuffer);
    } catch {
      return '';
    }
  }

  if (cuerpo instanceof Blob) return textoDeUnBlob(cuerpo);

  return comoTexto([cuerpo]);
}

/**
 * LOS BYTES DE UN `Blob`, LEIDOS POR DENTRO, porque no hay forma sincrona.
 *
 * La plataforma solo ofrece `text()` y `arrayBuffer()`, que devuelven
 * promesas, y `sendBeacon` devuelve un booleano: o se lee aqui mismo o un
 * cuerpo de tipo `Blob` —que es la forma que recomienda la documentacion de
 * `sendBeacon` para mandar JSON con su `Content-Type`— no se mira nunca.
 *
 * MEDIDO en jsdom 26: el `Blob` tiene UNA sola clave propia, un simbolo, y
 * detras hay un objeto de implementacion con `_buffer` —el `Buffer` de Node
 * con el contenido—. Se busca por simbolo y no por nombre porque el nombre del
 * simbolo es interno de jsdom; si algun dia deja de estar, esto devuelve
 * cadena vacia y el canal pierde SOLO la forma `Blob`, sin romper nada.
 */
function textoDeUnBlob(blob: Blob): string {
  for (const simbolo of Object.getOwnPropertySymbols(blob)) {
    const implementacion = (blob as unknown as Record<symbol, unknown>)[simbolo];
    if (typeof implementacion !== 'object' || implementacion === null) continue;

    const bytes = (implementacion as { _buffer?: unknown })._buffer;
    if (bytes !== undefined && bytes !== null) return String(bytes);
  }

  return '';
}

// ---------------------------------------------------------------------------
// El noveno canal: el almacen de respuestas del navegador (CacheStorage)
// ---------------------------------------------------------------------------

/**
 * `caches` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda: `typeof globalThis.caches` es `'undefined'` en jsdom
 * 26. Igual que con `sendBeacon`, eso NO es cobertura aunque lo parezca. Un
 * `caches.open(...)` a pelo revienta con un `TypeError` y el test cae solo;
 * pero la forma que escribe cualquiera que programe con cuidado
 * —`globalThis.caches?.open(...)`, o detras de un `if ('caches' in window)`—
 * NO HACE NADA y pasa en verde, mientras en el navegador del mostrador
 * escribe en disco.
 *
 * POR QUE ESTE CANAL Y NO OTRO: ESTE REPO YA TIENE LA REGLA ESCRITA, Y DEL
 * OTRO LADO. `src/app/sw.ts` va a propagar que el panel del admin no entra
 * nunca en la cache, con el motivo entero: «un listado de gente con nombres,
 * emails y telefonos quedaria en la CacheStorage del navegador del mostrador,
 * que es una computadora compartida, legible por quien se siente despues». El
 * service worker lo cumple con una LISTA BLANCA de dos rutas del alumno.
 *
 * Lo que nadie miraba es que **una pantalla puede escribir en la CacheStorage
 * por su cuenta**, sin pasar por el service worker ni por su lista blanca: son
 * dos puertas al mismo almacen y la politica solo custodiaba una. Un
 * `caches.open('lo-mio').then((c) => c.put(ruta, new Response(datos)))` dentro
 * de un `useEffect` —la forma de «que al volver atras salga instantanea»—
 * guarda los nombres de los alumnos en el disco de una maquina compartida, y
 * ahi se quedan: la CacheStorage sobrevive al cierre de sesion, al cierre de
 * la pestaña y al reinicio, y se lee desde las herramientas del navegador sin
 * ninguna contraseña. Medido: esa mutacion paso los 1375 tests del paquete.
 *
 * ES UN CUARTO ALMACEN, y se afirma como los otros tres: por CENTINELAS y
 * ademas por «no se guardo NADA». Lo segundo no es exagerado aqui, es
 * exactamente la politica que ya existe: ninguna pantalla del panel tiene nada
 * que hacer escribiendo en este almacen, y el unico que si lo usa —el service
 * worker— no es una pantalla y no corre en estos tests.
 *
 * LO QUE ESTE TAPON NO MIRA, dicho sin adornar: EL CUERPO de la respuesta
 * guardada. `Response.text()` es asincrono y `put()` se registra en el acto,
 * asi que leerlo aqui obligaria a volver asincrono el `afterEach` entero —que
 * tiene un orden delicado con `cleanup()`— a cambio de poco: mientras la
 * afirmacion sea «no se guardo nada», el cuerpo nunca llega a existir. El dia
 * que alguien necesite una excepcion para guardar algo legitimo, esa excepcion
 * tendra que traerse el cuerpo consigo.
 *
 * El precio, dicho entero: a partir de aqui la deteccion de capacidades ve un
 * almacen que jsdom no tiene, y una pantalla que pregunte `'caches' in window`
 * tomara ese camino en los tests. Hoy no lo pregunta nadie —no hay un solo
 * `caches` en `src/` fuera de esto—, y el cambio acerca el entorno al
 * navegador de verdad en lugar de alejarlo.
 */
const CACHES_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'caches');

/** Bajo que nombre se guardo una respuesta: la clave de la entrada. */
function claveDeUnaPeticion(peticion: unknown): string {
  if (typeof peticion === 'string') return peticion;
  if (peticion instanceof URL) return peticion.href;

  if (typeof peticion === 'object' && peticion !== null && 'url' in peticion) {
    return String((peticion as { url: unknown }).url);
  }

  return String(peticion);
}

/** Una entrada escrita en el almacen de respuestas. */
interface RespuestaGuardada {
  almacen: string;
  clave: string;
}

// ---------------------------------------------------------------------------
// El decimo canal: el service worker, que SI existe en este producto
// ---------------------------------------------------------------------------

/**
 * `navigator.serviceWorker` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda: `typeof navigator.serviceWorker` es `'undefined'` en
 * jsdom 26 y no hay descriptor en `Navigator.prototype`. Igual que con la
 * baliza y que con `caches`, eso NO es cobertura aunque lo parezca. Un
 * `navigator.serviceWorker.controller.postMessage(datos)` a pelo revienta con
 * un `TypeError` y el test cae solo; la forma que escribe cualquiera que
 * programe con cuidado —`navigator.serviceWorker?.controller?.postMessage(…)`,
 * o detras de un `if ('serviceWorker' in navigator)`— NO HACE NADA y pasa en
 * verde, mientras en el navegador del mostrador entrega el dato.
 *
 * POR QUE ES UN CANAL DISTINTO DE LOS DOS `postMessage` QUE YA SE VIGILAN, y
 * no una tercera forma del mismo. Los otros dos se doblan por donde viven:
 * `window.postMessage` como propiedad propia de `window`, y el de difusion en
 * `BroadcastChannel.prototype`. El de un `ServiceWorker` vive en
 * `ServiceWorker.prototype`, que es una tercera funcion y en jsdom NI SIQUIERA
 * EXISTE: los dos taponazos de arriba pueden estar puestos y este mensaje
 * pasar entero por el medio. Se midio: un `postMessage` al controlador con el
 * nombre de un alumno y el `tenantId` dentro paso los 1421 tests del paquete
 * con los nueve canales enchufados.
 *
 * Y POR QUE IMPORTA EN ESTE PRODUCTO Y NO EN ABSTRACTO: AQUI HAY UN SERVICE
 * WORKER DE VERDAD. `src/app/sw.ts` existe, `next.config` lo monta con
 * `@serwist/next` y `componentes/boton-de-push.tsx` ya habla con el. O sea que
 * `navigator.serviceWorker.controller` NO es `null` en el mostrador: es un hilo
 * que sobrevive al cierre de la pestaña, corre con el origen del panel y puede
 * hacer `fetch` y `caches.put` con lo que reciba. Mandarle un dato es sacarlo
 * del alcance de los otros nueve tapones de un salto: el `caches` que se
 * vigila es el que abre LA PAGINA, y el que abriria el worker con este mensaje
 * no lo ve nadie. Es la misma asimetria que el noveno canal cerro por el otro
 * lado —la pagina escribiendo en el almacen del worker— vista desde aqui.
 *
 * El precio, dicho entero: a partir de aqui la deteccion de capacidades ve un
 * `serviceWorker` que jsdom no tiene. Se midio a quien le cambia algo y la
 * respuesta es a nadie: el unico sitio de `src/` que lo pregunta es
 * `elNavegadorPuede()` en `boton-de-push.tsx`, y pide ADEMAS `Notification` y
 * `PushManager`, que siguen sin existir. Y `boton-de-push.spec.tsx` instala el
 * suyo con `Object.defineProperty` en su propio `beforeEach`, que corre
 * DESPUES de este: el del spec gana, como tiene que ser.
 */
const SERVICE_WORKER_ORIGINAL = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');

/**
 * EL PORTAPAPELES NO SE VIGILA, Y ESTA ESCRITO AQUI PARA QUE NO SE REABRA.
 *
 * Es el cuarto vecino de esta familia y el unico que se queda fuera. No por
 * pereza: por dos medidas y una asimetria, en ese orden.
 *
 * 1. NO SE PUEDE VER DESDE AQUI. `navigator.clipboard` no existe en jsdom
 *    —medido—, asi que el unico portapapeles que hay en un test es el que
 *    instala un spec. Y los tres specs que lo ejercitan
 *    (`usuarios/nuevo/clave-temporal`, `usuarios/nuevo/page`, `invitaciones/page`)
 *    lo instalan con `Object.defineProperty(navigator, 'clipboard', …)`
 *    —propiedad PROPIA de `navigator`— DENTRO del cuerpo del test, o sea
 *    DESPUES de cualquier `beforeEach`. Medido con una sonda que hacia
 *    exactamente eso: el doble del tapon registro CERO escrituras y el del
 *    spec se llevo la llamada. Un espia global del portapapeles estaria ciego
 *    en los tres unicos sitios donde el portapapeles se usa, y «funcionando»
 *    en los cincuenta y siete donde no se puede usar. Verde y ciego es
 *    exactamente el modo de fallo que el resto de este archivo existe para
 *    evitar.
 *
 * 2. Y NO SE PUEDE AFIRMAR POR CENTINELAS. El panel copia secretos A
 *    PROPOSITO, y no en un sitio sino en DOS: `clave-temporal.tsx` copia la
 *    contraseña temporal del alta (`claveDelAlta`) e `invitaciones/page.tsx`
 *    copia el codigo de invitacion (`codigoDeInvitacion`). Los dos son
 *    centinelas registrados. «Ningun centinela sale por el portapapeles» seria
 *    rojo con el codigo correcto en las dos pantallas.
 *
 * SE MIRO EL CRITERIO QUE LOS DISTINGUIRIA, y existe: una copia deliberada
 * ocurre mientras se despacha un gesto de la persona y una copia accidental no.
 * Es medible —`window.event` esta presente durante un `dispatchEvent` y es
 * `undefined` fuera de el, medido con una sonda; `navigator.userActivation`, que
 * seria lo correcto, no existe en jsdom—. No se usa igualmente por dos cosas:
 * no arregla el punto 1, que es el que decide; y convierte el canal en una
 * regla sobre COMO se escribe una copia legitima, no sobre si se filtra algo.
 * Un boton de copiar que hiciera `await` de cualquier cosa antes del
 * `writeText` —formatear, pedir el dato— se pondria rojo con el codigo
 * correcto. Un canal que obliga a escribir el codigo bueno de una forma
 * concreta es el que alguien desactiva.
 *
 * LO QUE CUBRE EL HUECO MIENTRAS TANTO, dicho sin adornar. En los cincuenta y
 * siete specs que no instalan un doble, `navigator.clipboard` es `undefined` y
 * un `navigator.clipboard.writeText(dato)` revienta con un `TypeError`
 * —medido—, asi que el test cae. Y en los dos sitios que SI copian, el spec de
 * cada pantalla ya afirma que no se copia sola: «no se copia nada hasta que
 * alguien lo pide» en `clave-temporal.spec.tsx` y «no se copia solo al
 * portapapeles: copiar es una accion que se pide» en `invitaciones/page.spec.tsx`.
 *
 * EL AGUJERO QUE QUEDA, para que nadie lo descubra creyendo que esto lo tapaba:
 * un `await navigator.clipboard?.writeText(dato)` dentro de un `try/catch`, en
 * una pantalla que no instale doble, no revienta —se traga el `TypeError`— y
 * pasa en verde. Eso se tapa el dia que `navigator.clipboard` se monte UNA vez
 * para todo el paquete, desde aqui, en lugar de spec a spec; mientras los
 * specs se lo pisen a mano, este canal no se puede vigilar sin una excepcion
 * que lo vacie, y una excepcion que lo vacie es peor que no tenerlo.
 */

// ---------------------------------------------------------------------------
// El undecimo canal: IndexedDB, EL QUINTO ALMACEN
// ---------------------------------------------------------------------------

/**
 * `indexedDB` NO EXISTE EN JSDOM, y por eso hay que PONERLO.
 *
 * Medido con una sonda en jsdom 26: `typeof globalThis.indexedDB` es
 * `'undefined'`, `'indexedDB' in window` es `false`, no hay descriptor ni en
 * `window` ni en `globalThis`, y NINGUNA de las doce clases de la familia
 * —`IDBFactory`, `IDBDatabase`, `IDBObjectStore`, `IDBTransaction`,
 * `IDBRequest`, `IDBOpenDBRequest`, `IDBCursor`, `IDBCursorWithValue`,
 * `IDBIndex`, `IDBKeyRange`, `IDBVersionChangeEvent`— existe tampoco. Es la
 * misma situacion que `sendBeacon`, que `caches` y que `serviceWorker`, y la
 * misma leccion que ya dejo cuatro fugas: UNA API QUE JSDOM NO IMPLEMENTA ES
 * UN SITIO DONDE NADIE MIRA POR CONSTRUCCION. Un `indexedDB.open(...)` a pelo
 * revienta con un `ReferenceError` y el test cae solo; pero la forma que
 * escribe cualquiera que programe con cuidado —`globalThis.indexedDB?.open(…)`,
 * o detras de un `if ('indexedDB' in window)`— NO HACE NADA y pasa en verde,
 * mientras en el navegador del mostrador escribe en disco.
 *
 * (Y se define sobre `globalThis`, como `caches`: MEDIDO, en este entorno
 * `window === globalThis`, asi que el `window.indexedDB` de una pantalla y el
 * `globalThis.indexedDB` de un modulo son la misma propiedad.)
 *
 * POR QUE ES UN ALMACEN DISTINTO Y NO UNA FORMA MAS DE LOS QUE YA SE VIGILAN.
 * El tapon de «los tres almacenes» es una LISTA CERRADA —`localStorage`,
 * `sessionStorage` y las galletas— y `CacheStorage` se agrego en su dia por ser
 * un CUARTO almacen. IndexedDB es el QUINTO, y es PEOR que los tres primeros en
 * las tres cosas que importan:
 *
 *  - SOBREVIVE IGUAL. Al logout, al cierre de la pestaña y al reinicio, como
 *    `localStorage`, y se lee desde las herramientas del navegador sin ninguna
 *    contraseña, en una maquina que usan cuatro personas por turno.
 *  - NO TIENE TOPE DE 5 MB. Donde `localStorage` obliga a elegir que guardar,
 *    aqui cabe el listado entero.
 *  - GUARDA OBJETOS ESTRUCTURADOS. `setItem` obliga a serializar —o sea, a
 *    PENSAR que se esta guardando—; `put(variables)` mete el objeto entero sin
 *    que nadie tenga que acordarse de nada.
 *
 * LA MUTACION QUE LO DESCUBRIO, medida: tres lineas en `useGuardarSmtp` que
 * parecen una cortesia —«un borrador del formulario, por si alguien recarga a
 * medio configurar»— guardaban `variables` enteras en `boxadmin-config` /
 * `borradores` bajo la clave `smtp`: host, usuario y LA CLAVE DEL SERVIDOR DE
 * CORREO EN CLARO. Sobrevivio los 1481 tests del paquete con los diez canales
 * enchufados. Y es el unico sitio del panel por el que pasa una credencial de
 * servidor: `ConfiguracionSmtpPublica` no la devuelve ni enmascarada, asi que
 * ese disco es el unico lugar del mundo, fuera del cifrado de la API, donde
 * esa cadena queda escrita.
 *
 * SE AFIRMA POR LA FORMA FUERTE —«no se abrio NINGUNA base»— Y NO POR
 * CENTINELAS, que es la decision de este canal y esta MEDIDA, no leida:
 *
 *  1. No hay un solo `indexedDB`, `IDB*` ni `idb` en `apps/web/src`. Medido con
 *     `grep -rniE "indexeddb|IDBDatabase|IDBObjectStore|IDBCursor|idb"`: cero
 *     coincidencias. El producto no tiene NINGUN uso legitimo de esta puerta.
 *  2. La duda real era el arbol de dependencias, porque las librerias de
 *     service worker suelen usar IndexedDB para su propio estado — y aqui
 *     `serwist` lo hace: `node_modules/serwist/dist/index.mjs` importa
 *     `openDB` de `idb` y lo usa en la expiracion de caches. Pero eso NO corre
 *     en estos tests, y tambien esta medido: el unico spec que toca el worker
 *     —`src/app/sw.spec.ts`— sustituye `serwist` y `@serwist/next/worker`
 *     ENTEROS con `vi.mock`, asi que el modulo de verdad no se carga nunca. La
 *     comprobacion que decide no es esa lectura sino la del paquete completo:
 *     con este tapon puesto y la afirmacion fuerte, los 65 specs siguen en
 *     verde, o sea que NADIE del arbol abre una base durante un test.
 *
 * Es el mismo criterio que separa `window.name` —forma fuerte, porque el
 * producto no tiene ningun uso legitimo de esa puerta— del `src` de una
 * imagen, de las salidas laterales, de `CacheStorage` y del service worker
 * —centinelas, porque pintar un logo, sincronizar pestañas, medir latencia o
 * hablarle al worker SI son legitimos y un canal que los prohiba es de los que
 * alguien desactiva el dia que los necesita—. Aqui no hay nada que desactivar:
 * ninguna pantalla del panel tiene nada que hacer abriendo una base. Y la
 * forma fuerte caza ademas EL DATO QUE NADIE REGISTRO, que es justamente el
 * caso de un `put(variables)` que se lleva el objeto entero.
 *
 * Se afirman IGUALMENTE los centinelas, y antes que la forma fuerte, para que
 * el informe diga QUE dato se fue cuando se fue uno conocido: un
 * «una escritura en IndexedDB lleva claveDelReset» dice mas que un
 * «la pantalla escribio en IndexedDB».
 *
 * EL PRECIO, DICHO ENTERO: a partir de aqui la deteccion de capacidades ve una
 * base de datos que jsdom no tiene, y una pantalla que pregunte
 * `'indexedDB' in window` tomara ese camino en los tests. Hoy no lo pregunta
 * nadie —punto 1 de arriba—, y el cambio acerca el entorno al navegador de
 * verdad en lugar de alejarlo, que es la direccion correcta para una
 * infraestructura de tests.
 *
 * LO QUE ESTE TAPON NO MONTA, para que nadie lo descubra creyendo que lo
 * cubria: las doce CLASES de la familia siguen sin existir. Un
 * `IDBKeyRange.only(dato)` revienta con un `ReferenceError` y el test cae
 * —que es el comportamiento bueno—, y la forma prudente `globalThis.IDBKeyRange?.only(…)`
 * devuelve `undefined`, que es un rango vacio aceptable para los cursores de
 * mentira de abajo. Montarlas seria simular una base de datos; esto no esta
 * para eso, esta para que una escritura hacia ella no sea invisible.
 */
const INDEXED_DB_ORIGINAL = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');

/** Una escritura que paso por IndexedDB, con la PUERTA por la que entro. */
interface EscrituraEnLaBase {
  /** `put`, `add` o `cursor.update`: por cual de las tres entro. */
  puerta: string;
  base: string;
  almacen: string;
  /** La clave, en texto. Un `put(1, claveSecreta)` esconde el dato AQUI. */
  clave: string;
  /** El valor TAL CUAL, que puede ser un objeto anidado. Se serializa al mirar. */
  valor: unknown;
}

/** Un registro guardado en el almacen de mentira, para que los cursores tengan que recorrer. */
interface RegistroDeLaBase {
  clave: unknown;
  valor: unknown;
}

/**
 * Los oyentes de `addEventListener` de cada objeto de mentira, por fuera.
 *
 * En un `WeakMap` y no como propiedad del objeto para que la lista no aparezca
 * al serializar nada ni al recorrer las claves de un cursor.
 */
const OYENTES_DE_LA_BASE = new WeakMap<object, Map<string, ((evento: unknown) => void)[]>>();

function oyentesDe(objetivo: object): Map<string, ((evento: unknown) => void)[]> {
  let mapa = OYENTES_DE_LA_BASE.get(objetivo);

  if (mapa === undefined) {
    mapa = new Map();
    OYENTES_DE_LA_BASE.set(objetivo, mapa);
  }

  return mapa;
}

/** Le pone `addEventListener`/`removeEventListener` a un objeto de mentira. */
function conOyentes(cuerpo: Record<string, unknown>): Record<string, unknown> {
  cuerpo.addEventListener = (tipo: unknown, oyente: unknown) => {
    if (typeof oyente !== 'function') return;
    const mapa = oyentesDe(cuerpo);
    mapa.set(String(tipo), [
      ...(mapa.get(String(tipo)) ?? []),
      oyente as (evento: unknown) => void,
    ]);
  };

  cuerpo.removeEventListener = (tipo: unknown, oyente: unknown) => {
    const mapa = oyentesDe(cuerpo);
    mapa.set(
      String(tipo),
      (mapa.get(String(tipo)) ?? []).filter((otro) => otro !== oyente),
    );
  };

  cuerpo.dispatchEvent = () => true;

  return cuerpo;
}

/**
 * LAS DOS FORMAS DE ESCUCHAR UN EVENTO DE INDEXEDDB, y hacen falta las dos.
 *
 * `peticion.onsuccess = …` —la que escribe todo el mundo— y
 * `peticion.addEventListener('success', …)` —la que escribe quien ya se quemo
 * pisando un `onsuccess` ajeno—. Cubrir solo una dejaria la puerta de al lado
 * abierta cambiando una palabra, que es exactamente lo que pasaba con `mark` y
 * `measure`.
 *
 * El evento lleva `target` porque la forma mas comun de leer el resultado no es
 * `peticion.result` sino `evento.target.result`.
 */
function dispararEnLaBase(objetivo: Record<string, unknown>, tipo: string): void {
  const evento = { type: tipo, target: objetivo, currentTarget: objetivo };
  const propio = objetivo[`on${tipo}`];

  if (typeof propio === 'function') {
    (propio as (evento: unknown) => void).call(objetivo, evento);
  }

  for (const oyente of oyentesDe(objetivo).get(tipo) ?? []) {
    oyente.call(objetivo, evento);
  }
}

/**
 * APLAZAR SIN RELOJ: una microtarea de PROMESA NATIVA, no `queueMicrotask`.
 *
 * Hay que aplazar, y no es un detalle de fidelidad sino LO QUE DECIDE SI EL
 * TAPON VE ALGO. La forma de la fuga es siempre esta:
 *
 *     const apertura = indexedDB.open('boxadmin-config', 1);
 *     apertura.onsuccess = () => { …put… };
 *
 * El manejador se asigna DESPUES de que `open()` devuelva. Si `open()` llamara
 * a `onsuccess` antes de volver, no habria ningun manejador puesto todavia: el
 * tapon no veria la escritura y pasaria en verde —ciego— con la fuga delante.
 *
 * Y se aplaza con `Promise.resolve().then(…)` y no con `queueMicrotask` por la
 * leccion de `EL_CRONOMETRO`: `queueMicrotask` esta en el conjunto de relojes
 * que sinon falsea, asi que un spec con `vi.useFakeTimers()` lo dejaria
 * encolado hasta que alguien avanzara el reloj —o sea, nunca— y el canal se
 * quedaria ciego justo en los specs que usan relojes falsos. Las promesas
 * nativas no las falsea nadie. MEDIDO: una microtarea nativa encolada dentro de
 * un test ya corrio cuando corre el `afterEach`.
 *
 * Cada manejador va en su propio `try`: si el de `upgradeneeded` explota —cosa
 * de quien lo escribio, no nuestra—, el de `success` tiene que correr igual o
 * se perderia el `put` que viene detras.
 */
function masTardeEnLaBase(hacer: () => void): void {
  void Promise.resolve().then(() => {
    try {
      hacer();
    } catch {
      // Un manejador que explota es un fallo del codigo bajo prueba, no de este
      // tapon: en el navegador va a `window.onerror` y no rompe a quien disparo
      // el evento. Aqui se traga por lo mismo, y porque lo que este tapon tiene
      // que registrar —la escritura— ya quedo anotado antes de llamar a nadie.
    }
  });
}

/** Una `IDBRequest` de mentira, con su resultado ya puesto y su `success` aplazado. */
function peticionDeLaBase(resultado: unknown): Record<string, unknown> {
  const peticion = conOyentes({
    result: resultado,
    error: null,
    readyState: 'done',
    onsuccess: null,
    onerror: null,
    source: null,
    transaction: null,
  });

  masTardeEnLaBase(() => dispararEnLaBase(peticion, 'success'));

  return peticion;
}

/**
 * Una clave de IndexedDB en texto, para poder buscar centinelas dentro.
 *
 * Las claves no son solo cadenas: la plataforma admite numeros, fechas y
 * ARRAYS (`put(valor, [tenantId, email])`), y por cualquiera de esas formas se
 * va un dato igual de bien. Se pasan por `comoTexto`, como el `detail` de
 * `performance.mark` y como el cuerpo de un `postMessage`.
 */
function textoDeUnaClave(clave: unknown): string {
  if (clave === undefined || clave === null) return '';
  if (typeof clave === 'string') return clave;

  return comoTexto([clave]);
}

/**
 * UNA BASE DE DATOS DE MENTIRA QUE SI GUARDA LO QUE LE PONEN.
 *
 * Guarda de verdad —en memoria, y solo mientras dure el test— por una razon
 * concreta: SIN REGISTROS NO HAY CURSOR. `openCursor()` sobre un almacen vacio
 * entrega `null` y un `cursor.update(dato)` no llega a ejecutarse nunca; el
 * tapon pasaria en verde mientras en el navegador —donde el almacen tiene los
 * registros de la sesion anterior— la misma linea reescribe cada fila con el
 * dato dentro. Guardando lo que se pone, un `put` seguido de un recorrido cae
 * por las dos puertas.
 *
 * LO QUE ESTO NO ARREGLA, dicho sin adornar: un cursor sobre un almacen al que
 * ESTE test no escribio sigue sin entregar nada, porque la base nace vacia en
 * cada `beforeEach`. Tapar eso pedia inventar registros falsos, y entonces el
 * canal dejaria de medir lo que la pantalla hace para medir lo que hace con lo
 * que nos inventamos. El caso queda cubierto por el otro lado: con la forma
 * fuerte, ABRIR la base ya es el fallo, y para llegar a un cursor hay que
 * abrirla.
 *
 * Y LOS ALMACENES SE CREAN SOLOS al pedirlos. Un `transaction('borradores')`
 * sobre un almacen que no existe lanza `NotFoundError` en la plataforma de
 * verdad; aqui no, a proposito: ese error ocurriria DENTRO de un manejador de
 * eventos, donde nadie lo ve, y el resultado seria una escritura invisible en
 * vez de un fallo. Un tapon no puede permitirse ser mas estricto que la
 * plataforma en un sitio donde serlo lo deja ciego.
 */
function baseDeDatosDeMentira(
  base: string,
  version: number,
  anotar: (escritura: EscrituraEnLaBase) => void,
): Record<string, unknown> {
  const almacenes = new Map<string, RegistroDeLaBase[]>();

  const registrosDe = (nombre: string): RegistroDeLaBase[] => {
    let registros = almacenes.get(nombre);

    if (registros === undefined) {
      registros = [];
      almacenes.set(nombre, registros);
    }

    return registros;
  };

  const almacenDeMentira = (nombre: string): Record<string, unknown> => {
    const registros = registrosDe(nombre);

    /** Las dos puertas de escritura directa: `put` y `add`, que son la misma. */
    const guardar = (puerta: string) => (valor: unknown, clave?: unknown) => {
      // Se ANOTA ANTES de nada: si algo de aqui abajo explotara, la escritura
      // ya esta registrada. Es la regla del resto del tapon.
      anotar({ puerta, base, almacen: nombre, clave: textoDeUnaClave(clave), valor });
      registros.push({ clave, valor });

      return peticionDeLaBase(clave ?? registros.length);
    };

    /**
     * EL CURSOR, que es la TERCERA puerta de escritura y no se parece a las otras.
     *
     * `cursor.update(valor)` reescribe el registro sobre el que esta parado sin
     * pasar por `put` ni por `add`: doblar solo esas dos dejaria la puerta
     * abierta cambiando dos palabras, igual que vigilar `mark` sin `measure`.
     * `continue()` vuelve a disparar el `success` de la MISMA peticion con el
     * registro siguiente, que es como recorre la plataforma de verdad.
     */
    const abrirCursor = (): Record<string, unknown> => {
      const peticion = conOyentes({
        result: null,
        error: null,
        readyState: 'done',
        onsuccess: null,
        onerror: null,
      });

      const copia = [...registros];
      let indice = 0;

      const entregar = (): void => {
        const registro = copia[indice];

        peticion.result =
          registro === undefined
            ? null
            : {
                key: registro.clave,
                primaryKey: registro.clave,
                value: registro.valor,
                direction: 'next',
                update: (valor: unknown) => {
                  anotar({
                    puerta: 'cursor.update',
                    base,
                    almacen: nombre,
                    clave: textoDeUnaClave(registro.clave),
                    valor,
                  });
                  registro.valor = valor;

                  return peticionDeLaBase(registro.clave);
                },
                delete: () => peticionDeLaBase(undefined),
                continue: () => {
                  indice += 1;
                  entregar();
                },
                advance: (cuantos: unknown) => {
                  indice += Math.max(1, Number(cuantos) || 1);
                  entregar();
                },
              };

        masTardeEnLaBase(() => dispararEnLaBase(peticion, 'success'));
      };

      entregar();

      return peticion;
    };

    return {
      name: nombre,
      keyPath: null,
      autoIncrement: false,
      indexNames: [],
      put: guardar('put'),
      add: guardar('add'),
      delete: () => peticionDeLaBase(undefined),
      clear: () => peticionDeLaBase(undefined),
      get: (clave: unknown) =>
        peticionDeLaBase(registros.find((uno) => uno.clave === clave)?.valor),
      getAll: () => peticionDeLaBase(registros.map((uno) => uno.valor)),
      getAllKeys: () => peticionDeLaBase(registros.map((uno) => uno.clave)),
      count: () => peticionDeLaBase(registros.length),
      openCursor: abrirCursor,
      openKeyCursor: abrirCursor,
      createIndex: () => almacenDeMentira(nombre),
      deleteIndex: () => {},
      // Un indice es otra forma de llegar al MISMO registro, cursor incluido:
      // `store.index('por-email').openCursor()` entrega cursores con `update`.
      index: () => almacenDeMentira(nombre),
    };
  };

  const laBase: Record<string, unknown> = conOyentes({
    name: base,
    version,
    objectStoreNames: [] as string[],
    createObjectStore: (nombre: unknown) => {
      registrosDe(String(nombre));
      laBase.objectStoreNames = [...almacenes.keys()];

      return almacenDeMentira(String(nombre));
    },
    deleteObjectStore: (nombre: unknown) => {
      almacenes.delete(String(nombre));
      laBase.objectStoreNames = [...almacenes.keys()];
    },
    transaction: (nombres: unknown, modo?: unknown) => {
      const transaccion = conOyentes({
        db: laBase,
        mode: typeof modo === 'string' ? modo : 'readonly',
        objectStoreNames: Array.isArray(nombres) ? nombres.map(String) : [String(nombres)],
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: (nombre: unknown) => almacenDeMentira(String(nombre)),
        abort: () => {},
        commit: () => {},
      });

      masTardeEnLaBase(() => dispararEnLaBase(transaccion, 'complete'));

      return transaccion;
    },
    close: () => {},
    onversionchange: null,
  });

  return laBase;
}

/**
 * Como nombrar una escritura en un informe SIN publicar lo que lleva.
 *
 * La puerta, la base, el almacen y la clave; NUNCA el valor —que es justamente
 * el objeto que esta fuga se lleva entero—. Y los tres nombres pasan por
 * `claveSegura`, porque una base bautizada con el dato
 * (`indexedDB.open(claveTemporal)`) lo publica igual de bien que un valor.
 */
function descripcionDeUnaEscritura(escritura: EscrituraEnLaBase): string {
  const clave = escritura.clave === '' ? 'sin clave' : claveSegura(escritura.clave);

  return `${escritura.puerta} en ${claveSegura(escritura.base)}/${claveSegura(escritura.almacen)} (${clave})`;
}

/** Todo lo que paso por la base, serializado, para buscar centinelas dentro. */
function comoTextoLasEscrituras(escrituras: EscrituraEnLaBase[]): string {
  return escrituras
    .map((una) => `${una.base} ${una.almacen} ${una.puerta} ${una.clave} ${comoTexto([una.valor])}`)
    .join(' ');
}

/**
 * Como nombrar una clave guardada SIN publicar un secreto que venga de clave.
 *
 * `localStorage.setItem(claveTemporal, '1')` mete el dato en el NOMBRE, no en
 * el valor. El informe dice entonces como se llama el dato vigilado y no la
 * cadena, igual que hace el resto del tapon.
 */
function claveSegura(clave: string): string {
  for (const [nombre, valor] of todoLoVigilado()) {
    if (valor !== '' && clave.includes(valor)) return `«${nombre}»`;
  }

  return clave;
}

// ---------------------------------------------------------------------------
// El duodecimo canal: los atributos del `<html>` y del `<body>`
// ---------------------------------------------------------------------------

/**
 * LOS DOS ELEMENTOS QUE ENVUELVEN AL CUERPO, Y QUE NO MIRA NADIE.
 *
 * Los once tapones de arriba miran la consola, el titulo, `window.name`, el
 * CONTENIDO del `<head>`, los cinco almacenes, el buffer de User Timing, el
 * `src` de una imagen, las tres salidas laterales, el service worker e
 * IndexedDB. Los tests de pantalla miran lo que hay DENTRO del `<body>`:
 * nodos, texto y roles. Entre las dos cosas quedan DOS ELEMENTOS ENTEROS sin
 * mirar: los ATRIBUTOS del `<html>` y los del `<body>`. Medido antes de
 * escribir esto: cero coincidencias de `documentElement` en todo
 * `apps/web/src`, y ni un `setAttribute`, `classList` ni `dataset` sobre
 * ninguno de los dos.
 *
 * Es el sitio natural de una «marca de diagnostico» —la linea que cualquiera
 * escribe sin pensarla— porque es COMO SE PONEN LOS TEMAS, LOS IDIOMAS Y LAS
 * BANDERAS DE FUNCIONALIDAD: un `data-*` con un id, un rol o un nombre pasa
 * cualquier revision porque parece instrumentacion.
 *
 * MEDIDO: un `document.documentElement.dataset.ultimoHealthCheck = jobId` en
 * un `useEffect` de la pantalla de Configuracion paso los 1494 tests del
 * paquete con los ONCE tapones enchufados.
 *
 * ESTE EJE ES DISTINTO DE LOS CINCO ANTERIORES —`sendBeacon`, `caches`, el
 * service worker, IndexedDB y el rato libre—, y la diferencia es la que lo
 * hace peor. Aquellos pasaban por APIs que jsdom NO implementa, asi que la
 * fuga vivia detras de un `?.` que la delataba en cuanto alguien lo miraba.
 * JSDOM IMPLEMENTA ESTO ENTERO: no hay ningun `?.`, la linea es identica en el
 * test y en el navegador, y corre de verdad en los dos. El sitio no estaba
 * ciego por el entorno — estaba ciego porque nadie lo nombro nunca.
 *
 * Y tiene tres propiedades que lo hacen peor que un `console.log`:
 *
 *  1. NO ESTA EN EL ARBOL QUE `render` MONTA, asi que `cleanup()` NO lo borra:
 *     lo que una pantalla escriba ahi sobrevive a su propio test y contamina
 *     los siguientes del mismo archivo. Esta medido: con la mutacion puesta,
 *     un test fallo por el atributo que habia dejado el anterior. Por eso el
 *     tapon los QUITA antes de afirmar, igual que restaura los almacenes y
 *     vacia el buffer de marcas: si no, el informe acusa al inocente.
 *  2. En el navegador son EXACTAMENTE IGUAL DE PUBLICOS que el `<body>`:
 *     primera linea de «inspeccionar elemento», y salen enteros en «ver codigo
 *     fuente» y en cualquier volcado del DOM.
 *  3. Sobreviven a la navegacion de la SPA, porque no los desmonta nadie.
 *
 * SE AFIRMA POR IGUALDAD CONTRA EL CONJUNTO VACIO, no contra «lo que habia al
 * empezar», y es una decision con fuga conocida del otro lado: con una foto
 * inicial, un atributo que hubiera dejado un test ANTERIOR del archivo estaria
 * en las dos fotos y pasaria en verde —que es justamente la propiedad 1 usada
 * al reves—. La forma fuerte solo vale si los dos elementos nacen limpios, y
 * eso NO se leyo, se midio: en jsdom 26 `document.documentElement.attributes`
 * y `document.body.attributes` estan los dos VACIOS al empezar un spec y
 * siguen vacios tras un `render` con `QueryClientProvider`; y con el tapon
 * puesto con esta forma, los 66 specs del paquete siguen en verde, o sea que
 * NADIE —ni Next, ni React 19, ni Testing Library, ni ningun proveedor—
 * escribe ahi durante un test.
 *
 * CUBRE LOS DOS ELEMENTOS porque el hueco es el mismo en los dos, y se
 * informan POR SEPARADO para que el mensaje diga en cual de los dos fue.
 *
 * NO HACE FALTA ESPIA NINGUNO, y por eso este canal es el unico que no se
 * engancha en el `beforeEach`. Los otros once doblan una funcion o un accesor
 * y tienen que volver a hacerlo en cada test, porque los specs llaman a
 * `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de hooks
 * de Vitest corre ANTES que este tapon. Aqui no hay nada que doblar: el estado
 * que delata la fuga son los atributos que QUEDAN en el documento, y eso se
 * lee directamente al terminar. Sin espia no hay nada que restaurar y, por
 * tanto, nada que `vi.restoreAllMocks()` pueda apagar.
 */
type ElementoDeAlrededor = '<html>' | '<body>';

const ALREDEDOR_DEL_CUERPO: readonly ElementoDeAlrededor[] = ['<html>', '<body>'];

/** El elemento de verdad detras del nombre con el que lo llama el informe. */
function elementoDeAlrededor(cual: ElementoDeAlrededor): Element {
  return cual === '<html>' ? document.documentElement : document.body;
}

/** Los atributos de un elemento, nombre y valor, tal cual estan. */
function atributosDe(elemento: Element): [string, string][] {
  return [...elemento.attributes].map((atributo) => [atributo.name, atributo.value]);
}

/**
 * Los atributos serializados, para buscar centinelas dentro.
 *
 * Se mira el NOMBRE ademas del valor: un
 * `document.documentElement.setAttribute(claveTemporal, '1')` mete el dato en
 * el nombre, igual que un `localStorage.setItem(claveTemporal, '1')`.
 */
function textoDeLosAtributos(atributos: [string, string][]): string {
  return atributos.map(([nombre, valor]) => `${nombre}=${valor}`).join(' ');
}

// ---------------------------------------------------------------------------
// El decimotercer canal: la URL del documento
// ---------------------------------------------------------------------------

/**
 * LA BARRA DE DIRECCIONES: EL HUECO ENTRE LAS DOS DEFENSAS DE ESTE REPO.
 *
 * Los doce tapones de arriba miran la consola, el titulo, `window.name`, el
 * `<head>`, los cinco almacenes, el buffer de User Timing, el `src` de una
 * imagen, las tres salidas laterales, CacheStorage, el service worker,
 * IndexedDB y los atributos del `<html>` y del `<body>`. Los tests de pantalla
 * miran DENTRO del `<body>` y la lista de peticiones. `location` NO CAE EN
 * NINGUNO DE LOS DOS LADOS: ni es un canal de los doce ni es marcado.
 *
 * MEDIDO: un `window.history.replaceState(null, '', '#dijo=' + config.error.message)`
 * en la pantalla de Configuracion —tres lineas que parecen una cortesia para
 * poder compartir el enlace con el fallo— dejo la URL en
 * `http://localhost:3000/#dijo=La%20base%20de%20datos%20del%20gimnasio%20no%20contesta`
 * y paso los 1507 tests del paquete con los doce canales enchufados.
 *
 * Y como canal de fuga es de los peores que tiene un navegador, porque es el
 * unico que se COPIA SOLO:
 *
 *  - Va en la barra de direcciones de la maquina del mostrador, que usan
 *    cuatro personas por turno y que se ve desde dos metros.
 *  - Entra en el historial EN DISCO y en el archivo de restauracion de sesion,
 *    igual que `document.title`, y sobrevive al logout.
 *  - Se copia y se pega ENTERA: el enlace que alguien manda por chat para
 *    enseñar la pantalla se lleva el dato dentro.
 *  - Queda en el REGISTRO DE ACCESO de cualquier servidor al que se navegue
 *    despues, y VIAJA COMO `Referer` A TERCEROS —a la CDN del logo, al tipo de
 *    letra, a la etiqueta de analitica que se enchufe mañana— sin que nadie lo
 *    decida.
 *
 * Nada de eso deja rastro en la pestaña de red ni en el marcado.
 *
 * Y, como los atributos del `<html>`, SOBREVIVE A SU PROPIO TEST: `cleanup()`
 * desmonta el `<body>` y no toca `location`. Esta medido en este mismo repo
 * antes de que esto existiera: la query que sembraba un test aparecia intacta
 * en el siguiente.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA ES LA FUERTE —«LA URL NO CAMBIO»— Y ESO SE MIDIO, NO SE SUPUSO.
 *
 * La duda era real y cara: MEDIA DOCENA DE PANTALLAS ESCRIBEN EN LA URL A
 * PROPOSITO —los filtros de turnos, horarios, ausencias y analisis ponen su
 * estado ahi, razonado por escrito («sobrevive al boton de atras», «la pantalla
 * y la barra de direcciones no pueden decir cosas distintas»)—. Si eso llegara
 * a `location` en un test, la forma fuerte seria ROJA con el codigo correcto en
 * seis specs.
 *
 * No llega, y el motivo es estructural: LO HACEN POR EL ROUTER DE NEXT, Y EL
 * ROUTER ESTA DOBLADO EN LOS 26 SPECS QUE LO USAN. Medido uno por uno: los 26
 * montan `vi.mock('next/navigation', …)` con un `useRouter` que devuelve
 * `push`/`replace` como `vi.fn()`, y `useSearchParams` devuelve un
 * `URLSearchParams` que el spec fabrica a mano. NINGUNO toca `location`, y no
 * hay un solo spec que importe `next/navigation` sin doblarlo. O sea que lo
 * unico que puede mover `location` dentro de un test es alguien SALTANDOSE el
 * router — que es exactamente la fuga. La forma fuerte sale gratis.
 *
 * (Y la medida que decide no es esa lectura sino la del paquete entero: con
 * este tapon puesto con la forma fuerte, los 67 specs siguen en verde.)
 *
 * SE COMPARAN LAS PARTES POR SEPARADO —origen, ruta, query, hash y el ESTADO
 * del historial— y no solo el `href` entero, por dos cosas. La primera es el
 * informe: decir «cambio el hash» ubica la fuga sin publicar ni un caracter de
 * lo que lleva dentro, y un `href` entero en el mensaje seria publicar el dato
 * en el registro de CI, que es el modo de fallo que todo este archivo evita. La
 * segunda es el ESTADO, que no es parte del `href` y que sin nombrarlo
 * desaparece: ver abajo.
 *
 * Y SE COMPARA CONTRA LA FOTO DE AL CARGAR —la URL con la que el entorno
 * arranca, cogida UNA VEZ en el cuerpo del modulo— y no contra una foto del
 * `beforeEach`. Es la misma decision que el duodecimo canal y por el mismo
 * motivo: con una foto por test, una query que hubiera dejado un test ANTERIOR
 * del archivo estaria en las dos fotos y pasaria en verde, que es la propiedad
 * de arriba —`cleanup()` no toca `location`— usada al reves. La restauracion
 * del `afterEach` hace verdadera la premisa en cada test.
 *
 * ---------------------------------------------------------------------------
 * HAY VARIAS PUERTAS, Y SE MIDIO COMO ESTA MONTADA CADA UNA. NO ES UNIFORME.
 *
 * 1. `history.pushState` y `history.replaceState` VIVEN EN `History.prototype`
 *    y son escribibles y configurables —medido; `window.history` no tiene NI
 *    UNA propiedad propia—, asi que se doblan con `vi.spyOn` como `mark` y
 *    `measure`. Las dos cambian `location` de verdad en jsdom, hash Y query:
 *    `pushState(null, '', '?q=x')` deja `location.search` en `?q=x`.
 *
 * 2. ESCRIBIR `location.hash` FUNCIONA Y NO SE PUEDE DOBLAR. Medido: `href`,
 *    `hash`, `search` y `pathname` son accesores PROPIOS del objeto `location`
 *    con `configurable: false`, y `Location.prototype` no tiene ninguno de los
 *    cuatro. Un `Object.defineProperty(location, 'hash', …)` revienta con
 *    «Cannot redefine property». No hace falta: `location.hash = '#x'` SI
 *    cambia la URL en jsdom, y la otra mitad del canal —la comparacion— lo ve.
 *
 * 3. `location.assign` Y `location.replace` NO SE PUEDEN DOBLAR DE NINGUNA
 *    MANERA, y esto se midio hasta el final en lugar de darlo por hecho: son
 *    propiedades de DATOS propias de `location`, `writable: false` y
 *    `configurable: false`. `window.location` si es redefinible, asi que se
 *    probo el ultimo recurso —sustituirlo por un `Proxy` que delegue en el de
 *    verdad— y TAMBIEN FALLA, por invariante del lenguaje: un `Proxy` no puede
 *    devolver en `get` algo distinto del valor real de una propiedad de datos
 *    no configurable y no escribible, y lanza un `TypeError` al intentarlo.
 *    Quedan cubiertas por la comparacion: `assign('#x')` y `replace('#x')`
 *    cambian la URL en jsdom y caen.
 *
 * LO QUE ESTE TAPON NO VE, dicho sin adornar para que nadie lo descubra
 * creyendo que estaba tapado: LAS NAVEGACIONES QUE NO SON AL MISMO DOCUMENTO.
 * Medido: `location.href = 'http://…/otra'`, `location.search = '?q=x'` y un
 * `assign`/`replace` a una ruta distinta son NO-OPS en jsdom —implementa solo
 * el cambio de hash y la History API— asi que no cambian nada que comparar, y
 * por el punto 3 no hay donde engancharse. Es el agujero de forma
 * `sendBeacon`: silencioso en el test y real en el navegador. Se queda abierto
 * a proposito y no por pereza —no hay forma de cerrarlo sin fabricar un
 * `Location` entero de mentira, y entonces el canal mediria nuestro doble en
 * vez de la pantalla—, y es el menos grave de los cuatro: una navegacion a
 * otro documento SE LLEVA LA PAGINA, o sea que no es la fuga callada que este
 * canal persigue sino un fallo que se ve a simple vista. La fuga callada —la
 * que mantiene a la persona donde estaba y le mete el dato en la barra— es
 * siempre al MISMO documento, y esa cae entera.
 *
 * ---------------------------------------------------------------------------
 * DOS MITADES, Y HACEN FALTA LAS DOS. Es el patron de los almacenes y del
 * buffer de marcas, y aqui cada una caza algo que la otra no puede:
 *
 *  - LA COMPARACION sola no basta porque `pushState(estado, '', LA MISMA URL)`
 *    GUARDA EL OBJETO EN `history.state` SIN TOCAR NI UN CARACTER DE LA URL.
 *    Medido: tras esa llamada `location.href` es identico y
 *    `history.state` devuelve `{"secreto":"…"}` entero. Y ese estado se
 *    serializa al archivo de restauracion de sesion EN DISCO, que es
 *    `localStorage` por otro nombre. Por eso el estado es una de las partes
 *    que se comparan. Tampoco veria un `replaceState` con el dato seguido de
 *    otro que lo limpia tres lineas despues —el mismo caso que un `setItem`
 *    seguido de un `removeItem`—.
 *  - EL ESPIA solo no basta porque `location.hash = …`, `assign` y `replace`
 *    no pasan por el, y porque no ve lo que ya estuviera en la URL antes del
 *    `beforeEach`.
 *
 * SE VIGILAN LAS CINCO PUERTAS DEL HISTORIAL y no solo las dos que escriben.
 * `go`, `back` y `forward` no llevan un dato a ninguna parte, pero mueven la
 * barra de direcciones por detras del router igual que `replaceState`, y este
 * repo YA TENIA ESA REGLA ESCRITA: `turnos/page.spec.tsx` la custodiaba en un
 * spec desde la Fase 9 («la URL la escribe el router, no la History API a
 * mano»). Cubrir solo `pushState` y `replaceState` reabriria ese agujero
 * cambiando una palabra, que es lo mismo que pasaba con `mark` sin `measure`.
 * Al estar aqui, esa regla vale para los 67 specs en vez de para uno.
 *
 * SE AFIRMA TAMBIEN POR CENTINELAS, Y ANTES QUE LA FORMA FUERTE, como
 * IndexedDB y como los atributos del `<html>`: un «la URL del documento lleva
 * claveDelReset» dice QUE se fue, y la forma fuerte sola obligaria a ir a
 * buscarlo. Y LA URL SE MIRA ADEMAS DECODIFICADA, que no es un adorno: la URL
 * codifica los espacios, asi que el centinela
 * `La base de datos del gimnasio no contesta` NO aparece literal en
 * `#dijo=La%20base%20de%20datos%20del%20gimnasio%20no%20contesta` y la mitad de
 * las fugas con un mensaje dentro pasarian en verde. Medido.
 */
type PuertaDelHistorial = 'pushState' | 'replaceState' | 'go' | 'back' | 'forward';

const PUERTAS_DEL_HISTORIAL: readonly PuertaDelHistorial[] = [
  'pushState',
  'replaceState',
  'go',
  'back',
  'forward',
];

/**
 * LAS CINCO FUNCIONES DE VERDAD, cogidas UNA VEZ al cargar.
 *
 * Por la leccion de las galletas y del `src` de una imagen: leerlas desde
 * dentro del `beforeEach`, despues del primer enganche, envolveria el
 * envoltorio de ayer y contaria cada llamada tantas veces como tests lleve el
 * archivo. Y hacen falta ademas para dos cosas que el espia no puede hacer por
 * si mismo: REENVIAR —el tapon registra y deja pasar, como el resto— y
 * RESTAURAR la URL al terminar sin que esa restauracion se cuente como una
 * llamada de la pantalla.
 */
const HISTORIAL_ORIGINAL = new Map<PuertaDelHistorial, (...partes: unknown[]) => unknown>(
  PUERTAS_DEL_HISTORIAL.filter((puerta) => typeof History.prototype[puerta] === 'function').map(
    (puerta) => [puerta, History.prototype[puerta] as (...partes: unknown[]) => unknown],
  ),
);

/** Las partes de la URL que se comparan por separado, el estado incluido. */
type ParteDeLaUrl = 'origen' | 'ruta' | 'query' | 'hash' | 'estado';

const PARTES_DE_LA_URL: readonly ParteDeLaUrl[] = ['origen', 'ruta', 'query', 'hash', 'estado'];

/**
 * La URL del documento partida en pedazos, mas el estado del historial.
 *
 * El `estado` va aqui y no aparte porque es la parte de este canal que NO se
 * ve en la barra de direcciones y que sin nombrar se perderia: un
 * `pushState(datos, '', la misma URL)` no cambia ni un caracter del `href`.
 */
function fotoDeLaUrl(): Record<ParteDeLaUrl, string> {
  const url = new URL(window.location.href);

  return {
    origen: url.origin,
    ruta: url.pathname,
    query: url.search,
    hash: url.hash,
    // `?? null` porque jsdom deja el estado en `undefined` tras una navegacion
    // de hash y en `null` al cargar —medido—, y las dos cosas significan «no
    // hay estado»: sin igualarlas, un `location.hash = …` acusaria ademas a
    // una parte que nadie escribio.
    estado: comoTexto([window.history.state ?? null]),
  };
}

/** La URL con la que arranca el entorno: contra esta se compara y a esta se vuelve. */
const URL_AL_CARGAR = window.location.href;
const FOTO_AL_CARGAR = fotoDeLaUrl();
const ESTADO_AL_CARGAR = window.history.state as unknown;

/**
 * La URL en texto Y DECODIFICADA, para buscar centinelas dentro.
 *
 * Las dos formas, porque la plataforma codifica al escribir: un centinela con
 * espacios se guarda como `%20` y no aparece literal en el `href`. Si la
 * cadena no es decodificable —un `%` suelto— se mira igual por su forma cruda,
 * como hace `comoTexto` con lo que no se puede serializar.
 */
function urlComoTexto(href: string): string {
  try {
    return `${href} ${decodeURIComponent(href)}`;
  } catch {
    return href;
  }
}

/** Una llamada a la History API, vista por el espia: la puerta y lo que le pasaron. */
interface LlamadaAlHistorial {
  puerta: PuertaDelHistorial;
  argumentos: string;
}

/**
 * EL TAPON DE LOS TRECE CANALES, en todos los specs.
 *
 * **La consola.** Antes de que esto existiera, ni un solo spec de `apps/web`
 * mencionaba `console`, y un `console.info('[alta]', respuesta)` —la traza de
 * depuracion mas banal que existe— pasaba las cincuenta pruebas de la pantalla
 * del alta con la unica contraseña del sistema que se ve una vez dentro. El
 * daño es concreto: la maquina del mostrador la usan cuatro personas por turno,
 * la consola guarda lo dicho mientras la pestaña viva, y cualquier SDK de
 * errores que se enchufe mañana se lleva eso como breadcrumb a un servidor de
 * terceros sin que nadie lo decida. El espia REGISTRA Y DEJA PASAR: tragarse la
 * salida dejaria mudo al propio test el dia que React avise de algo por la
 * consola, que es justo cuando hace falta leerlo.
 *
 * **El titulo.** `document.title` va a la base de historial EN DISCO, al archivo
 * de restauracion de sesion, al conmutador de pestañas —visible para quien pase
 * por detras del mostrador—, a cualquier captura o pantalla compartida, y es lo
 * que toda SDK de analitica manda por defecto como nombre de pagina. Un
 * gimnasio que enchufe analitica mañana publica sus codigos de invitacion a un
 * tercero sin que nadie lo decida.
 *
 * **El nombre de la pestaña.** `window.name` es el UNICO almacen del navegador
 * que no esta atado al origen: no es como `localStorage`, `sessionStorage` ni
 * las galletas. Lo que una pantalla escriba ahi sigue ahi cuando la persona del
 * mostrador escribe otra direccion en la MISMA pestaña, y lo lee entero el
 * sitio al que vaya. Cualquier sitio. Un `window.name = 'anotados:' + nombres`
 * en la ficha de un turno —"para reconocer la pestaña cuando hay varias
 * abiertas"— paso los 971 tests del paquete: el DOM, las dos caches, los dos
 * almacenes, la consola, el titulo y las listas blancas de peticiones no lo
 * ven, y el spec de esa misma ficha monta ese bloque y tampoco. De ese canal se
 * afirma que esta VACIO y no que no contiene tal dato: su gracia es que se
 * lleva CUALQUIER cosa, y un centinela solo cubre la cadena que alguien se
 * acordo de escribir.
 *
 * **La cabecera del documento.** React 19 sube SOLO al `<head>` los `<meta>`,
 * `<title>` y `<link>` que se rendericen en cualquier parte del arbol, desde un
 * componente cliente, sin tocar el `metadata` de Next ni el layout. Y TODO este
 * repo afirma sobre el `<body>`: `screen.*`, `document.body.innerHTML`, los
 * `querySelectorAll` y el arbol de accesibilidad. Un
 * `<meta name="description" content={...}>` en el bloque de vacaciones de una
 * ficha —con nombre, correo, telefono y las fechas en que esa persona no esta
 * en su casa— paso los 1272 tests del paquete: medido con una sonda, el nodo
 * estaba en el `<head>` y `document.body.querySelector('meta')` daba `null`.
 * Duele porque `<meta name="description">` es EL campo que las SDK de analitica
 * mandan por defecto como descripcion de pagina, el que leen los
 * previsualizadores de enlaces y los rastreadores, y sale entero con «ver
 * codigo fuente» y en cualquier volcado del DOM. Y la linea pasa una revision
 * sin hacer ruido: parece SEO. Se afirman LAS DOS MITADES —que no crecio y que
 * no lleva centinelas— porque no son la misma: ver abajo.
 *
 * **Los tres almacenes.** `localStorage`, `sessionStorage` y las galletas. El
 * agujero no era del repo sino de los specs: siete pantallas tenian el test,
 * cada una con SU COPIA A MANO de `contenidoDe` y `galletasDelDocumento`, y a
 * las demas simplemente les faltaba sin que nada avisara. Un
 * `localStorage.setItem` tras un alta con el nombre de una profesora y su
 * tarifa —tres lineas que parecen una cortesia, «para rellenar el siguiente
 * horario»— sobrevivio a los 48 tests de la pantalla de la nomina: deja nombre
 * y tarifa en el disco de la maquina del mostrador, y sobrevive al logout y al
 * cambio de persona. Se afirma sobre las CLAVES y no sobre los valores: el
 * `toEqual` con los contenidos que tenian algunas copias a mano imprimiria en
 * el informe de CI justamente el dato que se escapo.
 *
 * **El buffer de User Timing.** `performance.mark` y `performance.measure`. Un
 * `performance.mark(`stats:caja:2026-3:fin:margen=${datos.margen.texto}`)` en
 * el hook de los reportes —y su gemelo con el `perfilId` del alumno en el de
 * asistencia— sobrevivio a los 1296 tests del paquete: medido con una sonda,
 * `performance.getEntriesByType('mark')` devolvia las marcas enteras, con el
 * margen del salon y el id dentro. Duele porque ese buffer lo lee cualquier
 * script de la pagina con UNA linea, sobrevive a toda la navegacion de la SPA,
 * sale entero en cualquier traza de rendimiento que se mande a soporte, y las
 * SDK de RUM —Datadog, NewRelic, Sentry performance— se llevan los user
 * timings POR DEFECTO, sin que nadie lo decida, exactamente como pasa con
 * `document.title`. Y pasa una revision sin ruido: parece medir latencia.
 *
 * **El `src` de una imagen.** `new Image().src = '…'` es una peticion de red
 * que no pasa por `fetch`, no esta en el `<body>` —la imagen nunca se adjunta
 * al documento—, no esta en el `<head>` y no toca ninguno de los otros cinco
 * canales. Medido en la Fase 11: un pixel con el reporte operativo entero en
 * el query —`uso.gif?d=${JSON.stringify(datos)}`, tres lineas en un
 * `useEffect` que parecen una metrica de uso— paso los 1326 tests del paquete,
 * incluido el de «no habla con la red por fuera de `pedir`», que dobla el
 * `fetch` global y por tanto no lo ve. El daño es el de siempre y uno mas: la
 * URL sale al servidor del otro lado con la cookie de sesion si comparte
 * dominio, y queda escrita en SU registro de acceso, que no es nuestro.
 * Se vigilan las dos mitades —lo que se ASIGNA al accesor y lo que QUEDA en el
 * documento— por lo mismo que los almacenes: el accesor no ve un
 * `setAttribute('src', …)` y la barrida no ve una imagen suelta que nunca se
 * adjunto. Y se afirma por centinelas, no por estar vacio: pedir imagenes es
 * legitimo y este repo ya lo hace.
 *
 * **Las salidas laterales.** `window.postMessage`, `BroadcastChannel` y
 * `navigator.sendBeacon`: tres puertas que no son `fetch` ni el DOM. Medido en
 * esta fase: un `window.postMessage({ tipo: 'analisis:caja-lista', caja }, '*')`
 * en un `useEffect` de la pantalla de la caja —«avisarle al armazon que los
 * numeros ya estan», con el reporte entero adentro porque elegir campos era
 * mas trabajo— paso los 1352 tests del paquete. No lo ve el test de «no habla
 * con la red por fuera de `pedir`», que dobla el `fetch` global y esto no es un
 * `fetch`; no lo ven los siete canales de arriba; y no lo ve ningun test de
 * pantalla, que mira el `<body>`. El daño es distinto en cada puerta y por eso
 * el informe las separa: el mensaje se lo lleva cualquier script que comparta
 * la pagina —y el documento que nos enmarque, si la escritura es
 * `parent.postMessage(…, '*')`—, la difusion se la lleva cualquier OTRA
 * PESTAÑA del mismo origen —en la maquina del mostrador, la que dejo abierta
 * el turno anterior— y la baliza es una peticion de red que SOBREVIVE AL
 * CIERRE DE LA PESTAÑA, no se puede cancelar y no devuelve nada que mirar.
 * Se afirma por centinelas y no por «ninguna llamada», como el canal de
 * imagenes: comunicarse es legitimo. Y se mira el objeto ENTERO serializado,
 * como el `detail` de `performance.mark`, porque la mutacion que abrio el
 * canal llevaba el dato anidado en la segunda clave.
 *
 * **IndexedDB.** El QUINTO almacen, y el que quedo fuera porque el tapon de
 * «los tres almacenes» es una lista cerrada y `CacheStorage` se agrego como
 * cuarto. Medido en esta fase: un borrador del formulario de SMTP
 * —`indexedDB.open('boxadmin-config', 1)` y un `put(variables, 'smtp')` en
 * `onsuccess`, tres lineas que parecen una cortesia «por si alguien recarga a
 * medio configurar»— guardaba host, usuario y LA CLAVE DEL SERVIDOR DE CORREO
 * EN CLARO, y paso los 1481 tests del paquete con los diez canales enchufados.
 * Pasa porque `typeof indexedDB` es `'undefined'` en jsdom y el `?.` que
 * escribe quien programa con cuidado convierte la ausencia del entorno en un
 * silencio. Y es peor que los tres almacenes que si se vigilaban: sobrevive al
 * logout, al cierre de la pestaña y al reinicio igual que `localStorage`, pero
 * ademas NO TIENE TOPE DE 5 MB y GUARDA OBJETOS ESTRUCTURADOS —`put(variables)`
 * mete el objeto entero sin que nadie tenga que acordarse de serializar—. Se
 * vigilan LAS TRES PUERTAS de escritura —`put`, `add` y `cursor.update`, que no
 * pasa por ninguna de las otras dos—, la CLAVE ademas del valor —un
 * `put(1, claveSecreta)` esconde el dato en el nombre— y el NOMBRE DE LA BASE.
 * Se afirma por LA FORMA FUERTE —«no se abrio ninguna base»— y no por
 * centinelas, que es la unica vez que se elige eso desde `window.name`: el
 * motivo medido, y por que `serwist` —que si usa IndexedDB— no lo invalida,
 * estan en el docblock de `INDEXED_DB_ORIGINAL`.
 *
 * **Los atributos del `<html>` y del `<body>`.** Los dos elementos que
 * envuelven al cuerpo, y que no mira NADIE: los once canales de arriba miran
 * la consola, el titulo, el nombre de la pestaña, el CONTENIDO del `<head>`,
 * los cinco almacenes, User Timing, el `src` de una imagen, las tres salidas
 * laterales, el service worker e IndexedDB, y los tests de pantalla miran lo
 * que hay DENTRO del `<body>`. Entre las dos cosas quedaban dos elementos
 * enteros. Medido en esta fase: un
 * `document.documentElement.dataset.ultimoHealthCheck = jobId` en un
 * `useEffect` —una «marca de diagnostico», que es como se ponen los temas, los
 * idiomas y las banderas de funcionalidad— paso los 1494 tests del paquete con
 * los once canales enchufados. Y ES DISTINTO DE LOS CINCO ANTERIORES: aquellos
 * pasaban por APIs que jsdom no implementa, asi que la fuga vivia detras de un
 * `?.` que la delataba; jsdom implementa ESTO entero, la linea es identica en
 * el test y en el navegador y corre de verdad en los dos. El sitio no estaba
 * ciego por el entorno, estaba ciego porque nadie lo nombro. Se afirma por LA
 * FORMA FUERTE —ni un atributo, contra el conjunto VACIO y no contra una foto
 * inicial, porque con la foto un atributo dejado por un test ANTERIOR pasaria
 * en verde— y el motivo por el que esa forma es legitima esta medido, no
 * leido: el docblock de `ALREDEDOR_DEL_CUERPO`.
 *
 * **La URL del documento.** EL HUECO ENTRE LAS DOS DEFENSAS: los doce canales
 * de arriba miran todo lo que no es el `<body>`, los tests de pantalla miran
 * el `<body>` y la lista de peticiones, y `location` no cae en ninguno de los
 * dos lados. Medido en esta fase: un
 * `history.replaceState(null, '', '#dijo=' + config.error.message)` en la
 * pantalla de Configuracion dejo el mensaje de la API entero en la barra de
 * direcciones y paso los 1507 tests del paquete con los doce canales
 * enchufados. Es el unico canal que SE COPIA SOLO: entra en el historial en
 * disco, se pega entero cuando alguien comparte el enlace, queda en el
 * registro de acceso del siguiente servidor y VIAJA COMO `Referer` A TERCEROS,
 * sin dejar rastro en la pestaña de red ni en el marcado. Y `cleanup()` no lo
 * toca, asi que sobrevive a su propio test. Se vigilan LAS DOS MITADES —la URL
 * que QUEDA, partida en origen, ruta, query, hash y ESTADO del historial, y
 * las CINCO puertas de la History API, dobladas con `vi.spyOn` sobre
 * `History.prototype`— porque cada una caza algo que la otra no puede: un
 * `pushState(datos, '', la misma URL)` guarda el objeto en `history.state` sin
 * mover ni un caracter del `href`, y un `location.hash = …` no pasa por
 * ninguna funcion que se pueda doblar. Se afirma por LA FORMA FUERTE —«la URL
 * no cambio»— y eso no se supuso: las seis pantallas que escriben en la URL a
 * proposito lo hacen por el router de Next, y los 26 specs que lo usan lo
 * doblan con `vi.fn()` sin tocar `location`. La URL se mira ademas
 * DECODIFICADA, porque un centinela con espacios se guarda como `%20` y no
 * aparece literal. Lo que este canal NO ve —las navegaciones que no son al
 * mismo documento, que jsdom no implementa y cuyas puertas no son doblables ni
 * con un `Proxy`— esta medido y escrito entero en el docblock de
 * `PUERTAS_DEL_HISTORIAL`.
 *
 * EL CUARTO VECINO DE ESA FAMILIA —`navigator.clipboard`— NO SE VIGILA, a
 * proposito y con el motivo medido escrito al lado de los otros tres: el panel
 * copia secretos registrados a proposito en DOS pantallas, y los tres specs
 * que ejercitan el portapapeles le pisan el objeto entero a `navigator` desde
 * dentro del test, donde ningun `beforeEach` llega. Un espia alli estaria
 * ciego justo donde el canal se usa. El razonamiento entero, el criterio que
 * si los distinguiria y el agujero que queda: en el comentario de
 * `textoDeUnBlob`, justo encima de `claveSegura`.
 *
 * Se vigilan las DOS puertas y las DOS mitades de cada una. `measure` crea una
 * entrada con nombre propio igual que `mark`, asi que cubrir solo `mark`
 * dejaria el agujero abierto cambiando una palabra. Y el `detail` —el segundo
 * argumento de las dos— va DENTRO de la entrada y sale en su `toJSON()`:
 * medido en jsdom 26, un `mark(nombre, { detail: { clave } })` devuelve la
 * clave entera en el volcado. Por eso se miran nombre Y detalle.
 *
 * EL PUNTO CIEGO DE LOS RELOJES FALSOS, YA TAPADO, Y NO DESDE AQUI.
 * `vi.useFakeTimers()` sin `toFake` sustituia el objeto `performance` global
 * por el falso de sinon, que acepta `mark()` y no guarda nada: mientras un
 * test tuviera los relojes falsos enteros puestos, este canal no veia nada —ni
 * el espia, que quedo colgado del objeto de verdad, ni el buffer, al que la
 * marca nunca llegaba—. Medido: con una marca sembrada en el codigo de
 * produccion, los tres sitios que escribian la linea desnuda (`ausencias`, la
 * ficha de `usuarios/[id]` y `use-calendario-admin`) pasaban en verde.
 *
 * Ya no se arregla spec a spec: `vitest.config.ts` fija un `toFake` POR
 * DEFECTO que no incluye `performance`, asi que el proximo
 * `vi.useFakeTimers()` nace cubierto sin que nadie tenga que acordarse. De
 * donde sale esa lista y quien la vigila: `src/test/relojes-falsos.ts`.
 *
 * Lo de abajo —guardar `EL_CRONOMETRO` y vaciar el buffer por el— se queda
 * igual: un spec puede pasar SU PROPIO `toFake` con `performance` dentro, y
 * entonces el `performance` global vuelve a ser el falso.
 */
export function vigilarLosCanalesDeSalida(): void {
  const dicho: unknown[] = [];
  let tituloAlEmpezar = '';
  let cabeceraAlEmpezar = new Set<Element>();
  let almacenesAlEmpezar = estadoDeLosAlmacenes();
  const escrito: EscrituraEnAlmacen[] = [];
  const cronometrado: EntradaDeTiempo[] = [];
  const imagenesPedidas: string[] = [];
  const mensajesMandados: string[] = [];
  const mensajesDifundidos: string[] = [];
  const balizasMandadas: string[] = [];
  const respuestasGuardadas: RespuestaGuardada[] = [];
  const mensajesAlTrabajador: string[] = [];
  const basesAbiertas: string[] = [];
  const escritoEnLaBase: EscrituraEnLaBase[] = [];
  const navegado: LlamadaAlHistorial[] = [];

  beforeEach(() => {
    tituloAlEmpezar = document.title;
    cabeceraAlEmpezar = new Set(nodosDeLaCabecera());
    almacenesAlEmpezar = estadoDeLosAlmacenes();
    dicho.length = 0;
    escrito.length = 0;
    cronometrado.length = 0;
    imagenesPedidas.length = 0;
    mensajesMandados.length = 0;
    mensajesDifundidos.length = 0;
    balizasMandadas.length = 0;
    respuestasGuardadas.length = 0;
    mensajesAlTrabajador.length = 0;
    basesAbiertas.length = 0;
    escritoEnLaBase.length = 0;
    navegado.length = 0;

    const consola = console as unknown as Record<string, (...partes: unknown[]) => void>;

    // Se engancha en CADA test y no una vez: los specs llaman a
    // `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de
    // hooks de Vitest corre ANTES que este tapon y devuelve la consola a su
    // sitio. Sin volver a engancharla, a partir del segundo test el espia
    // estaria mirando una consola que ya nadie dobla, y pasaria en verde.
    for (const nombre of metodosDeConsola()) {
      const original = consola[nombre]?.bind(console);

      vi.spyOn(consola, nombre).mockImplementation((...partes: unknown[]) => {
        dicho.push(...partes);
        original?.(...partes);
      });
    }

    /**
     * LOS ALMACENES SE MIRAN DE DOS FORMAS, Y HACEN FALTA LAS DOS.
     *
     * Por el ESTADO (lo que haya guardado al terminar) y por las ESCRITURAS
     * (doblando `setItem` y el `document.cookie =`). No es redundancia:
     *
     * - El estado solo no basta porque los specs limpian los almacenes en SU
     *   propio `afterEach`, que con el orden de hooks de Vitest corre ANTES que
     *   este tapon: lo que el test guardo ya no esta cuando miramos. Ademas,
     *   una escritura seguida de un `removeItem` no deja estado y pasaria.
     * - Las escrituras solas no bastan porque en jsdom `localStorage.lo = 'x'`
     *   —asignacion por propiedad— NO pasa por `setItem`: lo resuelve el proxy
     *   del almacen. Medido con una sonda. Ese camino solo lo ve el estado.
     */
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      clave: string,
      valor: string,
    ) {
      escrito.push({
        almacen: this === sessionStorage ? 'sessionStorage' : 'localStorage',
        clave,
        valor,
      });

      // REGISTRA Y DEJA PASAR, como el espia de la consola: tragarse la
      // escritura cambiaria lo que hace la pantalla bajo prueba.
      PONER_EN_UN_ALMACEN.call(this, clave, valor);
    });

    // Las galletas no tienen metodo que doblar: son un ACCESOR de
    // `Document.prototype`. Se redefine como propiedad propia de `document`
    // —`vi.restoreAllMocks()` no la toca— y se borra la de la vuelta anterior
    // antes, para no envolver el enganche de ayer.
    delete (document as unknown as Record<string, unknown>).cookie;

    const leer = GALLETAS_ORIGINALES?.get;
    const poner = GALLETAS_ORIGINALES?.set;

    if (leer !== undefined && poner !== undefined) {
      Object.defineProperty(document, 'cookie', {
        configurable: true,
        get: () => leer.call(document) as string,
        set: (texto: string) => {
          const corte = String(texto).indexOf('=');
          const clave = corte === -1 ? String(texto) : String(texto).slice(0, corte);
          const resto = corte === -1 ? '' : String(texto).slice(corte + 1);

          escrito.push({
            almacen: 'galletas',
            clave: clave.trim(),
            // Solo el VALOR, sin los atributos (`; path=`, `; expires=`): lo
            // que se guarda es lo de antes del primer punto y coma.
            valor: (resto.split(';')[0] ?? '').trim(),
          });

          poner.call(document, texto);
        },
      });
    }

    /**
     * EL BUFFER DE MARCAS SE MIRA DE DOS FORMAS, Y HACEN FALTA LAS DOS.
     *
     * Igual que los almacenes: por lo que QUEDA en el buffer al terminar y por
     * las LLAMADAS, doblando `mark` y `measure`. No es redundancia:
     *
     * - El buffer solo no basta porque `performance.clearMarks()` es parte de
     *   la API publica y es lo que escribe cualquiera que «mida y limpie». Una
     *   marca con el margen del salon seguida de un `clearMarks()` tres lineas
     *   despues no deja rastro en el buffer, igual que un `setItem` seguido de
     *   un `removeItem` no deja estado. Medido con una sonda.
     * - Las llamadas solas no bastan porque solo ven lo que pase DESPUES de
     *   este `beforeEach`: una marca puesta en el cuerpo de un modulo —al
     *   importarlo— ya esta en el buffer antes de que exista el espia. Medido:
     *   `getEntriesByType('mark')` la devuelve en el primer test del archivo.
     *
     * Se engancha en CADA test por el mismo motivo que la consola: los specs
     * llaman a `vi.restoreAllMocks()` en su propio `afterEach`, que corre ANTES
     * que este tapon y devuelve los dos metodos a su sitio.
     */
    const llamada = (tipo: TipoDeEntrada) =>
      function (this: Performance, ...partes: unknown[]) {
        cronometrado.push({
          tipo,
          nombre: String(partes[0]),
          detalle: detalleDeLasOpciones(partes[1]),
        });

        // REGISTRA Y DEJA PASAR, como el resto del tapon. Y se reenvia con
        // `apply` y los argumentos TAL CUAL: `measure(nombre, opciones)` y
        // `measure(nombre, marcaInicial, marcaFinal)` son dos sobrecargas que
        // WebIDL distingue por `arguments.length`, asi que rellenar el tercero
        // con `undefined` cambiaria cual se elige.
        return (tipo === 'mark' ? MARCAR : MEDIR).apply(this, partes as [string]);
      };

    vi.spyOn(PROTOTIPO_DEL_CRONOMETRO, 'mark').mockImplementation(
      llamada('mark') as Performance['mark'],
    );
    vi.spyOn(PROTOTIPO_DEL_CRONOMETRO, 'measure').mockImplementation(
      llamada('measure') as Performance['measure'],
    );

    /**
     * EL `src` DE UNA IMAGEN ES UN ACCESOR DEL PROTOTIPO, no un metodo.
     *
     * Se redefine igual que las galletas y por los mismos dos motivos: un
     * `vi.spyOn` sobre un accesor no sobrevive al `vi.restoreAllMocks()` que
     * los specs llaman en SU `afterEach` —que corre ANTES que este tapon—, y
     * hay que envolver SIEMPRE el descriptor ORIGINAL, cogido una vez al
     * cargar, para que enganchar en cada test no apile un envoltorio sobre el
     * de ayer y cuente cada asignacion siete veces.
     *
     * CUBRE TAMBIEN EL `<img>` DE JSX, y eso se midio con una sonda en lugar
     * de suponerlo: React 19 acaba pasando por este mismo accesor al pintar un
     * `<img src=…>`, no solo por `setAttribute`. O sea que un `<img>` escondido
     * en el arbol con el dato en la URL cae por aqui aunque nadie mire ese
     * nodo. Lo que NO pasa por aqui es un `setAttribute('src', …)` a pelo
     * sobre un nodo suelto: para eso esta la otra mitad, la barrida del
     * documento al terminar.
     */
    const leerElSrc = SRC_DE_UNA_IMAGEN?.get;
    const ponerElSrc = SRC_DE_UNA_IMAGEN?.set;

    if (leerElSrc !== undefined && ponerElSrc !== undefined) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: SRC_DE_UNA_IMAGEN?.enumerable ?? true,
        get(this: HTMLImageElement) {
          return leerElSrc.call(this) as string;
        },
        set(this: HTMLImageElement, valor: string) {
          // El valor CRUDO, antes de que el accesor lo resuelva a una URL
          // absoluta y le codifique las comillas: lo que se busca dentro es
          // un centinela tal como lo escribio quien lo filtro.
          imagenesPedidas.push(String(valor));
          ponerElSrc.call(this, valor);
        },
      });
    }

    /**
     * LAS TRES SALIDAS LATERALES, enganchadas en CADA test como el resto.
     *
     * Por el motivo de siempre: los specs llaman a `vi.restoreAllMocks()` en
     * su propio `afterEach`, que con el orden de hooks de Vitest corre ANTES
     * que este tapon. Lo que se dobla con `vi.spyOn` —el canal de difusion—
     * volveria a su sitio y el tapon miraria, a partir del segundo test de
     * cada archivo, algo que ya nadie dobla: verde y ciego.
     *
     * Las tres reenvian a la funcion ORIGINAL, cogida una vez al cargar, para
     * que volver a enganchar no apile un envoltorio sobre el de ayer y cuente
     * cada mensaje tantas veces como tests lleve el archivo.
     */
    Object.defineProperty(window, 'postMessage', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (this: Window, ...partes: unknown[]) {
        // Solo el MENSAJE, que es lo que viaja. El segundo argumento es el
        // origen de destino —el `'*'` que hace peligrosa a esta puerta— y no
        // puede llevar un dato dentro: el navegador lo lee como un origen.
        mensajesMandados.push(comoTexto([partes[0]]));

        // REGISTRA Y DEJA PASAR, como el resto del tapon: tragarse el mensaje
        // cambiaria lo que hace la pantalla bajo prueba.
        return (MANDAR_UN_MENSAJE as (...a: unknown[]) => void).apply(this, partes);
      },
    });

    vi.spyOn(PROTOTIPO_DEL_CANAL, 'postMessage').mockImplementation(function (
      this: BroadcastChannel,
      mensaje: unknown,
    ) {
      // El NOMBRE del canal va junto al mensaje: un `new BroadcastChannel(…)`
      // bautizado con el dato lo publica igual que publicarlo en el cuerpo, y
      // cuesta lo mismo mirarlo.
      mensajesDifundidos.push(`${this.name} ${comoTexto([mensaje])}`);

      return (DIFUNDIR as (this: BroadcastChannel, m: unknown) => void).call(this, mensaje);
    });

    /**
     * LA BALIZA SON DOS SITIOS, Y HAY QUE MIRAR LOS DOS.
     *
     * La URL y el cuerpo. No es lo mismo que pasen por el mismo sitio: un
     * dato en el query sale al REGISTRO DE ACCESO del servidor del otro lado
     * —que no es nuestro, y que se guarda por defecto— mientras que uno en el
     * cuerpo sale en la peticion. Se miran juntos y se afirman juntos, como
     * las dos mitades del canal de imagenes.
     *
     * No reenvia a nada: en jsdom no hay baliza debajo. Ver arriba.
     */
    Object.defineProperty(PROTOTIPO_DEL_NAVEGANTE, 'sendBeacon', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (url: unknown, cuerpo?: unknown): boolean {
        balizasMandadas.push(`${String(url)} ${cuerpoDeUnaBaliza(cuerpo)}`);
        return true;
      },
    });

    /**
     * EL NOVENO CANAL: el almacen de respuestas, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, porque lo que hay que cazar es la forma
     * prudente —`globalThis.caches?.open(...)`—, que sin esto no hace nada y
     * pasa en verde. Y no reenvia a nada: no hay almacen debajo al que
     * reenviar, y las lecturas devuelven «no esta», que es lo que devuelve un
     * almacen vacio.
     */
    const almacenDeMentira = (nombre: string) => {
      const anotar = (peticion: unknown): void => {
        respuestasGuardadas.push({ almacen: nombre, clave: claveDeUnaPeticion(peticion) });
      };

      return {
        put: (peticion: unknown) => {
          anotar(peticion);
          return Promise.resolve(undefined);
        },
        add: (peticion: unknown) => {
          anotar(peticion);
          return Promise.resolve(undefined);
        },
        addAll: (peticiones: unknown[]) => {
          for (const una of peticiones) anotar(una);
          return Promise.resolve(undefined);
        },
        match: () => Promise.resolve(undefined),
        matchAll: () => Promise.resolve([]),
        delete: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
      };
    };

    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        open: (nombre: unknown) => Promise.resolve(almacenDeMentira(String(nombre))),
        has: () => Promise.resolve(false),
        delete: () => Promise.resolve(false),
        keys: () => Promise.resolve([]),
        match: () => Promise.resolve(undefined),
      },
    });

    /**
     * EL DECIMO CANAL: el service worker, que en este producto esta instalado.
     *
     * Se DEFINE, como la baliza y como `caches`, porque lo que hay que cazar
     * es la forma prudente —`navigator.serviceWorker?.controller?.postMessage`—,
     * que sin esto no hace nada y pasa en verde.
     *
     * HAY TRES PUERTAS AL MISMO WORKER Y SE MIRAN LAS TRES, porque las tres
     * son la forma natural de escribirlo: el `controller` —el que ya controla
     * esta pagina—, el `active` del registro que devuelve `ready` —la forma
     * que usa `boton-de-push.tsx` para esperar a que este instalado— y el de
     * `register`. Cada mensaje se anota CON LA PUERTA por la que salio, para
     * que el informe diga cual sin decir el dato.
     *
     * El resto de la superficie se deja en lo que devuelve un navegador sin
     * nada registrado —`getRegistration()` da `undefined`, `getRegistrations()`
     * da una lista vacia— porque este tapon no esta para simular un worker:
     * esta para que un mensaje hacia el no sea invisible.
     */
    const trabajadorDeMentira = (puerta: string) => ({
      scriptURL: '/sw.js',
      state: 'activated',
      postMessage: (mensaje: unknown) => {
        mensajesAlTrabajador.push(`${puerta} ${comoTexto([mensaje])}`);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        controller: trabajadorDeMentira('controller'),
        ready: Promise.resolve({ active: trabajadorDeMentira('ready.active') }),
        register: () => Promise.resolve({ active: trabajadorDeMentira('register.active') }),
        getRegistration: () => Promise.resolve(undefined),
        getRegistrations: () => Promise.resolve([]),
        startMessages: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
      },
    });

    /**
     * EL UNDECIMO CANAL: IndexedDB, que jsdom no trae.
     *
     * Se DEFINE, como la baliza, como `caches` y como el service worker,
     * porque lo que hay que cazar es la forma prudente
     * —`globalThis.indexedDB?.open(…)`—, que sin esto no hace nada y pasa en
     * verde mientras en el navegador del mostrador escribe en disco.
     *
     * SE ENGANCHA EN CADA TEST, como todo lo de arriba: los specs llaman a
     * `vi.restoreAllMocks()` en su propio `afterEach`, que con el orden de
     * hooks de Vitest corre ANTES que este tapon; y ademas el `afterEach` de
     * abajo devuelve `indexedDB` a no existir, asi que sin volver a ponerlo
     * aqui el canal estaria apagado a partir del segundo test de cada archivo:
     * verde y ciego.
     *
     * No reenvia a nada —no hay base debajo— y la de mentira nace VACIA en
     * cada test: lo que un test guarde no lo hereda el siguiente, igual que
     * los almacenes se restauran y las listas se vacian.
     */
    const anotarEscritura = (escritura: EscrituraEnLaBase): void => {
      escritoEnLaBase.push(escritura);
    };

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: {
        open: (nombre: unknown, version?: unknown) => {
          const base = String(nombre);
          basesAbiertas.push(base);

          const laBase = baseDeDatosDeMentira(base, Number(version) || 1, anotarEscritura);

          const apertura = conOyentes({
            result: laBase,
            error: null,
            readyState: 'done',
            onsuccess: null,
            onerror: null,
            onblocked: null,
            onupgradeneeded: null,
            transaction: null,
          });

          /**
           * `upgradeneeded` SIEMPRE, y en su propia microtarea antes de
           * `success`.
           *
           * Siempre, porque en un test no hay ninguna base de la sesion
           * anterior: la version que hay en disco es cero y la plataforma de
           * verdad dispara la actualizacion. Es ademas lo que hace falta para
           * que el `createObjectStore` del codigo bajo prueba corra y el `put`
           * de `onsuccess` tenga donde caer.
           *
           * En dos microtareas encadenadas y no en una, como la plataforma, por
           * si alguien asigna `onsuccess` DENTRO de `onupgradeneeded` —que es
           * una forma que se escribe— en lugar de justo despues de `open()`.
           */
          masTardeEnLaBase(() => {
            // `apertura.transaction` es, durante la actualizacion, la
            // transaccion de `versionchange`: por ahi llega
            // `evento.target.transaction.objectStore('x')`, que es la forma de
            // tocar un almacen recien creado sin abrir otra transaccion.
            const abrirTransaccion = laBase.transaction as (
              nombres: unknown,
              modo?: unknown,
            ) => unknown;
            apertura.transaction = abrirTransaccion.call(laBase, [], 'versionchange');
            dispararEnLaBase(apertura, 'upgradeneeded');
          });
          masTardeEnLaBase(() => dispararEnLaBase(apertura, 'success'));

          return apertura;
        },
        /**
         * Borrar una base tambien es usarla, y el NOMBRE puede llevar el dato:
         * un `deleteDatabase(claveTemporal)` lo publica igual que una clave.
         */
        deleteDatabase: (nombre: unknown) => {
          basesAbiertas.push(String(nombre));
          return peticionDeLaBase(undefined);
        },
        databases: () => Promise.resolve([]),
        cmp: (uno: unknown, otro: unknown) => (String(uno) < String(otro) ? -1 : 1),
      },
    });

    /**
     * EL DECIMOTERCER CANAL: las cinco puertas de la History API.
     *
     * SE ENGANCHA EN CADA TEST, como la consola y como `mark`/`measure`, y por
     * el mismo motivo medido: los specs llaman a `vi.restoreAllMocks()` en su
     * propio `afterEach`, que con el orden de hooks de Vitest corre ANTES que
     * este tapon y devuelve las cinco funciones a su sitio. Sin volver a
     * engancharlas, a partir del segundo test de cada archivo el espia estaria
     * mirando un historial que ya nadie dobla: verde y ciego.
     *
     * (La OTRA mitad del canal —la comparacion de la URL— no necesita espia
     * ninguno, como el duodecimo: lo que delata la fuga es la URL que QUEDA, y
     * eso se lee al terminar. Esta mitad si lo necesita, porque un
     * `pushState(datos, '', la misma URL)` no deja nada que comparar.)
     *
     * Se dobla con `vi.spyOn` y no redefiniendo el descriptor —como si hay que
     * hacer con las galletas, el `src` de una imagen y `window.postMessage`—
     * porque aqui si hay un metodo de prototipo que doblar: MEDIDO,
     * `History.prototype.pushState` es una propiedad de DATOS escribible y
     * configurable, y `window.history` no tiene ni una propiedad propia que la
     * tape.
     *
     * REGISTRA Y DEJA PASAR, como el resto del tapon, reenviando a la funcion
     * ORIGINAL cogida al cargar: tragarse la llamada cambiaria lo que hace la
     * pantalla bajo prueba Y dejaria ciega a la otra mitad, porque la URL no
     * llegaria a moverse.
     */
    for (const puerta of PUERTAS_DEL_HISTORIAL) {
      const original = HISTORIAL_ORIGINAL.get(puerta);
      if (original === undefined) continue;

      vi.spyOn(History.prototype, puerta).mockImplementation(function (
        this: History,
        ...partes: unknown[]
      ) {
        // Se anota ANTES de reenviar: si la llamada de verdad explotara, la
        // fuga ya quedo registrada. Es la regla del resto del tapon.
        navegado.push({ puerta, argumentos: comoTexto(partes) });

        return original.apply(this, partes);
      } as never);
    }
  });

  afterEach(() => {
    const titulo = document.title;
    const nombreDeLaPestana = window.name;
    // Se mira el TOTAL de lo dicho, serializado, no un metodo concreto ni el
    // primer argumento: el dato suele viajar DENTRO de un objeto que se pasa
    // como segundo o tercer argumento y que la consola expande sola.
    const loDicho = comoTexto(dicho);

    /**
     * LA CABECERA SE LEE AQUI, ANTES DE QUE `cleanup()` DESMONTE.
     *
     * Este `afterEach` se registra DESPUES del de `cleanup` en
     * `vitest.setup.ts`, y Vitest corre los `afterEach` en orden inverso al de
     * registro, asi que este va primero y el arbol sigue montado. Si corriera
     * detras, React ya habria quitado sus propios nodos del `<head>` y el
     * canal se miraria siempre vacio.
     */
    const laCabecera = document.head.innerHTML;
    const aparecidosEnLaCabecera = nodosDeLaCabecera().filter(
      (nodo) => !cabeceraAlEmpezar.has(nodo),
    );

    /**
     * LA OTRA MITAD DEL SEPTIMO CANAL, y tambien ANTES de desmontar.
     *
     * El espia del accesor ve lo que se ASIGNA, que es por donde se va una
     * imagen suelta y tambien el `<img>` de JSX. Esta barrida ve lo que QUEDA
     * en el documento, que es lo unico que caza un `setAttribute('src', …)` a
     * pelo —el accesor no se entera—. Como el `<head>`, se lee con el arbol
     * todavia montado: despues de `cleanup()` no hay ni un nodo que mirar.
     */
    const imagenesDelDocumento = [...document.querySelectorAll('img')].map(
      (imagen) => imagen.getAttribute('src') ?? '',
    );

    /**
     * EL DESMONTAJE VA AQUI DENTRO, Y EL ORDEN ES LA PARTE DELICADA.
     *
     * `vitest.setup.ts` registra `afterEach(cleanup)` ANTES que este tapon, asi
     * que con el orden inverso de Vitest el tapon corre primero. Eso es lo que
     * hace falta —arriba se lee el `<head>` con el arbol todavia montado—, pero
     * tiene un coste: cuando una de las afirmaciones de abajo LANZA, Vitest
     * aborta la cadena de `afterEach` y el `cleanup()` de `vitest.setup.ts` NO
     * llega a correr. El DOM del test que fallo se arrastra al siguiente, que
     * cae con «Found multiple elements with the role ...» sin tener la culpa:
     * dos fallos de verdad llegan al informe con ocho lineas de ruido encima,
     * y la primera que se lee acusa al inocente.
     *
     * Se desmonta aqui, DESPUES de la foto de la cabecera y ANTES de afirmar.
     * El `afterEach(cleanup)` de `vitest.setup.ts` se queda igual: `cleanup()`
     * es idempotente —vacia su registro de montajes— y sigue cubriendo el caso
     * de que este tapon no llegue a correr.
     *
     * NO se puede mover una linea mas arriba: React 19 sube sus `<meta>` al
     * `<head>` y se los lleva al desmontar, asi que con el `cleanup()` delante
     * de la foto el cuarto canal se quedaria CIEGO —en verde, sin que nada lo
     * diga—, que es peor que el ruido que esto arregla.
     */
    cleanup();

    const almacenesAlTerminar = estadoDeLosAlmacenes();

    /**
     * EL BUFFER SE LEE AQUI, DESPUES DE `cleanup()`, Y NO ANTES.
     *
     * Al reves que el `<head>`: las marcas no se borran al desmontar —son una
     * lista que solo crece—, asi que leerlas despues del desmontaje caza
     * ademas la que ponga la limpieza de un `useEffect`. Antes no cazaria nada
     * mas y perderia esa.
     */
    /**
     * EL DUODECIMO CANAL SE LEE AQUI, DESPUES DE `cleanup()`, Y AL REVES QUE
     * EL `<head>`.
     *
     * El `<head>` tiene que leerse ANTES de desmontar porque React 19 sube sus
     * `<meta>` ahi y SE LOS LLEVA al desmontar: con el `cleanup()` delante, ese
     * canal se quedaria ciego en verde. Aqui es al reves, y es la propiedad 1
     * del docblock de `ALREDEDOR_DEL_CUERPO`: estos atributos NO estan en el
     * arbol que `render` monta, asi que el desmontaje no borra ni uno. Leer
     * despues no pierde NADA y gana una cosa —la misma que gana el buffer de
     * marcas, que se lee aqui abajo por lo mismo—: caza ademas el atributo que
     * ponga la LIMPIEZA de un `useEffect`, que es codigo de la pantalla que
     * solo corre al desmontar y que leyendo antes no se veria nunca.
     */
    const atributosDeAlrededor: Record<ElementoDeAlrededor, [string, string][]> = {
      '<html>': atributosDe(document.documentElement),
      '<body>': atributosDe(document.body),
    };

    /**
     * EL DECIMOTERCER CANAL SE LEE AQUI, DESPUES DE `cleanup()`, COMO EL DOCE.
     *
     * Y por el mismo motivo exacto: `location` NO esta en el arbol que `render`
     * monta, asi que el desmontaje no toca ni un caracter de la URL. Leer
     * despues no pierde NADA y gana lo mismo que ganan los atributos del
     * `<html>` y el buffer de marcas: caza ademas la URL que escriba la
     * LIMPIEZA de un `useEffect`, que es codigo de la pantalla que solo corre
     * al desmontar y que leyendo antes no se veria nunca.
     *
     * Es el reves del `<head>`, que tiene que leerse ANTES porque React 19 se
     * lleva sus `<meta>` al desmontar y leer despues dejaria ese canal ciego en
     * verde.
     */
    const fotoAlTerminar = fotoDeLaUrl();
    const urlAlTerminar = window.location.href;

    const cronometradoEntero = [...entradasDelBuffer('mark'), ...entradasDelBuffer('measure')];
    cronometradoEntero.push(...cronometrado);

    const loCronometrado: Record<TipoDeEntrada, string> = {
      mark: comoTextoLasEntradas(cronometradoEntero, 'mark'),
      measure: comoTextoLasEntradas(cronometradoEntero, 'measure'),
    };

    /**
     * LAS DOS MITADES, juntadas por almacen: lo que quedo guardado que antes no
     * estaba, mas lo que se escribio aunque alguien lo borrara despues.
     */
    const guardado: Record<NombreDeAlmacen, Set<string>> = {
      localStorage: new Set(),
      sessionStorage: new Set(),
      galletas: new Set(),
    };

    for (const almacen of ALMACENES) {
      const antes = almacenesAlEmpezar[almacen];

      for (const [clave, valor] of Object.entries(almacenesAlTerminar[almacen])) {
        if (antes[clave] !== valor) guardado[almacen].add(clave);
      }
    }

    for (const escritura of escrito) guardado[escritura.almacen].add(escritura.clave);

    /** Todo lo que paso por un almacen, clave Y valor, para buscar centinelas. */
    const loGuardado = [
      ...escrito.map((escritura) => `${escritura.clave}=${escritura.valor}`),
      ...ALMACENES.map((almacen) => JSON.stringify(almacenesAlTerminar[almacen])),
    ].join(' ');

    // Los canales se devuelven a como estaban ANTES de afirmar nada: si no, el
    // test que ensucia uno hace caer tambien a los que vengan detras y el
    // informe acusa al inocente.
    //
    // EL `<head>` ES LA EXCEPCION Y NO SE TOCA: arrancarle un nodo que React
    // subio ahi rompe el desmontaje de `cleanup()` con un
    // «Cannot read properties of null (reading 'removeChild')» —medido—, y el
    // test siguiente hereda el estropicio. No hace falta: el `cleanup()` de
    // arriba ya corrio y React quita los suyos, y la foto de `beforeEach` hace
    // que un nodo que sobreviva no se le impute al inocente.
    //
    // EL BUFFER DE MARCAS SE VACIA AQUI, DESPUES DE LEERLO Y ANTES DE AFIRMAR.
    // Vaciarlo en el `beforeEach` dejaria el canal CIEGO para lo marcado al
    // importar el modulo —que ya esta en el buffer antes del primer hook— y
    // vaciarlo despues de las afirmaciones no llegaria a correr cuando una
    // lanza: el buffer solo crece, asi que el test siguiente heredaria las
    // marcas del que fallo y el informe acusaria al inocente.
    //
    // Se vacia por `EL_CRONOMETRO` y no por `performance`: si un test se fue
    // con `vi.useFakeTimers()` puesto, el `performance` global es el falso de
    // sinon y su `clearMarks()` no toca el buffer de verdad.
    document.title = tituloAlEmpezar;
    window.name = '';
    dicho.length = 0;
    restaurarLosAlmacenes(almacenesAlEmpezar);
    escrito.length = 0;
    EL_CRONOMETRO.clearMarks();
    EL_CRONOMETRO.clearMeasures();
    cronometrado.length = 0;

    /** Las dos mitades del septimo canal, juntas, para buscar dentro. */
    const loPedidoPorImagen = [...imagenesPedidas, ...imagenesDelDocumento].join(' ');
    imagenesPedidas.length = 0;

    /**
     * Las tres puertas del octavo canal, cada una por su lado.
     *
     * Separadas y no en una sola cadena para que el informe diga POR CUAL se
     * fue el dato, que es informacion distinta: un `postMessage` se lo lleva
     * quien comparta la pagina, un `BroadcastChannel` otra pestaña y una
     * baliza un servidor de fuera. Se vacian ANTES de afirmar, como el resto:
     * si una afirmacion lanza, el test siguiente no hereda lo del que fallo y
     * el informe no acusa al inocente.
     */
    const loMensajeado = mensajesMandados.join(' ');
    const loDifundido = mensajesDifundidos.join(' ');
    const loBalizado = balizasMandadas.join(' ');
    mensajesMandados.length = 0;
    mensajesDifundidos.length = 0;
    balizasMandadas.length = 0;

    /**
     * El noveno canal: lo guardado en el almacen de respuestas.
     *
     * Se vacia la lista y se devuelve `caches` a como estaba —en jsdom, a no
     * estar— ANTES de afirmar, como el resto: si una afirmacion lanza, el test
     * siguiente no hereda lo del que fallo y el informe no acusa al inocente.
     */
    const loCacheado = respuestasGuardadas.map((una) => `${una.almacen} ${una.clave}`);
    respuestasGuardadas.length = 0;

    if (CACHES_ORIGINAL === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).caches;
    } else {
      Object.defineProperty(globalThis, 'caches', CACHES_ORIGINAL);
    }

    /**
     * El decimo canal: lo que se le mando al service worker.
     *
     * Se lee, se vacia la lista y se devuelve `navigator.serviceWorker` a como
     * estaba —en jsdom, a no estar— ANTES de afirmar, exactamente como
     * `caches`: si una afirmacion lanza, el test siguiente no hereda lo del
     * que fallo y el informe no acusa al inocente. Y dejarlo puesto entre
     * archivos cambiaria la deteccion de capacidades de un spec que no pidio
     * nada.
     */
    const loMandadoAlTrabajador = mensajesAlTrabajador.join(' ');
    mensajesAlTrabajador.length = 0;

    if (SERVICE_WORKER_ORIGINAL === undefined) {
      Reflect.deleteProperty(navigator, 'serviceWorker');
    } else {
      Object.defineProperty(navigator, 'serviceWorker', SERVICE_WORKER_ORIGINAL);
    }

    /**
     * El undecimo canal: lo que paso por IndexedDB.
     *
     * Se lee, se vacian las listas y se devuelve `indexedDB` a como estaba
     * —en jsdom, a no estar— ANTES de afirmar, exactamente como `caches` y
     * como el service worker: si una afirmacion lanza, el test siguiente no
     * hereda lo del que fallo y el informe no acusa al inocente. Y dejarlo
     * puesto entre archivos cambiaria la deteccion de capacidades de un spec
     * que no pidio nada.
     */
    const lasBasesAbiertas = basesAbiertas.join(' ');
    const loEscritoEnLaBase = comoTextoLasEscrituras(escritoEnLaBase);
    const puertasDeLaBase = escritoEnLaBase.map(descripcionDeUnaEscritura);
    // Por `claveSegura` y sin repetidos: una base bautizada con un dato
    // vigilado se nombra por el NOMBRE del dato, no por la cadena.
    const nombresDeLasBases = [...new Set(basesAbiertas.map(claveSegura))];
    basesAbiertas.length = 0;
    escritoEnLaBase.length = 0;

    if (INDEXED_DB_ORIGINAL === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).indexedDB;
    } else {
      Object.defineProperty(globalThis, 'indexedDB', INDEXED_DB_ORIGINAL);
    }

    /**
     * EL DUODECIMO CANAL SE LIMPIA AQUI, Y ES LO QUE EVITA ACUSAR AL INOCENTE.
     *
     * Es la unica parte de este canal que no es una lectura, y hace falta
     * exactamente por la propiedad que lo hace peligroso: `cleanup()` no borra
     * estos atributos, asi que sin esta vuelta el que escriba uno hace caer
     * TAMBIEN a todos los tests que vengan detras en el mismo archivo. Esta
     * medido: con la mutacion puesta, un test fallo por el atributo que habia
     * dejado el anterior. Es lo mismo que hacen `restaurarLosAlmacenes`,
     * `clearMarks` y el `window.name = ''` de aqui arriba, y por el mismo
     * motivo: se deja el canal como estaba ANTES de afirmar nada, para que el
     * informe tenga un solo fallo y señale al test que si lo causo.
     *
     * Se borran TODOS y no se restaura ninguno, que es la misma decision que
     * la forma fuerte de abajo y se apoya en la misma medida: los dos
     * elementos nacen sin ni un atributo y nadie del arbol les pone ninguno.
     */
    for (const cual of ALREDEDOR_DEL_CUERPO) {
      const elemento = elementoDeAlrededor(cual);

      for (const [nombre] of atributosDeAlrededor[cual]) elemento.removeAttribute(nombre);
    }

    const loPuestoAlrededor: Record<ElementoDeAlrededor, string> = {
      '<html>': textoDeLosAtributos(atributosDeAlrededor['<html>']),
      '<body>': textoDeLosAtributos(atributosDeAlrededor['<body>']),
    };

    /**
     * EL DECIMOTERCER CANAL SE DEVUELVE A SU SITIO AQUI, ANTES DE AFIRMAR.
     *
     * Es lo mismo que hacen `restaurarLosAlmacenes`, el `window.name = ''`,
     * el `clearMarks()` y el borrado de atributos de aqui arriba, y hace falta
     * por la propiedad que hace peligroso a este canal: `cleanup()` no toca
     * `location`, asi que sin esta vuelta la pantalla que ensucie la URL hace
     * caer TAMBIEN a todos los tests que vengan detras en el mismo archivo y
     * el informe acusa al inocente. Esta observado en este repo antes de que
     * el canal existiera: la query que sembraba un test aparecia intacta en el
     * siguiente.
     *
     * Se vuelve con la `replaceState` ORIGINAL y no con la doblada, por dos
     * cosas: el espia anotaria esta restauracion como una llamada de la
     * pantalla, y despues del `vi.restoreAllMocks()` de un spec puede que la
     * doblada ya no este. Y se vuelve a la foto DE AL CARGAR —no a una del
     * `beforeEach`—, que es la que hace verdadera la premisa de la forma
     * fuerte en cada test.
     *
     * `replaceState` y no `pushState`: volver no debe dejar una entrada mas en
     * el historial.
     */
    const volverALaUrl = HISTORIAL_ORIGINAL.get('replaceState');
    volverALaUrl?.call(window.history, ESTADO_AL_CARGAR, '', URL_AL_CARGAR);

    /**
     * Las dos mitades del decimotercer canal, leidas ya y vaciadas antes de
     * afirmar: la URL que QUEDO —cruda y decodificada, mas el estado del
     * historial— y las llamadas a las cinco puertas, con sus argumentos.
     */
    const laUrl = `${urlComoTexto(urlAlTerminar)} ${fotoAlTerminar.estado}`;
    const llamadasAlHistorial = [...navegado];
    const loNavegado = llamadasAlHistorial
      .map((una) => `${una.puerta} ${una.argumentos}`)
      .join(' ');
    const puertasDelHistorial = [...new Set(llamadasAlHistorial.map((una) => una.puerta))];
    const partesCambiadas = PARTES_DE_LA_URL.filter(
      (parte) => fotoAlTerminar[parte] !== FOTO_AL_CARGAR[parte],
    );
    navegado.length = 0;

    /**
     * POR QUE PUERTA SE FUE UN DATO CONCRETO, para el mensaje del fallo.
     *
     * El nombre de la puerta y el de la parte de la URL son vocabulario fijo
     * —`replaceState`, `hash`, `estado`—: ubican la fuga sin publicar ni un
     * caracter de lo que lleva dentro, que es la regla de todo este archivo.
     */
    const puertasQueLlevan = (valor: string): string => {
      const puertas = [
        ...new Set(
          llamadasAlHistorial.filter((una) => una.argumentos.includes(valor)).map((u) => u.puerta),
        ),
      ];

      // Sin ninguna puerta del historial, el dato entro escribiendo `location`
      // a pelo —`hash`, `assign` o `replace`—, que son accesores que no se
      // pueden doblar: ver el docblock de `PUERTAS_DEL_HISTORIAL`.
      return puertas.length === 0 ? 'una escritura directa en location' : puertas.join(', ');
    };

    expect(nombreDeLaPestana, 'la pantalla escribio en el nombre de la pestaña').toBe('');

    /**
     * `toBe(false)` sobre un `includes`, y NO `not.toContain(valor)`.
     *
     * Con `not.toContain`, Vitest imprime el argumento esperado en el informe:
     * el fallo de una contraseña filtrada filtraba la contraseña otra vez, al
     * registro de CI, que lo guarda mas tiempo y lo lee mas gente que la
     * consola del mostrador. Asi lo unico que se publica es el NOMBRE del dato
     * y un `true`.
     */
    for (const [nombre, valor] of todoLoVigilado()) {
      expect(titulo.includes(valor), `el titulo de la pagina lleva ${nombre}`).toBe(false);
      expect(loDicho.includes(valor), `la consola dijo ${nombre}`).toBe(false);
      expect(laCabecera.includes(valor), `la cabecera del documento lleva ${nombre}`).toBe(false);
      expect(loGuardado.includes(valor), `un almacen del navegador lleva ${nombre}`).toBe(false);

      /**
       * EL SEPTIMO CANAL SE AFIRMA COMO EL BUFFER DE MARCAS, no como
       * `window.name`: por CENTINELAS y no por estar vacio. Pedir una imagen
       * es legitimo —la portada de un gimnasio pinta su logo con una URL
       * externa— y un canal que lo prohiba se desactiva el dia que alguien
       * necesite una. Lo que no es legitimo es meter un dato del mostrador en
       * la URL que se pide.
       */
      expect(loPedidoPorImagen.includes(valor), `la URL de una imagen lleva ${nombre}`).toBe(false);

      /**
       * EL OCTAVO CANAL, UN `expect` POR PUERTA.
       *
       * Como el de imagenes y el de marcas: por CENTINELAS y no por «ninguna
       * llamada». Mandar un mensaje, sincronizar dos pestañas o medir uso son
       * cosas legitimas; llevar un dato del mostrador dentro, no. Y como
       * siempre, el mensaje nombra la CLAVE del dato y nunca su valor: un
       * `not.toContain(secreto)` imprimiria el secreto en el informe de CI,
       * que lo guarda mas tiempo y lo lee mas gente que la consola del
       * mostrador.
       */
      /**
       * EL NOVENO CANAL, por centinelas Y ademas por «nada guardado», abajo.
       *
       * Este va en la clave de la entrada —`cache.put(claveTemporal, …)` mete
       * el dato en el NOMBRE, igual que un `localStorage.setItem`—. Lo que no
       * se mira es el CUERPO de la respuesta: ver el docblock de
       * `CACHES_ORIGINAL`.
       */
      expect(
        loCacheado.join(' ').includes(valor),
        `el almacen de respuestas del navegador lleva ${nombre}`,
      ).toBe(false);

      expect(loMensajeado.includes(valor), `un window.postMessage lleva ${nombre}`).toBe(false);
      expect(loDifundido.includes(valor), `un BroadcastChannel lleva ${nombre}`).toBe(false);
      expect(loBalizado.includes(valor), `un navigator.sendBeacon lleva ${nombre}`).toBe(false);

      /**
       * EL DECIMO CANAL, por CENTINELAS y no por «ningun mensaje».
       *
       * Hablarle al service worker es legitimo y este producto ya lo hace:
       * `boton-de-push.tsx` espera a `navigator.serviceWorker.ready` para
       * suscribir las notificaciones de un alumno. Un canal que lo prohibiera
       * entero es de los que alguien desactiva el dia que lo necesita. Lo que
       * no es legitimo es meterle un dato del mostrador dentro: el worker
       * sobrevive a la pestaña y puede volver a sacarlo por puertas que ningun
       * tapon de esta pagina ve.
       *
       * El mensaje nombra la PUERTA y la CLAVE del dato, nunca su valor.
       */
      expect(
        loMandadoAlTrabajador.includes(valor),
        `un postMessage al service worker lleva ${nombre}`,
      ).toBe(false);

      /**
       * EL UNDECIMO CANAL, por centinelas PRIMERO y por «ninguna base» abajo.
       *
       * Las dos mitades no sobran la una a la otra y el orden importa. Con la
       * forma fuerte sola, el informe de una credencial filtrada diria «la
       * pantalla escribio en IndexedDB» y habria que ir a buscar QUE se fue;
       * con los centinelas delante lo dice solo. Y los centinelas solos no
       * bastan: no cubren el dato que nadie registro, que es justamente el
       * caso de un `put(variables)` que se lleva el objeto entero.
       *
       * Se separan el NOMBRE DE LA BASE y LAS ESCRITURAS porque son dos sitios
       * distintos —un `indexedDB.open(claveTemporal)` publica el dato sin
       * escribir ni un registro— y el informe gana diciendo cual.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato y un `true`.
       */
      expect(
        lasBasesAbiertas.includes(valor),
        `el nombre de una base de IndexedDB lleva ${nombre}`,
      ).toBe(false);
      expect(loEscritoEnLaBase.includes(valor), `una escritura en IndexedDB lleva ${nombre}`).toBe(
        false,
      );

      /**
       * EL DUODECIMO CANAL, por centinelas PRIMERO y por «ni un atributo»
       * abajo.
       *
       * Las dos mitades no sobran la una a la otra, y el orden es el mismo que
       * el de IndexedDB y por el mismo motivo: con la forma fuerte sola, el
       * informe de un dato filtrado diria «la pantalla escribio atributos en
       * el <html>: data-ultimo-trabajo» y habria que ir a buscar QUE se fue en
       * el valor; con los centinelas delante lo dice solo. Y los centinelas
       * solos no bastan, porque no cubren el dato que nadie registro —una
       * bandera con el nombre del gimnasio, la lista de roles de quien entro—,
       * que es justamente lo que una «marca de diagnostico» se lleva.
       *
       * Un `expect` por elemento para que el informe diga en cual de los dos
       * fue. El valor NUNCA entra en el mensaje: lo unico que se publica es el
       * NOMBRE del dato y un `true`.
       */
      for (const cual of ALREDEDOR_DEL_CUERPO) {
        expect(
          loPuestoAlrededor[cual].includes(valor),
          `un atributo del ${cual} lleva ${nombre}`,
        ).toBe(false);
      }

      /**
       * EL DECIMOTERCER CANAL, por centinelas PRIMERO y por «la URL no
       * cambio» abajo.
       *
       * Mismo orden y mismo motivo que IndexedDB y que los atributos del
       * `<html>`: con la forma fuerte sola, el informe diria «la pantalla
       * cambio la URL del documento: hash» y habria que ir a buscar QUE se
       * fue; con los centinelas delante lo dice solo. Y los centinelas solos
       * no bastan, porque no cubren el dato que nadie registro —el nombre del
       * gimnasio, la lista de quien entro hoy— que es justamente lo que un
       * «enlace para compartir la pantalla» se lleva.
       *
       * DOS AFIRMACIONES, una por mitad, porque son dos sitios distintos: la
       * URL que QUEDO —donde cae tambien un `location.hash = …`, que no pasa
       * por ninguna funcion doblable— y lo que se le PASO a una de las cinco
       * puertas, donde cae ademas un `pushState(datos, '', la misma URL)`, que
       * no deja nada en la barra de direcciones.
       *
       * El valor NUNCA entra en el mensaje, como en el resto del tapon: lo
       * unico que se publica es el NOMBRE del dato y un `true`. Un
       * `not.toContain(url)` aqui seria exactamente la fuga otra vez, hacia el
       * registro de CI.
       */
      expect(
        laUrl.includes(valor),
        `la URL del documento lleva ${nombre} (cambio: ${partesCambiadas.join(', ')}; por: ${puertasQueLlevan(valor)})`,
      ).toBe(false);

      expect(
        loNavegado.includes(valor),
        `una llamada a ${puertasQueLlevan(valor)} lleva ${nombre}`,
      ).toBe(false);

      /**
       * EL SEXTO CANAL SE AFIRMA COMO LOS ALMACENES Y NO COMO `window.name`.
       *
       * De `window.name` se puede afirmar que esta VACIO porque nadie mas
       * escribe ahi. Del buffer de User Timing, NO, y conviene ser exacto con
       * el motivo, que SE REMIDIO al montar el duodecimo canal y ya no dice lo
       * que decia. Cuando se escribio esto el buffer estaba vacio en los 58
       * archivos que habia —ni React 19.1 ni Vitest 3.2 ponen una sola
       * entrada— y un `toBe(0)` sobre las entradas nuevas habria pasado en
       * verde. HOY, con 66 archivos, YA NO: sigue sin haber una sola entrada
       * de React ni del runner, pero `relojes-falsos.spec.ts` SIEMBRA UNA A
       * PROPOSITO —`performance.mark('relojes-falsos:sonda')`— para probar que
       * con los relojes falsos puestos la marca llega al buffer de verdad. O
       * sea que la forma fuerte seria ROJA hoy mismo, y contra el unico spec
       * que existe para custodiar este canal. No se pone, entonces, por TRES
       * cosas y ya no por dos. La primera es que ese verde no
       * depende de nosotros: React instrumenta con `performance.measure` en
       * sus pistas de rendimiento y basta una version para que el tapon
       * empiece a acusar al runner. La segunda es que medir latencia ES
       * legitimo —al reves que meter un `<meta>` en el `<head>`, que aqui no
       * lo es nunca—, y un canal que prohibe medir se desactiva el dia que
       * alguien necesite medir. Lo que no es legitimo es meter un dato del
       * mostrador en el nombre —o en el `detail`— de la medicion. Y la
       * tercera, la que ya no es hipotetica: el propio paquete mide a
       * proposito, asi que la forma fuerte no es que fuera a costar algo
       * mañana, es que cuesta hoy.
       *
       * Se separan `mark` y `measure` en dos afirmaciones para que el informe
       * diga por cual de las dos puertas se fue, sin decir por donde: lo unico
       * que se publica sigue siendo el NOMBRE del dato.
       */
      for (const tipo of TIPOS_DE_ENTRADA) {
        expect(
          loCronometrado[tipo].includes(valor),
          `una entrada de performance.${tipo} lleva ${nombre}`,
        ).toBe(false);
      }
    }

    /**
     * LA OTRA MITAD DEL `<head>`, y NO es la misma que la de arriba.
     *
     * «No contiene centinelas» caza un dato metido en un nodo que ya estaba.
     * Esto caza el nodo NUEVO aunque lo que lleve dentro no sea ninguno de los
     * datos sembrados: un `<meta name="description">` con la lista de las
     * clases del dia no lleva centinela y publica el gimnasio entero.
     */
    expect(
      aparecidosEnLaCabecera.length,
      `la pantalla metio nodos en el <head>: ${aparecidosEnLaCabecera.map(etiquetaDe).join(', ')}`,
    ).toBe(0);

    for (const almacen of ALMACENES) {
      const claves = [...guardado[almacen]].map(claveSegura);

      expect(claves.length, `la pantalla guardo en ${almacen}: ${claves.join(', ')}`).toBe(0);
    }

    /**
     * EL CUARTO ALMACEN, afirmado como los otros tres: NADA GUARDADO.
     *
     * `sw.ts` ya lleva escrita la politica —el panel del admin no entra nunca
     * en la CacheStorage, porque el mostrador es una computadora compartida y
     * ese almacen sobrevive al cierre de sesion— y la cumple con una lista
     * blanca de dos rutas del alumno. Esto cierra la OTRA puerta al mismo
     * almacen: la que una pantalla puede abrir por su cuenta sin pasar por el
     * service worker.
     *
     * Las claves van por `claveSegura`, como las de los otros almacenes: el
     * informe nombra el dato vigilado en vez de publicar la cadena.
     */
    expect(
      loCacheado.length,
      `la pantalla guardo respuestas en CacheStorage: ${loCacheado.map(claveSegura).join(', ')}`,
    ).toBe(0);

    /**
     * EL QUINTO ALMACEN, afirmado por LA FORMA FUERTE: ni una base abierta.
     *
     * Es la forma de `window.name` y no la de las imagenes, y el motivo esta
     * medido en el docblock de `INDEXED_DB_ORIGINAL`: el producto no tiene
     * NINGUN uso legitimo de esta puerta —cero coincidencias de `indexedDB`,
     * `IDB*` o `idb` en `apps/web/src`— y nada del arbol de dependencias abre
     * una base durante un test. Donde no hay uso legitimo que proteger, la
     * forma fuerte es gratis y caza ademas el dato que nadie registro.
     *
     * DOS AFIRMACIONES Y NO UNA, y la mas especifica primero: si hubo una
     * escritura, el informe nombra LA PUERTA —`put`, `add` o `cursor.update`—,
     * la base, el almacen y la clave. Si solo se abrio la base sin escribir
     * nada, lo dice la segunda. Ni una de las dos imprime un valor.
     */
    expect(
      puertasDeLaBase.length,
      `la pantalla escribio en IndexedDB: ${puertasDeLaBase.join(', ')}`,
    ).toBe(0);

    expect(
      nombresDeLasBases.length,
      `la pantalla abrio una base de IndexedDB: ${nombresDeLasBases.join(', ')}`,
    ).toBe(0);

    /**
     * LOS DOS ELEMENTOS QUE ENVUELVEN AL CUERPO: NI UN ATRIBUTO.
     *
     * La forma de `window.name` y de IndexedDB, no la de las imagenes, y el
     * motivo esta medido en el docblock de `ALREDEDOR_DEL_CUERPO`: el producto
     * no tiene NINGUN uso legitimo de esta puerta —cero `documentElement` y
     * ningun `setAttribute`, `classList` ni `dataset` sobre `<html>` o
     * `<body>` en `apps/web/src`— y nadie del arbol escribe ahi durante un
     * test. Poner el idioma, el tema o una bandera de funcionalidad desde un
     * efecto de PANTALLA no es cosa de una pantalla: eso lo decide el layout,
     * del lado del servidor, donde no corre este tapon. Donde no hay uso
     * legitimo que proteger, la forma fuerte es gratis y caza ademas el dato
     * que nadie registro.
     *
     * CONTRA EL CONJUNTO VACIO Y NO CONTRA UNA FOTO DEL `beforeEach`. Con una
     * foto inicial, un atributo que hubiera dejado un test ANTERIOR del
     * archivo estaria en las dos fotos y pasaria en verde — que es la propiedad
     * 1 del canal (`cleanup()` no los borra) usada al reves, y justo el caso
     * que este tapon existe para cazar. La limpieza de aqui arriba hace
     * verdadera la premisa de la forma fuerte en cada test.
     *
     * Los nombres van por `claveSegura`, como las claves de los almacenes y
     * como los nombres de las bases: un `setAttribute(claveTemporal, '1')`
     * mete el dato en el NOMBRE, y el informe dice entonces como se llama el
     * dato vigilado en vez de publicar la cadena. Y NUNCA se imprime el VALOR,
     * que es lo que la «marca de diagnostico» se lleva.
     */
    for (const cual of ALREDEDOR_DEL_CUERPO) {
      const nombresDeLosAtributos = atributosDeAlrededor[cual].map(([nombre]) =>
        claveSegura(nombre),
      );

      expect(
        nombresDeLosAtributos.length,
        `la pantalla escribio atributos en el ${cual}: ${nombresDeLosAtributos.join(', ')}`,
      ).toBe(0);
    }

    /**
     * LA URL DEL DOCUMENTO: NI UN CARACTER DISTINTO, Y NI UNA LLAMADA A MANO.
     *
     * La forma de `window.name`, de IndexedDB y de los atributos del `<html>`,
     * no la de las imagenes, y el motivo esta MEDIDO en el docblock de
     * `PUERTAS_DEL_HISTORIAL`: media docena de pantallas escriben en la URL a
     * proposito —los filtros de turnos, horarios, ausencias y analisis— pero
     * lo hacen POR EL ROUTER DE NEXT, y los 26 specs que usan `next/navigation`
     * lo doblan con `vi.fn()` sin tocar `location`. Lo unico que puede mover
     * `location` dentro de un test es alguien saltandose el router, que es la
     * fuga. Donde no hay uso legitimo que proteger, la forma fuerte es gratis
     * y caza ademas el dato que nadie registro.
     *
     * DOS AFIRMACIONES Y NO UNA, y la mas concreta primero. Si la URL se
     * movio, el informe nombra LAS PARTES —origen, ruta, query, hash o el
     * estado del historial— y eso ubica la fuga sin publicar ni un caracter de
     * lo que lleva dentro. Si no se movio pero alguien llamo a una de las
     * cinco puertas —el caso del `pushState(datos, '', la misma URL)`, y el
     * del `replaceState` que limpia tres lineas despues lo que acaba de
     * escribir—, lo dice la segunda, nombrando LA PUERTA.
     *
     * Ni una de las dos imprime una URL, un estado ni un argumento.
     */
    expect(
      partesCambiadas.length,
      `la pantalla cambio la URL del documento: ${partesCambiadas.join(', ')}`,
    ).toBe(0);

    expect(
      puertasDelHistorial.length,
      `la pantalla movio el historial a mano: ${puertasDelHistorial.join(', ')}`,
    ).toBe(0);
  });
}
