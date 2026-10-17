import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { vigilarLosCanalesDeSalida } from './src/test/espia-de-consola';
import { montarElRatoLibre } from './src/test/rato-libre';

/**
 * La limpieza del DOM entre tests NO es automatica con Vitest.
 *
 * Testing Library la engancha sola cuando el runner expone `afterEach` como
 * global (el modo `globals: true`). Aqui los tests importan `describe`, `it` y
 * `expect` explicitamente, asi que hay que registrarla a mano.
 *
 * Sin esto, cada `render` acumula nodos y los tests empiezan a fallar con
 * "Found multiple elements with the role ..." — un sintoma que apunta al test
 * equivocado, porque el que falla es el segundo y el culpable es el primero.
 *
 * ESTE `cleanup()` YA NO ES EL QUE DESMONTA EN EL CAMINO NORMAL. Lo hace el
 * tapon de abajo, que corre ANTES que este —Vitest invierte el orden de
 * registro— y que necesita desmontar el mismo: si una de sus afirmaciones
 * lanza, Vitest aborta la cadena y esta linea no llega a correr nunca. Se deja
 * igualmente porque `cleanup()` es idempotente y cubre el caso de que el tapon
 * no corra. Ver el comentario largo dentro de `vigilarLosCanalesDeSalida`.
 */
afterEach(() => {
  cleanup();
});

/**
 * EL TAPON DE LOS DIEZ CANALES QUE NO SON EL `<body>`, EN TODOS LOS SPECS.
 *
 * `console.*`, `document.title`, `window.name`, el `<head>`, los tres
 * almacenes del navegador, el buffer de User Timing, el `src` de una imagen y
 * las salidas laterales —`window.postMessage`, `BroadcastChannel` y
 * `navigator.sendBeacon`—, el almacen de respuestas del navegador
 * (`CacheStorage`), que es un cuarto almacen y sobrevive al cierre de sesion, y
 * el SERVICE WORKER —`navigator.serviceWorker.controller.postMessage`—, que en
 * este producto esta instalado de verdad y sobrevive a la pestaña.
 * La lista entera, con que se midio en cada caso, esta en el docblock de
 * `vigilarLosCanalesDeSalida`. Va aqui y no en cada spec
 * porque es una DIMENSION, no un caso: ninguna pantalla deberia tener que
 * acordarse de pedirlo para que se le audite lo que publica fuera del marcado,
 * y la que no se acuerde es justamente la que lo va a necesitar.
 *
 * Vigila los secretos del panel siempre, y lo que cada spec agregue con
 * `vigilarEstosDatos`. Ver el comentario de `vigilarLosCanalesDeSalida`.
 */
vigilarLosCanalesDeSalida();

/**
 * Y EL UNDECIMO EJE, QUE NO ES UN CANAL SINO UN RELOJ.
 *
 * jsdom no implementa `requestIdleCallback`, asi que un
 * `window.requestIdleCallback?.(() => …)` es un no-op silencioso en los tests
 * y una ejecucion de verdad en el navegador: todo lo que se esconda detras
 * ocurre DESPUES de que corran los diez tapones de arriba, o sea nunca. No
 * abre una puerta nueva — las apaga TODAS, incluidas las que se tapen mañana.
 * Medido en la pantalla de quien no pago: el mismo `console.info` tira 28
 * tests de 28 desnudo y pasa los 28 envuelto.
 *
 * Se monta la API en vez de prohibirla —aplazar trabajo caro es legitimo— para
 * que lo aplazado CORRA dentro del test y los diez tapones lo vean solos. El
 * razonamiento entero y las tres decisiones pequeñas: `src/test/rato-libre.ts`.
 */
montarElRatoLibre();
