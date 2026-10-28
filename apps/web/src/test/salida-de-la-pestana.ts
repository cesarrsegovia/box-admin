/**
 * EL EJE DECIMONOVENO: LOS EVENTOS DE SALIDA DE LA PESTAÑA — QUE NO SON UN
 * CANAL NUEVO SINO EL MOMENTO EN QUE LOS DIECIOCHO DE SIEMPRE SE QUEDAN CIEGOS.
 *
 * `espia-de-consola.ts` tapa dieciocho puertas y las audita TODAS en su
 * `afterEach`. El eje decimoctavo —`rato-libre.ts`— cerro una forma de
 * esquivarlas: aplazar la fuga a un hueco que jsdom no ejecuta nunca. Este
 * cierra LA OTRA, que no se parece en el mecanismo y que sobrevivio los 1561
 * tests del paquete con los canales de entonces puestos:
 *
 *     // en la pantalla del SMTP
 *     useEffect(() => {
 *       const guardarElBorrador = () => {
 *         localStorage.setItem('boxadmin:borrador-smtp',
 *           JSON.stringify({ ...borrador, clave: campoDeClave.current?.value ?? '' }));
 *       };
 *       window.addEventListener('pagehide', guardarElBorrador);
 *       return () => window.removeEventListener('pagehide', guardarElBorrador);
 *     });
 *
 * «Para no perder lo tecleado si se cierra la pestaña por error»: una peticion
 * de producto normalisima, que pasa una revision sin que nadie levante una
 * ceja, y que escribe la clave del servidor de correo EN CLARO en el disco de
 * una maquina que usan cuatro personas por turno.
 *
 * LO QUE HACE A ESTE EJE DISTINTO DE LOS DIECIOCHO CANALES: EL CANAL NO ESTA SIN
 * VIGILAR. `localStorage` es el quinto tapon y funciona. Esta MEDIDO con una
 * sonda: despachando `pagehide` a mano dentro de un test, el tapon de los
 * almacenes agarra la fuga al instante y nombra el dato. El instrumento estaba
 * entero; lo unico que faltaba era EL EVENTO. Y jsdom no dispara NINGUNO de
 * los cinco —`visibilitychange`, `pagehide`, `beforeunload`, `unload`,
 * `freeze`— por su cuenta: no hay navegacion, no hay cierre de pestaña, no hay
 * ciclo de vida. Un oyente registrado en un `useEffect` vive y muere sin que
 * nadie le hable.
 *
 * Es el mismo modo de fallo que el `?.` sobre una API que el entorno no tiene
 * —`sendBeacon`, `caches`, `serviceWorker`, `indexedDB`, `navigator.storage`, `Notification` y
 * `requestIdleCallback` dejaron siete fugas por ahi— pero por el otro extremo: aqui la API existe
 * entera (`addEventListener` funciona, el oyente se registra de verdad) y lo
 * que no ocurre nunca es EL DISPARO. El codigo de la fuga corre en el
 * navegador del mostrador y no corre en el test, sin un solo `?.` que lo
 * delate.
 *
 * ---------------------------------------------------------------------------
 * QUE SE DESPACHA Y EN QUE ORDEN, QUE NO ES ARBITRARIO.
 *
 * El navegador no manda estos cinco de cualquier forma, y el orden importa
 * porque lo que una pantalla escuche en el primero cambia lo que escribe en el
 * siguiente: quien guarde un borrador en `visibilitychange` y lo borre en
 * `pagehide` tiene que ver aqui la misma secuencia que alla o estariamos
 * midiendo otra cosa.
 *
 * 1. `beforeunload`, EL PRIMERO, Y EN LA PESTAÑA TODAVIA VISIBLE. Es el unico
 *    CANCELABLE de los cinco: existe para que la persona pueda decir que no se
 *    va. Mandarlo despues de haber ocultado la pestaña seria describir un
 *    mundo donde ya se fue y todavia se le pregunta.
 *
 * 2. `visibilitychange`, con `document.visibilityState` EN `'hidden'`. Es el
 *    primer escalon del ciclo de vida de verdad: una pestaña no se cierra ni
 *    se congela sin pasar por oculta. Y es el evento que la documentacion de
 *    la plataforma RECOMIENDA para guardar estado, asi que es justo donde mas
 *    probable es encontrar la linea que escribe.
 *
 * 3. `freeze`, que viene DE oculta y no de otro sitio: el navegador congela
 *    una pestaña que ya estaba escondida. Va antes de `pagehide` por eso y no
 *    por gusto.
 *
 * 4. `pagehide`, con su `persisted` puesto, que es el sustituto moderno de
 *    `unload` y el que recomienda la plataforma desde que `unload` dejo de ser
 *    fiable en movil.
 *
 * 5. `unload`, EL ULTIMO, aunque este en retirada: sigue siendo codigo que
 *    alguien puede escribir, y una puerta que se deja sin despachar es una
 *    puerta sin vigilar aunque su reputacion sea mala.
 *
 * La pestaña vuelve a estar visible al terminar los cinco. Ver `conLaPestanaOculta`.
 *
 * ---------------------------------------------------------------------------
 * DONDE SE DESPACHA, QUE ES LO QUE DECIDE SI ESTO SIRVE DE ALGO.
 *
 * ANTES del `cleanup()` del tapon, y ademas antes de su PRIMERA lectura. No es
 * una preferencia: esta MEDIDO con una sonda, y es la medida que decide la
 * forma entera de este archivo.
 *
 *     render(<Pantalla />)                 // la pantalla registra el oyente
 *     window.dispatchEvent(pagehide)  →  el oyente corre: 1 golpe
 *     cleanup()                            // React corre la limpieza del useEffect
 *     window.dispatchEvent(pagehide)  →  el oyente NO corre: 0 golpes
 *
 * El oyente de la fuga se quita en el `return` del `useEffect`, o sea DURANTE
 * el desmontaje. Despachar detras de `cleanup()` seria despachar a un
 * documento que ya no escucha a nadie: cero fugas, verde, y el eje cerrado en
 * falso —que es peor que no tenerlo, porque el verde dice que se miro—.
 *
 * Y tampoco vale «antes del `cleanup()` pero despues de las lecturas». El
 * tapon lee el `<head>` y los `<img>` del documento ANTES de desmontar —React
 * 19 se lleva sus `<meta>` al desmontar— y el resto DESPUES. Si esto se
 * despachara entre medias, lo que un oyente de salida escribiera en el
 * `<head>` no lo veria nadie. Por eso va como PRIMERA linea del `afterEach`
 * del tapon, antes de la foto del titulo: asi los dieciocho canales miran un mundo
 * en el que la pestaña ya se cerro.
 *
 * EL LIMITE, DICHO ENTERO Y MEDIDO. Cuando esto corre, el `afterEach` propio
 * de cada spec ya paso, y los 18 specs de los 69 que llaman ahi a
 * `vi.restoreAllMocks()` han devuelto a su sitio los espias que el tapon
 * engancha con `vi.spyOn` —la consola, entre ellos—: en ESOS, un oyente de
 * salida que solo hable por `console.info` puede no quedar anotado. En los
 * otros 51 si, y esta medido y no deducido: con un
 * `console.error('[smtp] adios', { clave })` dentro del oyente, el tapon de la
 * consola tiro 3 tests de 24 nombrando `claveSmtp` —los 3 en los que el campo
 * tenia algo escrito—.
 *
 * Y los canales que se leen por ESTADO y no por espia —los almacenes, el
 * titulo, `window.name`, el `<head>`, los atributos de alrededor y lo que
 * cuelgue del `<html>`, la URL, el
 * buffer de marcas— lo ven igual en los 69, porque no dependen de ningun
 * doble: son justamente los que la forma de esta fuga usa, porque lo que un
 * oyente de `pagehide` hace es GUARDAR algo, no contarlo. Taparlo del todo
 * pedia mover el enganche de los espias a un sitio donde un spec no pueda
 * restaurarlo, que es un cambio de otro tamaño y de otra tarea.
 *
 * ---------------------------------------------------------------------------
 * POR QUE DESPACHAR Y NO PROHIBIR.
 *
 * Se podria gritar «nadie puede escuchar `pagehide`», pero seria una regla
 * sobre COMO se escribe el codigo bueno y no sobre si se filtra algo: guardar
 * el estado de un formulario al salir es legitimo —la plataforma lo
 * recomienda— y un canal que lo prohiba es de los que alguien desactiva el dia
 * que lo necesita. Es el criterio con el que `rato-libre.ts` decidio MONTAR
 * `requestIdleCallback` en vez de prohibirlo, y con el que
 * `espia-de-consola.ts` decidio NO vigilar el portapapeles. Despachando, el
 * que lo use bien no nota nada y el que esconda una fuga detras la paga: lo
 * que el oyente escriba lo ven los dieciocho tapones solos, sin que ninguno tenga
 * que saber que esto existe.
 */

