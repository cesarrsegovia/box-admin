/**
 * EL EJE DECIMOCTAVO: `requestIdleCallback`, QUE NO ES UN CANAL SINO UN
 * RELOJ — Y QUE APAGA LOS DIECIOCHO DE UNA SOLA LINEA.
 *
 * Es EL PRIMERO DE LOS DOS EJES, no el unico: el decimonoveno
 * —`src/test/salida-de-la-pestana.ts`— cierra la otra forma de aplazar una
 * fuga a despues de los tapones, los eventos de salida de la pestaña, que
 * jsdom tampoco dispara nunca. Son parientes en la FORMA —los dos mueven la
 * salida a un hueco donde nadie mira— y distintos en el MECANISMO: alli la
 * respuesta fue MONTAR una API que falta, aqui DESPACHAR unos eventos que
 * nunca llegan. Montar el rato libre no cubre aquello, ni al reves.
 *
 * `espia-de-consola.ts` tapa dieciocho puertas por las que una pantalla puede
 * decir algo que no mira nadie: la consola, el titulo, `window.name`, el
 * `<head>`, los tres almacenes, el buffer de User Timing, el `src` de una
 * imagen, las tres salidas laterales, el almacen de respuestas, el service
 * worker, IndexedDB, el `<html>` y el `<body>` —sus atributos y lo que cuelga
 * del `<html>` fuera del `<head>` y del `<body>`—, la URL del
 * documento, la red por fuera de `pedir`, lo que el marcado del `<body>` no
 * serializa —el `.value` de un control y el contenido de un `shadowRoot`—, el
 * disco privado del origen (OPFS), que es el sexto almacen, y el CENTRO DE
 * NOTIFICACIONES DEL SISTEMA OPERATIVO —`new Notification` y
 * `showNotification`—, que es el unico de los dieciocho que no acaba dentro
 * del navegador.
 * Todas se
 * comprueban en un `afterEach`, o sea DESPUES de que el test haya corrido.
 *
 * Esto no abre una puerta nueva: mueve la salida A DESPUES DEL TEST. jsdom no
 * implementa `requestIdleCallback` —medido, y ya estaba anotado en
 * `relojes-falsos.ts`: por eso no aparece entre los relojes que sinon falsea—,
 * asi que `window.requestIdleCallback?.(...)` es un no-op silencioso en los
 * tests y una ejecucion de verdad en el navegador. MEDIDO en esta misma
 * pantalla, la de quien no pago:
 *
 *     console.info('[pagos-pendientes]', datos)      → caen 28 tests de 28
 *     window.requestIdleCallback?.(() => lo mismo)   → pasan 28 de 28
 *
 * Es el mismo mecanismo que dejo pasar en verde `navigator.sendBeacon?.()` y
 * `caches?.open()` antes de que se taparan, pero un escalon mas arriba: aquel
 * era UN canal sin vigilar, y este deja ciegos a TODOS los que ya se vigilan,
 * incluidos los que se tapen mañana. Un `?.` sobre una API que el entorno de
 * test no tiene es un sitio donde nadie mira POR CONSTRUCCION.
 *
 * ---------------------------------------------------------------------------
 * LA FORMA DE TAPARLO ES MONTAR LA API, NO PROHIBIRLA.
 *
 * Se podria doblar y gritar «nadie puede llamar a `requestIdleCallback`», pero
 * seria una regla sobre COMO se escribe el codigo bueno y no sobre si se
 * filtra algo: aplazar trabajo caro al rato libre del navegador es legitimo, y
 * un canal que obliga a escribir el codigo bueno de una forma concreta es el
 * que alguien desactiva. Es el criterio que `espia-de-consola.ts` ya aplico
 * para decidir que NO vigilar el portapapeles.
 *
 * Montandolo, en cambio, lo que se aplace CORRE —con los relojes de verdad
 * dentro del test— y entonces los dieciocho tapones lo ven, sin que ninguno tenga
 * que saber que esto existe. El que lo use legitimamente no nota nada; el que
 * esconda una fuga detras, la paga.
 *
 * ---------------------------------------------------------------------------
 * TRES DECISIONES PEQUEÑAS, DICHAS PARA QUE NO SE DESHAGAN POR DESCUIDO.
 *
 * 1. SE MONTA SIEMPRE, no solo «si falta». Con un `if (ya existe) return`, el
 *    dia que jsdom lo implemente a medias —o que otra herramienta lo monte sin
 *    ejecutarlo— este tapon se apartaria en silencio y nadie se enteraria. El
 *    comportamiento tiene que ser el mismo en todas las maquinas.
 *
 * 2. SE MONTA UNA VEZ, al cargar el `setupFiles`, y no en un `beforeEach`.
 *    `vi.restoreAllMocks()` no toca una asignacion al global, asi que no hace
 *    falta volver a engancharlo cada test —que es lo que si necesitan la
 *    consola y `performance`, porque aquello son espias—.
 *
 * 3. VA POR `setTimeout`, que es el unico aplazamiento que un test ya sabe
 *    esperar: los `esperar()` de este paquete son vueltas de
 *    `setTimeout(…, 0)`.
 *
 * ---------------------------------------------------------------------------
 * LO QUE MONTAR ESTO LE HIZO A LOS RELOJES FALSOS, QUE NO ERA OBVIO.
 *
 * Sinon arma la lista de lo que falsea MIRANDO EL GLOBAL DE VERDAD, asi que en
 * cuanto `requestIdleCallback` existe, un `vi.useFakeTimers()` desnudo lo
 * sustituye — y la regla de `RELOJES_FALSOS` («lo de Vitest menos
 * `performance`») obliga a nombrarlo alli. No hubo que deducirlo: el guardian
 * de `relojes-falsos.spec.ts` se puso rojo en el mismo momento en que esto se
 * monto. Dentro de un test con los relojes congelados, entonces, quien atiende
 * la llamada ya no es esta funcion sino el doble de sinon, y lo aplazado corre
 * al adelantar el reloj. La propiedad que importa se mantiene con los dos.
 *
 * Y UNA ASIMETRIA MEDIDA: sinon sustituye `requestIdleCallback` pero NO
 * `cancelIdleCallback`, al reves que las otras dos parejas. O sea que con los
 * relojes falsos puestos, cancelar no cancela: el `cancelIdleCallback` que
 * queda es este, y la manija que recibe es la del reloj de sinon. Para lo que
 * este tapon existe, eso cae del lado seguro —lo aplazado se VE igual—, y el
 * razonamiento entero esta al lado de la entrada de `RELOJES_FALSOS`.
 *
 * `timeRemaining()` devuelve un presupuesto distinto de cero a proposito: con
 * un cero, el codigo bien escrito —el que pregunta antes de trabajar— se
 * saltaria el trabajo y volveriamos a no ver nada.
 */

