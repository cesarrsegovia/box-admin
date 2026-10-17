/**
 * QUE RELOJES FALSEA `vi.useFakeTimers()` EN ESTE PAQUETE, Y POR QUE NO TODOS.
 *
 * Vitest no tiene una lista por defecto escrita en ninguna parte: cuando
 * `vi.useFakeTimers()` va DESNUDO —sin `toFake`—, el runner la calcula en ese
 * momento como «todos los relojes que sinon encuentre en el global, menos
 * `nextTick` y `queueMicrotask`». Esta en `vitest/dist/chunks/vi.*.js`, dentro
 * de `FakeTimers#useFakeTimers()`:
 *
 *     const toFake = Object.keys(this._fakeTimers.timers)
 *       .filter((timer) => timer !== 'nextTick' && timer !== 'queueMicrotask');
 *     ... toFake: this._userConfig?.toFake || toFake
 *
 * Y `timers` lo arma `@sinonjs/fake-timers` mirando el global DE VERDAD: mete
 * `setImmediate`, `hrtime`, `Intl`, `requestAnimationFrame`… solo si existen.
 * Por eso la lista NO es la de la documentacion de sinon ni la de ningun
 * ejemplo de internet: es la del entorno que tengamos montado (hoy jsdom 26
 * sobre Node 20, con Vitest 3.2.7).
 *
 * ESTA LISTA ES ESA, MENOS `performance`. MEDIDA, no copiada: se saco con una
 * sonda que fotografia la identidad de cada global antes y despues de un
 * `vi.useFakeTimers()` desnudo y mira cuales cambiaron. `nextTick` y
 * `queueMicrotask` los quita el propio Vitest.
 *
 * LA PRIMERA MEDIDA DIO ONCE MAS `performance`, Y HOY SON DOCE. En aquella,
 * `requestIdleCallback` no salia porque jsdom no lo implementa; desde que
 * `vitest.setup.ts` lo MONTA para todo el paquete —ver `rato-libre.ts`— sinon
 * si lo encuentra en el global y entra en el conjunto por defecto. Su pareja,
 * `cancelIdleCallback`, sigue sin entrar aunque exista: se midio, y el por que
 * importa esta al lado de la entrada de la lista.
 *
 * Es la demostracion de por que esta lista se MIDE y no se copia: lo que
 * falsea un `useFakeTimers()` depende del entorno montado, el entorno lo
 * movemos nosotros, y no se mueve por parejas. El guardian lo dijo en cuanto
 * se monto, antes de que nadie lo pensara.
 *
 * ---------------------------------------------------------------------------
 * POR QUE SE SACA `performance`, Y POR QUE SE SACA AQUI Y NO EN CADA SPEC.
 *
 * Falsear `performance` SUSTITUYE EL OBJETO ENTERO por el de sinon, que acepta
 * `mark()` y no guarda nada. Eso deja CIEGO al sexto canal del espia de
 * `espia-de-consola.ts` —el buffer de User Timing— mientras los relojes falsos
 * esten puestos: ni lo ve el espia, que quedo colgado del `performance` de
 * verdad, ni queda en el buffer, porque la marca nunca llego. Al volver a
 * `useRealTimers()` esta perdida para siempre. De esa rendija salio una
 * mutacion que sobrevivio los 1296 tests metiendo el margen del salon en una
 * marca.
 *
 * Se pone POR DEFECTO en `vitest.config.ts` y no spec a spec por lo mismo que
 * el espia es global: un agujero de canal no es de una pantalla. Habia tres
 * sitios con el `vi.useFakeTimers()` desnudo; parchear esos tres deja el
 * agujero abierto para el proximo que escriba la linea, y nada se lo avisaria.
 * Asi el proximo nace cubierto, y el spec que pase SU PROPIO `toFake` sigue
 * mandando el —Vitest usa el del spec entero cuando lo hay, no lo mezcla—.
 *
 * NO FALSEAR `performance` NO CONGELA MENOS EL TIEMPO del test: `Date` sigue
 * falseado, que es de donde sale `Date.now()` y todo lo que el panel mide.
 * `performance.now()` pasa a correr de verdad —en milisegundos reales, que en
 * un test son unidades—, y nada de este paquete lo lee.
 *
 * ---------------------------------------------------------------------------
 * UNA LISTA A MANO SE QUEDA CORTA EN SILENCIO, Y POR ESO NO VA SOLA.
 *
 * El dia que Vitest o sinon agreguen un reloj nuevo, esta lista dejaria de
 * falsearlo sin que nada lo dijera: el test que lo necesite fallaria por un
 * motivo que no se parece en nada a la causa. `relojes-falsos.spec.ts` lo
 * vigila midiendo —no comparando contra otra lista escrita a mano—: calcula en
 * tiempo de ejecucion el conjunto que falsea un `useFakeTimers()` por defecto y
 * exige que la unica diferencia con este sea `performance`.
 */
export const RELOJES_FALSOS = [
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  /**
   * EL QUE ANTES NO ESTABA PORQUE NO EXISTIA — Y VA SOLO, SIN SU PAREJA.
   *
   * jsdom no implementa `requestIdleCallback`, y mientras eso fue todo lo que
   * habia, sinon no lo encontraba en el global y no entraba en el conjunto por
   * defecto. Desde que `vitest.setup.ts` lo MONTA para todo el paquete —ver
   * `rato-libre.ts`: un `?.()` sobre una API que jsdom no trae deja ciegos a
   * los nueve tapones del espia de una sola linea— sinon si lo encuentra, y la
   * regla de esta lista («lo de Vitest menos `performance`») obliga a
   * nombrarlo. El guardian de `relojes-falsos.spec.ts` lo dijo en cuanto se
   * monto, antes de que nadie lo pensara.
   *
   * `cancelIdleCallback` NO ESTA, Y NO ES UN OLVIDO: MEDIDO CON UNA SONDA, un
   * `vi.useFakeTimers()` sustituye `requestIdleCallback` y NO sustituye
   * `cancelIdleCallback` —su identidad no cambia—, al reves que las otras dos
   * parejas (`setTimeout`/`clearTimeout`,
   * `requestAnimationFrame`/`cancelAnimationFrame`). Nombrarlo aqui no haria
   * nada —Vitest instala con `ignoreMissingTimers: true`— y el segundo
   * guardian de ese spec, el que exige que la lista no tenga nombres que no
   * falseen nada, se cae: se midio tambien eso.
   *
   * LA CONSECUENCIA, DICHA PARA QUE NADIE LA DESCUBRA SOLO: dentro de un test
   * con los relojes falsos puestos, cancelar un rato libre NO lo cancela —el
   * `cancelIdleCallback` que queda es el nuestro y la manija es la del reloj
   * falso de sinon—, asi que el callback corre igual. Para lo que este tapon
   * existe eso cae del lado seguro: lo que se aplaza se VE, que es justo lo
   * que se queria. Y si algun dia sinon empieza a falsearlo, el primer
   * guardian lo nombrara.
   */
  'requestIdleCallback',
  'hrtime',
  'Date',
  'Intl',
] as const;

/** El unico reloj del conjunto por defecto que este paquete NO falsea. */
export const EL_RELOJ_QUE_NO_SE_FALSEA = 'performance';
