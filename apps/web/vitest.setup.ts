import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { vigilarElTitulo } from './src/test/espia-de-consola';

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
 */
afterEach(() => {
  cleanup();
});

/**
 * El tapon del titulo de la pagina, en TODOS los specs.
 *
 * Va aqui y no en cada spec porque es una dimension, no un caso: ninguna
 * pantalla deberia tener que acordarse de pedirlo para que se le audite lo que
 * publica en `document.title`. Ver el comentario de `vigilarElTitulo`.
 */
vigilarElTitulo();
