import { describe, expect, it, vi } from 'vitest';

/**
 * EL GUARDIAN DEL DECIMO EJE.
 *
 * `vitest.setup.ts` monta `requestIdleCallback` para todo el paquete, y ese
 * montaje es lo unico que impide que un `window.requestIdleCallback?.(() =>
 * …)` esconda una fuga de los NUEVE tapones a la vez: en jsdom pelado esa
 * llamada es un no-op silencioso y la fuga solo ocurre en el navegador.
 *
 * Sin este archivo, borrar la linea de `vitest.setup.ts` no romperia nada: el
 * agujero volveria a abrirse entero y todos los tests del paquete seguirian
 * verdes. Es exactamente el modo de fallo que el tapon existe para evitar,
 * aplicado al tapon mismo.
 *
 * NO se importa `montarElRatoLibre` aqui para llamarla: se mira el GLOBAL, que
 * es lo que ve el codigo de produccion. Importar la funcion y ejecutarla
 * probaria que la funcion funciona, no que este puesta — y lo que se puede
 * perder es lo segundo.
 */
describe('el rato libre del navegador, montado para todo el paquete', () => {
  it('`requestIdleCallback` existe, aunque jsdom no lo traiga', () => {
    expect(typeof window.requestIdleCallback).toBe('function');
    expect(typeof window.cancelIdleCallback).toBe('function');
  });

  it('lo que se aplaza al rato libre CORRE dentro del test', async () => {
    // Es la mitad que importa. Un `requestIdleCallback` montado que no
    // ejecutara nunca el callback pasaria el test de arriba y dejaria el
    // agujero igual de abierto: la fuga seguiria sin ocurrir en los tests y si
    // en el navegador.
    const corrio = vi.fn();

    window.requestIdleCallback(corrio);
    expect(corrio).not.toHaveBeenCalled();

    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(corrio).toHaveBeenCalledTimes(1);
  });

  it('el callback recibe un plazo con presupuesto, no con cero', async () => {
    // Con `timeRemaining() === 0`, el codigo bien escrito —el que pregunta
    // antes de ponerse a trabajar— se saltaria el trabajo, y volveriamos a no
    // ver nada de lo que se aplazo.
    let restante = -1;

    window.requestIdleCallback((plazo) => {
      restante = plazo.timeRemaining();
    });

    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(restante).toBeGreaterThan(0);
  });

  it('`cancelIdleCallback` cancela de verdad', async () => {
    const corrio = vi.fn();

    window.cancelIdleCallback(window.requestIdleCallback(corrio));

    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(corrio).not.toHaveBeenCalled();
  });

  it('cancelar uno no cancela los otros', async () => {
    const elBueno = vi.fn();
    const elCancelado = vi.fn();

    window.requestIdleCallback(elBueno);
    window.cancelIdleCallback(window.requestIdleCallback(elCancelado));

    await new Promise((resolver) => setTimeout(resolver, 0));

    expect(elBueno).toHaveBeenCalledTimes(1);
    expect(elCancelado).not.toHaveBeenCalled();
  });

  /**
   * CON LOS RELOJES FALSOS PUESTOS LO APLAZADO SIGUE CORRIENDO, Y ESO ES LO
   * UNICO QUE HAY QUE FIJAR.
   *
   * Montar `requestIdleCallback` en el global tuvo una consecuencia que el
   * guardian de `relojes-falsos.spec.ts` canto en cuanto se monto: sinon arma
   * su lista mirando el global DE VERDAD, asi que desde que existe, un
   * `vi.useFakeTimers()` desnudo lo falsea —y por eso esta ahora en
   * `RELOJES_FALSOS`—. O sea que dentro de un test con los relojes congelados,
   * el que atiende la llamada ya no es el tapon de `rato-libre.ts` sino el
   * doble de sinon.
   *
   * NO SE AFIRMA SOBRE QUIEN LO ATIENDE, porque eso ataria el test a un
   * detalle de sinon que puede cambiar de version. Se afirma la PROPIEDAD que
   * importa, que es la misma con los dos: lo que se aplaza al rato libre
   * ACABA CORRIENDO dentro del test, asi que no hay sitio donde esconder una
   * fuga de los nueve tapones ni con los relojes de verdad ni con los falsos.
   */
  it('con los relojes falsos puestos, lo aplazado corre al adelantar el reloj', () => {
    vi.useFakeTimers();

    try {
      const corrio = vi.fn();

      window.requestIdleCallback(corrio);
      expect(corrio).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);

      expect(corrio).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
