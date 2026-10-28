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
 * EL TAPON DE LOS DIECIOCHO CANALES QUE NO MIRA NADIE, EN TODOS LOS SPECS —Y
 * EL EJE DECIMONOVENO, QUE VIAJA DENTRO DE EL.
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
 * nadie tenga que serializarlo. Y EL `<html>` Y EL `<body>` —SUS ATRIBUTOS, Y
 * LO QUE CUELGA DEL `<html>` FUERA DEL `<head>` Y DEL `<body>`—:
 * los dos elementos que envuelven al cuerpo, que los tests de pantalla no
 * miran —miran lo que hay DENTRO del `<body>`— y que `cleanup()` no desmonta,
 * asi que lo que una pantalla escriba ahi sobrevive a su propio test. A
 * diferencia de los cinco canales anteriores, jsdom los implementa ENTEROS:
 * no hay ningun `?.` que delate la fuga, la linea corre igual en el test y en
 * el navegador. La segunda mitad —el nodo colgado— se agrego en la Fase 14 y
 * cae en el hueco entre TRES defensas: el canal del `<head>` mira los hijos
 * del `<head>`, este miraba los ATRIBUTOS y no los hijos, y los tests de
 * pantalla miran lo de DENTRO del `<body>`. Medido: un
 * `document.documentElement.append(marca)` con el catalogo entero en el texto
 * paso los 1841 tests. Y LA URL DEL DOCUMENTO: `location` y las cinco puertas de la
 * History API, que son el HUECO ENTRE LAS DOS DEFENSAS de este repo —los otros
 * doce canales miran todo lo que no es el `<body>`, los tests de pantalla
 * miran el `<body>` y la lista de peticiones, y `location` no cae en ninguno
 * de los dos lados—. Es el unico canal que SE COPIA SOLO: entra en el
 * historial en disco, se pega entero cuando alguien comparte el enlace y viaja
 * como `Referer` a terceros, sin dejar rastro en la pestaña de red ni en el
 * marcado. `cleanup()` tampoco lo toca. Y LA RED POR FUERA DE `pedir`:
 * `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker` y
 * `SharedWorker` —estas dos ultimas porque un `fetch` hecho DENTRO de un
 * worker no pasa por el `fetch` que este canal dobla: el hilo tiene su propio
 * global, asi que levantar uno es la forma de apagar la puerta principal—. Es
 * la defensa que los
 * otros canales daban por supuesta —«no es un `fetch`, asi que el test de no
 * habla con la red por fuera de `pedir` pasa en verde»— y que vivia A MANO en
 * tres specs de setenta y cuatro: en los otros setenta y uno un `fetch` a pelo
 * con la lista entera de una clase dentro no lo veia nadie. Lo que se
 * distingue no es que haya habido un `fetch` —`pedir` usa `fetch` por dentro—
 * sino si la llamada salio de dentro de `pedir`, leyendo la pila. Y LO QUE EL
 * MARCADO DEL `<body>` NO SERIALIZA: el `.value` de un control —que para los
 * tipos en modo valor y para un `<textarea>` es una PROPIEDAD que no se
 * refleja a ningun atributo— y el contenido de un `shadowRoot` abierto. Es el
 * UNICO de los dieciocho que vive DENTRO del cuerpo, o sea del lado que los tests
 * de pantalla miran, y aun asi no lo ve ninguno: leen `innerHTML` y
 * `textContent`, y ahi eso no sale. El dato esta en la pagina igual: se pinta,
 * se autocompleta, viaja en un envio de formulario y lo lee cualquier
 * extension del navegador del mostrador. Se afirma por centinelas Y CON UNA
 * RESTA —solo cuenta el que no este tambien en el marcado— porque media docena
 * de pantallas pintan `<input value={nombre}>` a proposito: lo que se afirma
 * no es «no hay centinelas» sino «no hay ninguno ESCONDIDO».
 * Y EL DISCO PRIVADO DEL ORIGEN —OPFS, `navigator.storage.getDirectory()`—,
 * que es el SEXTO almacen y el unico que es un SISTEMA DE ARCHIVOS: sobrevive
 * al logout y al reinicio como `localStorage`, no tiene el tope de 5 MB,
 * guarda bytes sin que nadie serialice y NO APARECE en la pestaña
 * «Application», donde los otros cinco almacenes se ven de un vistazo. Los
 * cinco tapones de almacen no lo podian ver porque cada uno lee SU PROPIA API
 * y ninguno sabe que existe un sistema de archivos. Medido: un respaldo del
 * cobro en disco, con el `?.` prudente, sobrevivio los 1721 tests — y el mismo
 * dato por `localStorage.setItem` tira 7. Se vigilan todas las puertas del
 * arbol, EL NOMBRE del archivo ademas del contenido, y las cuatro formas en
 * que `write` acepta ese contenido.
 * Y EL CENTRO DE NOTIFICACIONES DEL SISTEMA OPERATIVO —`new Notification` y
 * `ServiceWorkerRegistration.showNotification`—, que es EL UNICO DE LOS
 * DIECIOCHO QUE NO ACABA DENTRO DEL NAVEGADOR: el dato sale a una pantalla
 * del sistema, se lee sin tocar nada desde delante del mostrador, sobrevive a
 * la pestaña, al logout Y AL CIERRE DEL NAVEGADOR, y en Windows queda en el
 * historial de notificaciones, que no vacia ningun «borrar datos del sitio».
 * Medido: un aviso de «Cobro registrado» con el nombre, el monto, el metodo y
 * la nota en el `body` y el `perfilId` en el `tag` sobrevivio los 1761 tests —y
 * la misma terna por `console.info` tira 7 de 26—. Pasa porque `typeof
 * Notification` es `'undefined'` en jsdom, y aqui ese `typeof` NO ES OPCIONAL
 * —`Notification` es un binding global—, asi que el codigo bien escrito es
 * justo el que pasa en verde. Y lo que lo hace grave es que ESTE PRODUCTO YA
 * PIDIO EL PERMISO: `boton-de-push.tsx` llama a `requestPermission()`, asi que
 * en el mostrador `permission === 'granted'` es verdad. Se vigilan las dos
 * puertas y TODOS los campos con texto —el titulo y cada clave de las
 * opciones, sin lista blanca: `body`, `tag`, el `data` libre y tambien `icon`,
 * `badge` e `image`, que son URLs y una URL lleva dato igual que un cuerpo—.
 * Y LOS OBJETOS PUBLICADOS CON URL —`URL.createObjectURL`—, que es el
 * VIGESIMO y no el decimoctavo porque esos dos numeros ya eran los ejes: el
 * almacen de blobs del documento, que en una aplicacion de una sola pagina
 * sobrevive al logout y que `chrome://blob-internals` enseña entero. Medido en
 * la Fase 14: un enlace «Descargar» con el CSV de la liquidacion de una
 * profesora, armado en el render y sin revocar, paso los 1874 tests.
 * La lista entera, con que se midio en cada caso, esta en el docblock de
 * `vigilarLosCanalesDeSalida`. Va aqui y no en cada spec
 * porque es una DIMENSION, no un caso: ninguna pantalla deberia tener que
 * acordarse de pedirlo para que se le audite lo que publica fuera del marcado,
 * y la que no se acuerde es justamente la que lo va a necesitar.
 *
 * Vigila los secretos del panel siempre, y lo que cada spec agregue con
 * `vigilarEstosDatos`. Ver el comentario de `vigilarLosCanalesDeSalida`.
 *
 * Y DENTRO DE EL VIAJA EL EJE DECIMONOVENO, que no se llama desde aqui a
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
 * Y EL EJE DECIMOCTAVO, QUE NO ES UN CANAL SINO UN RELOJ.
 *
 * (El decimonoveno —los eventos de salida de la pestaña— es el otro eje, y se
 * engancha dentro del tapon de arriba porque su sitio exacto depende del
 * `cleanup()`. Ver el comentario de ahi.)
 *
 * jsdom no implementa `requestIdleCallback`, asi que un
 * `window.requestIdleCallback?.(() => …)` es un no-op silencioso en los tests
 * y una ejecucion de verdad en el navegador: todo lo que se esconda detras
 * ocurre DESPUES de que corran los dieciocho tapones de arriba, o sea nunca. No
 * abre una puerta nueva — las apaga TODAS, incluidas las que se tapen mañana.
 * Medido en la pantalla de quien no pago: el mismo `console.info` tira 28
 * tests de 28 desnudo y pasa los 28 envuelto.
 *
 * Se monta la API en vez de prohibirla —aplazar trabajo caro es legitimo— para
 * que lo aplazado CORRA dentro del test y los dieciocho tapones lo vean solos. El
 * razonamiento entero y las tres decisiones pequeñas: `src/test/rato-libre.ts`.
 */
montarElRatoLibre();