/**
 * EL PROTOTIPO DEL DOCUMENTO, SACADO DEL OBJETO Y NO DE LA CLASE GLOBAL.
 *
 * Por la leccion que en este repo ya mordio tres veces —`performance` y su
 * `Performance`, `window.postMessage` y su `Window`, el `BroadcastChannel` de
 * la sonda—: el global de una API y su clase pueden ser dos cosas distintas en
 * el entorno de Vitest. AQUI, MEDIDO, resultan ser la misma:
 * `Object.getPrototypeOf(document) === Document.prototype` es `true` y
 * `Document` global es el constructor del prototipo. Se saca igual del objeto,
 * que es lo que no depende de que siga siendo cierto.
 *
 * Y lo otro que se midio, que es lo que hace esto posible: `visibilityState`
 * NO es una propiedad propia de `document` sino un ACCESOR del prototipo
 * —descriptor con `get`, sin `value`— y es `configurable: true`, asi que se
 * puede redefinir y devolver. `hidden` es otro accesor al lado, y se tapa
 * tambien: una pantalla que pregunte `document.hidden` es tan probable como
 * una que lea `visibilityState`, y dejar los dos diciendo cosas distintas
 * seria describir un navegador que no existe.
 *
 * Los dos descriptores se leen UNA VEZ al cargar el modulo, antes de redefinir
 * nada: leerlos desde dentro de la funcion, despues de un despacho, devolveria
 * el accesor de mentira y la pestaña se quedaria oculta para siempre.
 */
