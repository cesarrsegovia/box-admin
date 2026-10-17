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
 * navegador (`CacheStorage`) y el SERVICE WORKER
 * (`navigator.serviceWorker.controller.postMessage`), que en este producto
 * esta instalado de verdad. Ninguno lo mira un test de
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

/**
 * EL TAPON DE LOS DIEZ CANALES, en todos los specs.
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
       * EL SEXTO CANAL SE AFIRMA COMO LOS ALMACENES Y NO COMO `window.name`.
       *
       * De `window.name` se puede afirmar que esta VACIO porque nadie mas
       * escribe ahi. Del buffer de User Timing, NO, y conviene ser exacto con
       * el motivo: MEDIDO, hoy el buffer esta vacio en los 58 archivos —ni
       * React 19.1 ni Vitest 3.2 ponen una sola entrada—, asi que un
       * `toBe(0)` sobre las entradas nuevas pasaria en verde ahora mismo. No
       * se pone igualmente por dos cosas. La primera es que ese verde no
       * depende de nosotros: React instrumenta con `performance.measure` en
       * sus pistas de rendimiento y basta una version para que el tapon
       * empiece a acusar al runner. La segunda es que medir latencia ES
       * legitimo —al reves que meter un `<meta>` en el `<head>`, que aqui no
       * lo es nunca—, y un canal que prohibe medir se desactiva el dia que
       * alguien necesite medir. Lo que no es legitimo es meter un dato del
       * mostrador en el nombre —o en el `detail`— de la medicion.
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
  });
}
