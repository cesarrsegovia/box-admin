import { describe, expect, it } from 'vitest';
import { almacenDeObjetosDeMentira, formaQueSeFue, SECRETOS_DEL_PANEL } from './espia-de-consola';

/**
 * EL GUARDIAN DEL VIGESIMO CANAL, Y POR QUE TIENE SPEC.
 *
 * Por lo mismo que `centro-de-notificaciones.spec.ts` y `disco-privado.spec.ts`:
 * **ESTO NO SE VE DESDE FUERA**. No hay un solo `createObjectURL` en
 * `apps/web/src`, asi que ningun spec de pantalla toca este canal nunca. Si
 * alguien:
 *
 *  - deja de definir la funcion en el `beforeEach` —o la define una vez y el
 *    `afterEach` la borra—, la forma prudente vuelve a no hacer nada;
 *  - hace que `revocar` vacie el almacen entero, y un `revokeObjectURL('')` de
 *    cortesia borra la fuga;
 *  - o deja de leer el contenido de un `Blob` —un `JSON.stringify` del objeto
 *    da `{}`— y el canal solo ve la forma fuerte,
 *
 * LOS TESTS DEL PAQUETE SIGUEN EN VERDE y el canal se queda ciego. Este
 * archivo mide las tres.
 *
 * El tapon de verdad se mira solo en lo que no es una fuga: que las dos
 * funciones existen, y que publicar Y REVOCAR en el mismo test pasa el
 * `afterEach`. El resto se mide contra un almacen propio, que no esta
 * enchufado a nada.
 *
 * EL DATO ES `claveDelReset`, un secreto del panel, por lo mismo que en los
 * otros guardianes: si alguna linea de aqui lo sacara por un canal, el espia lo
 * diria. Y SE AFIRMA SOBRE BOOLEANOS: un `toContain(valor)` imprimiria el
 * secreto en el informe de CI.
 */

const CENTINELA = SECRETOS_DEL_PANEL.claveDelReset;

/** Si lo publicado lleva el centinela, en cualquiera de sus formas. */
function llevaElCentinela(contenido: string): boolean {
  return formaQueSeFue(contenido, CENTINELA) !== undefined;
}

describe('el tapon de verdad', () => {
  it('las dos funciones existen en cada test, aunque jsdom no las traiga', () => {
    expect(typeof URL.createObjectURL).toBe('function');
    expect(typeof URL.revokeObjectURL).toBe('function');
  });

  it('publicar y revocar en el mismo test NO es una fuga', () => {
    // Es la descarga bien hecha. Si `revokeObjectURL` no quitara nada, este
    // test caeria en el `afterEach` del espia con el centinela dentro.
    const url = URL.createObjectURL(new Blob([CENTINELA], { type: 'text/csv' }));
    URL.revokeObjectURL(url);

    expect(url.startsWith('blob:')).toBe(true);
  });
});

describe('el almacen', () => {
  it('lee el contenido de un Blob, no su volcado', () => {
    const almacen = almacenDeObjetosDeMentira();
    almacen.crear(new Blob([CENTINELA], { type: 'text/csv' }));

    expect(almacen.vivos().map((uno) => llevaElCentinela(uno.contenido))).toEqual([true]);
  });

  it('y el de un File, que es un Blob con nombre', () => {
    const almacen = almacenDeObjetosDeMentira();
    almacen.crear(new File([CENTINELA], 'liquidacion.csv', { type: 'text/csv' }));

    expect(almacen.vivos().map((uno) => llevaElCentinela(uno.contenido))).toEqual([true]);
  });

  it('un Blob armado en trozos se lee entero', () => {
    // Las partes se concatenan dentro del Blob: partir el dato en el
    // constructor NO lo parte en lo publicado.
    const almacen = almacenDeObjetosDeMentira();
    almacen.crear(new Blob([CENTINELA.slice(0, 3), CENTINELA.slice(3)]));

    expect(almacen.vivos().map((uno) => llevaElCentinela(uno.contenido))).toEqual([true]);
  });

  it('cada publicacion tiene su URL, y revocar una deja la otra', () => {
    const almacen = almacenDeObjetosDeMentira();
    const primera = almacen.crear(new Blob(['nada']));
    almacen.crear(new Blob([CENTINELA]));

    almacen.revocar(primera);

    expect(almacen.vivos().map((uno) => llevaElCentinela(uno.contenido))).toEqual([true]);
  });

  it('revocar una URL que no es suya no borra nada', () => {
    const almacen = almacenDeObjetosDeMentira();
    almacen.crear(new Blob([CENTINELA]));

    almacen.revocar('');
    almacen.revocar('blob:http://otro.test/objeto-1');

    expect(almacen.vivos()).toHaveLength(1);
  });

  it('el tipo es lo que va al informe, y no lleva el contenido', () => {
    const almacen = almacenDeObjetosDeMentira();
    almacen.crear(new Blob([CENTINELA], { type: 'text/csv' }));
    almacen.crear(new File([CENTINELA], 'x.bin'));

    const tipos = almacen.vivos().map((uno) => uno.tipo);
    expect(tipos).toEqual(['text/csv', 'File']);
    expect(tipos.some(llevaElCentinela)).toBe(false);
  });
});