const PROTOTIPO_DEL_DOCUMENTO = Object.getPrototypeOf(document) as Document;

const VISIBILIDAD_ORIGINAL = Object.getOwnPropertyDescriptor(
  PROTOTIPO_DEL_DOCUMENTO,
  'visibilityState',
);

const OCULTA_ORIGINAL = Object.getOwnPropertyDescriptor(PROTOTIPO_DEL_DOCUMENTO, 'hidden');

/** Devuelve un accesor del prototipo del documento a como estaba al cargar. */
function devolverElAccesor(nombre: string, original: PropertyDescriptor | undefined): void {
  if (original === undefined) {
    Reflect.deleteProperty(PROTOTIPO_DEL_DOCUMENTO, nombre);
    return;
  }

  Object.defineProperty(PROTOTIPO_DEL_DOCUMENTO, nombre, original);
}

/**
 * Corre algo con la pestaña ESCONDIDA, y la devuelve a visible pase lo que pase.
 *
 * El `finally` no es cortesia: un oyente que explote durante el despacho
 * dejaria `document.visibilityState` en `'hidden'` para TODOS los tests que
 * vengan detras en el mismo archivo, y el informe acusaria al inocente. Es la
 * misma regla que el tapon aplica con los almacenes, con `window.name` y con
 * la URL —se deja el mundo como estaba antes de seguir—, escrita aqui porque
 * aqui lo que se ensucia es un accesor y no un valor.
 */