/** Lo que un `IdleDeadline` de verdad le promete al callback, en ms. */
const MILISEGUNDOS_DE_SOBRA = 50;

/**
 * Monta `requestIdleCallback` y `cancelIdleCallback` para todo el paquete.
 *
 * Se llama desde `vitest.setup.ts`, al lado del tapon de los dieciocho canales
 * —que lleva dentro el otro eje, el decimonoveno— y
 * por el mismo motivo: un agujero de canal no es de una pantalla, y la que no
 * se acuerde de pedirlo es justamente la que lo va a necesitar.
 */
export function montarElRatoLibre(): void {
  const enCurso = new Map<number, ReturnType<typeof setTimeout>>();
  let siguienteManija = 1;

  window.requestIdleCallback = (callback: IdleRequestCallback): number => {
    const manija = siguienteManija;
    siguienteManija += 1;

    enCurso.set(
      manija,
      setTimeout(() => {
        enCurso.delete(manija);
        callback({ didTimeout: false, timeRemaining: () => MILISEGUNDOS_DE_SOBRA });
      }, 0),
    );

    return manija;
  };

  window.cancelIdleCallback = (manija: number): void => {
    const temporizador = enCurso.get(manija);
    if (temporizador === undefined) return;

    clearTimeout(temporizador);
    enCurso.delete(manija);
  };
}
