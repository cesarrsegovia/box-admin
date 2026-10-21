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
 * EL TAPON DE LOS TRECE CANALES QUE NO SON EL `<body>`, EN TODOS LOS SPECS —Y
 * EL EJE DECIMOQUINTO, QUE VIAJA DENTRO DE EL.
 *
 * `console.*`, `document.title`, `window.name`, el `<head>`, los tres
 * almacenes del navegador, el buffer de User Timing, el `src` de una imagen y
 * las salidas laterales —`window.postMessage`, `BroadcastChannel` y
 * `navigator.sendBeacon`—, el almacen de respuestas del navegador
 * (`CacheStorage`), que es un cuarto almacen y sobrevive al cierre de sesion,
 * el SERVICE WORKER —`navigator.serviceWorker.controller.postMessage`—, que en
 * este producto esta instalado de verdad y sobrevive a la pestaña, e
 * INDEXEDDB, que es el QUINTO almacen: sobrevive al logout y al reinicio como
 * `localStorage`, no tiene tope de 5 MB y guarda el objeto entero sin que
 * nadie tenga que serializarlo. Y LOS ATRIBUTOS DEL `<html>` Y DEL `<body>`:
 * los dos elementos que envuelven al cuerpo, que los tests de pantalla no
 * miran —miran lo que hay DENTRO del `<body>`— y que `cleanup()` no desmonta,
 * asi que lo que una pantalla escriba ahi sobrevive a su propio test. A
 * diferencia de los cinco canales anteriores, jsdom los implementa ENTEROS:
 * no hay ningun `?.` que delate la fuga, la linea corre igual en el test y en
 * el navegador. Y LA URL DEL DOCUMENTO: `location` y las cinco puertas de la
 * History API, que son el HUECO ENTRE LAS DOS DEFENSAS de este repo —los otros
 * doce canales miran todo lo que no es el `<body>`, los tests de pantalla
 * miran el `<body>` y la lista de peticiones, y `location` no cae en ninguno
 * de los dos lados—. Es el unico canal que SE COPIA SOLO: entra en el
 * historial en disco, se pega entero cuando alguien comparte el enlace y viaja
 * como `Referer` a terceros, sin dejar rastro en la pestaña de red ni en el
 * marcado. `cleanup()` tampoco lo toca.
 * La lista entera, con que se midio en cada caso, esta en el docblock de
 * `vigilarLosCanalesDeSalida`. Va aqui y no en cada spec
 * porque es una DIMENSION, no un caso: ninguna pantalla deberia tener que
 * acordarse de pedirlo para que se le audite lo que publica fuera del marcado,
 * y la que no se acuerde es justamente la que lo va a necesitar.
 *
 * Vigila los secretos del panel siempre, y lo que cada spec agregue con
 * `vigilarEstosDatos`. Ver el comentario de `vigilarLosCanalesDeSalida`.
 *
 * Y DENTRO DE EL VIAJA EL EJE DECIMOQUINTO, que no se llama desde aqui a
 * proposito. jsdom no dispara NUNCA `beforeunload`, `visibilitychange`,
 * `pagehide`, `unload` ni `freeze`: un oyente que una pantalla registre en un
 * `useEffect` para guardar algo al salir —«que no se pierda lo tecleado si se
 * cierra la pestaña»— vive y muere sin que nadie le hable, y la linea que en
 * el mostrador escribe la clave del servidor de correo en `localStorage` no
 * corre ni una vez en los 1561 tests. Los cinco se despachan como PRIMERA
 * linea del `afterEach` del tapon de arriba, y tiene que ser ahi y no en un
 * `afterEach` suelto de este archivo: el oyente se quita en la limpieza del
 * `useEffect`, o sea que despues del `cleanup()` ya no escucha nadie —medido:
 * un golpe antes, cero despues—. El razonamiento entero, el orden de los cinco
 * y lo que cuesta: `src/test/salida-de-la-pestana.ts`.
 */
vigilarLosCanalesDeSalida();

/**
 * Y EL EJE DECIMOCUARTO, QUE NO ES UN CANAL SINO UN RELOJ.
 *
 * (El decimoquinto —los eventos de salida de la pestaña— es el otro eje, y se
 * engancha dentro del tapon de arriba porque su sitio exacto depende del
 * `cleanup()`. Ver el comentario de ahi.)
 *
 * jsdom no implementa `requestIdleCallback`, asi que un
 * `window.requestIdleCallback?.(() => …)` es un no-op silencioso en los tests
 * y una ejecucion de verdad en el navegador: todo lo que se esconda detras
 * ocurre DESPUES de que corran los trece tapones de arriba, o sea nunca. No
 * abre una puerta nueva — las apaga TODAS, incluidas las que se tapen mañana.
 * Medido en la pantalla de quien no pago: el mismo `console.info` tira 28
 * tests de 28 desnudo y pasa los 28 envuelto.
 *
 * Se monta la API en vez de prohibirla —aplazar trabajo caro es legitimo— para
 * que lo aplazado CORRA dentro del test y los trece tapones lo vean solos. El
 * razonamiento entero y las tres decisiones pequeñas: `src/test/rato-libre.ts`.
 */
montarElRatoLibre();
