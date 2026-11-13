import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  escrituraDelPortapapeles,
  formaQueSeFue,
  portapapelesDeMentira,
  reclamarLoCopiado,
  SECRETOS_DEL_PANEL,
} from './espia-de-consola';

/**
 * EL GUARDIAN DEL VIGESIMO PRIMER CANAL, Y POR QUE TIENE SPEC.
 *
 * Por lo mismo que `objetos-con-url.spec.ts`: **ESTO NO SE VE DESDE FUERA**.
 * Solo dos pantallas copian, y las dos a proposito. Si alguien:
 *
 *  - deja de montar el doble en el `beforeEach`, la forma prudente
 *    —`navigator.clipboard?.writeText(…)`— vuelve a no hacer nada;
 *  - le quita el simbolo de user-event, y el primer `userEvent.setup()` del
 *    test lo pisa: el canal queda ciego en los 31 specs que lo llaman —es lo
 *    que paso con los dobles de los specs, medido—;
 *  - o hace que reclamar marque tambien lo que se copie DESPUES,
 *
 * LOS TESTS DEL PAQUETE SIGUEN EN VERDE y el canal se queda ciego. Este
 * archivo mide las tres.
 *
 * El tapon de verdad se mira solo en lo que no es una fuga: que el doble esta,
 * que sobrevive a `setup()` y que copiar Y RECLAMAR en el mismo test pasa el
 * `afterEach`. Lo que pondria rojo el test se mide contra un doble propio, que
 * no esta enchufado a nada.
 *
 * EL DATO ES `claveDelReset`, un secreto del panel, como en los otros
 * guardianes. Y SE AFIRMA SOBRE BOOLEANOS: un `toContain(valor)` imprimiria el
 * secreto en el informe de CI.
 */

const CENTINELA = SECRETOS_DEL_PANEL.claveDelReset;

/** Si lo copiado lleva el centinela, en cualquiera de sus formas. */
function llevaElCentinela(textos: string[]): boolean {
  return formaQueSeFue(textos.join(' '), CENTINELA) !== undefined;
}

describe('el tapon de verdad', () => {
  it('el portapapeles existe en cada test, aunque jsdom no lo traiga', () => {
    expect(typeof navigator.clipboard?.writeText).toBe('function');
  });

  it('copiar y reclamar en el mismo test NO es una fuga', async () => {
    // Es la copia que se pide. Si reclamar no marcara nada, este test caeria
    // en el `afterEach` del espia con el centinela dentro.
    await navigator.clipboard.writeText(CENTINELA);

    expect(llevaElCentinela(reclamarLoCopiado())).toBe(true);
  });

  /**
   * LA MEDIDA QUE DECIDE SI ESTE CANAL SIRVE.
   *
   * `setup()` pisa `navigator.clipboard` con su propio doble salvo que el que
   * haya ya lleve su simbolo. Sin el simbolo, esto registra CERO escrituras y
   * el canal esta ciego en todos los specs que usan user-event.
   */
  it('un userEvent.setup() deja el doble en su sitio, y lo copiado despues se ve', async () => {
    const antes = navigator.clipboard;
    userEvent.setup();

    expect(navigator.clipboard).toBe(antes);

    await navigator.clipboard.writeText('despues del setup');

    expect(reclamarLoCopiado()).toEqual(['despues del setup']);
  });

  it('y tambien con writeToClipboard: false, que no cambia quien pone el doble', async () => {
    const antes = navigator.clipboard;
    userEvent.setup({ writeToClipboard: false });

    expect(navigator.clipboard).toBe(antes);

    await navigator.clipboard.writeText('sin escribir al portapapeles');

    expect(reclamarLoCopiado()).toEqual(['sin escribir al portapapeles']);
  });

  it('una escritura que el spec hace fallar rechaza, y no cuenta como copiada', async () => {
    escrituraDelPortapapeles().mockRejectedValueOnce(new Error('sin permiso'));

    await expect(navigator.clipboard.writeText(CENTINELA)).rejects.toThrow('sin permiso');

    expect(reclamarLoCopiado()).toEqual([]);
  });
});

describe('el doble', () => {
  it('una copia con un centinela, sin reclamar, queda a la vista del tapon', async () => {
    const portapapeles = portapapelesDeMentira();
    await (portapapeles.doble as Clipboard).writeText(`{"clave":"${CENTINELA}"}`);

    expect(llevaElCentinela(portapapeles.sinReclamar())).toBe(true);
  });

  it('la misma copia, reclamada, ya no', async () => {
    const portapapeles = portapapelesDeMentira();
    await (portapapeles.doble as Clipboard).writeText(CENTINELA);

    expect(llevaElCentinela(portapapeles.reclamar())).toBe(true);
    expect(portapapeles.sinReclamar()).toEqual([]);
  });

  it('una copia sin centinela queda registrada, pero no lleva nada vigilado', async () => {
    const portapapeles = portapapelesDeMentira();
    await (portapapeles.doble as Clipboard).writeText('Promo verano');

    expect(portapapeles.sinReclamar()).toEqual(['Promo verano']);
    expect(llevaElCentinela(portapapeles.sinReclamar())).toBe(false);
  });

  /**
   * UN `mockImplementation` QUE LANZA EN EL ACTO, y no con una promesa
   * rechazada, tambien es un fallo de la escritura. Sin envolver la llamada,
   * el `throw` salia de `writeText` antes del `.catch()` y la copia se quedaba
   * en el registro como si hubiera llegado al portapapeles.
   */
  it('una escritura que lanza en el acto rechaza, y tampoco cuenta como copiada', async () => {
    const portapapeles = portapapelesDeMentira();
    portapapeles.escritura.mockImplementationOnce(() => {
      throw new Error('sin permiso');
    });

    await expect((portapapeles.doble as Clipboard).writeText('lo que no llego')).rejects.toThrow(
      'sin permiso',
    );

    expect(portapapeles.sinReclamar()).toEqual([]);
  });

  it('lo que se copia DESPUES de un reclamo sigue sin reclamar', async () => {
    const portapapeles = portapapelesDeMentira();
    await (portapapeles.doble as Clipboard).writeText('lo pedido');
    portapapeles.reclamar();
    await (portapapeles.doble as Clipboard).writeText(CENTINELA);

    expect(llevaElCentinela(portapapeles.sinReclamar())).toBe(true);
  });
});
