import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { vigilarLosCanalesDeSalida } from './src/test/espia-de-consola';

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
 * EL TAPON DE LOS TRES CANALES QUE NO SON EL DOM, EN TODOS LOS SPECS.
 *
 * `console.*`, `document.title` y `window.name`. Va aqui y no en cada spec
 * porque es una DIMENSION, no un caso: ninguna pantalla deberia tener que
 * acordarse de pedirlo para que se le audite lo que publica fuera del marcado,
 * y la que no se acuerde es justamente la que lo va a necesitar.
 *
 * Vigila los secretos del panel siempre, y lo que cada spec agregue con
 * `vigilarEstosDatos`. Ver el comentario de `vigilarLosCanalesDeSalida`.
 */
vigilarLosCanalesDeSalida();