function conLaPestanaOculta(hacer: () => void): void {
  Object.defineProperty(PROTOTIPO_DEL_DOCUMENTO, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  });

  Object.defineProperty(PROTOTIPO_DEL_DOCUMENTO, 'hidden', {
    configurable: true,
    get: () => true,
  });

  try {
    hacer();
  } finally {
    devolverElAccesor('visibilityState', VISIBILIDAD_ORIGINAL);
    devolverElAccesor('hidden', OCULTA_ORIGINAL);
  }
}

/**
 * `pagehide` NO ES UN `Event` PELADO, Y LA DIFERENCIA SE PUEDE LEER.
 *
 * El navegador manda un `PageTransitionEvent` con `persisted`, que dice si la
 * pagina se va a la cache de atras-adelante o se destruye. Es un dato que el
 * codigo de verdad LEE —`if (!evento.persisted) guardar()` es la forma de
 * manual—, y con un `Event` pelado valdria `undefined`, que no es ni una cosa
 * ni la otra. Se manda `false`, que es lo que vale cuando la pestaña se cierra
 * de verdad: el caso que esta fuga aprovecha.
 *
 * Medido: `PageTransitionEvent` SI existe en jsdom 26. Se pregunta igual, para
 * que el dia que no este esto siga despachando algo en vez de reventar el
 * `afterEach` de los 69 archivos.
 */
function despacharElPagehide(): void {
  const Transicion = (globalThis as unknown as { PageTransitionEvent?: typeof PageTransitionEvent })
    .PageTransitionEvent;

  const evento =
    typeof Transicion === 'function'
      ? new Transicion('pagehide', { persisted: false })
      : new Event('pagehide');

  window.dispatchEvent(evento);
}

/**
 * Los dos eventos que el ciclo de vida manda AL DOCUMENTO, y no a la ventana.
 *
 * Van con `bubbles` para que tambien los oiga quien se registro en `window`.
 * Es fiel en `visibilitychange` —la plataforma lo burbujea— y es una licencia
 * deliberada en `freeze`, que se dispara en el documento sin burbujear: sin
 * ella, un `window.addEventListener('freeze', …)` —la forma que escribe
 * cualquiera por simetria con `pagehide`— no se oiria aqui y si en el
 * navegador, que es exactamente el agujero que este archivo existe para
 * cerrar.
 */
function despacharEnElDocumento(tipo: string): void {
  document.dispatchEvent(new Event(tipo, { bubbles: true }));
}

/**
 * Despacha los cinco eventos de salida, en el orden del navegador.
 *
 * Se llama como PRIMERA linea del `afterEach` de `vigilarLosCanalesDeSalida`,
 * antes de que el tapon lea nada y antes de su `cleanup()`. El porque de cada
 * una de las dos cosas esta arriba.
 */
export function despacharLaSalidaDeLaPestana(): void {
  // Cancelable porque lo es de verdad: es la unica de las cinco puertas que la
  // persona puede cerrar. `clave-temporal.tsx` ya la escucha para frenar un F5
  // con una contraseña en pantalla, y lo unico que hace su oyente es
  // `preventDefault()`: nadie mira aqui si se cancelo, asi que despacharla en
  // los 69 archivos no le cambia nada a esa pantalla. Medido con el paquete
  // entero.
  window.dispatchEvent(new Event('beforeunload', { cancelable: true }));

  conLaPestanaOculta(() => {
    despacharEnElDocumento('visibilitychange');
    despacharEnElDocumento('freeze');
    despacharElPagehide();
    window.dispatchEvent(new Event('unload'));
  });
}
