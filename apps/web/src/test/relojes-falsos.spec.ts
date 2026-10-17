import { expect, it, vi } from 'vitest';
import { EL_RELOJ_QUE_NO_SE_FALSEA, RELOJES_FALSOS } from './relojes-falsos';

/**
 * EL GUARDIAN DE LA LISTA DE `vitest.config.ts`, Y POR QUE MIDE EN VEZ DE
 * COMPARAR CONTRA OTRA LISTA.
 *
 * `vitest.config.ts` fija que relojes falsea un `vi.useFakeTimers()` desnudo:
 * el conjunto por defecto de Vitest MENOS `performance`. Ese conjunto por
 * defecto no esta escrito en ninguna parte —el runner lo calcula mirando el
 * global de verdad, ver `relojes-falsos.ts`—, asi que una lista a mano se
 * queda corta EN SILENCIO el dia que Vitest o jsdom traigan un reloj nuevo: el
 * reloj nuevo dejaria de falsearse, y el test que lo necesite fallaria por un
 * motivo que no se parece en nada a la causa.
 *
 * Este guardian no compara la lista contra otra lista: MIDE. Instala los
 * relojes falsos de las dos maneras y mira QUE GLOBALES CAMBIARON DE IDENTIDAD
 * en cada caso. Si Vitest agrega un reloj, aparece en el conjunto por defecto,
 * no en el nuestro, y este test lo NOMBRA.
 */

/** El valor de un global, sin morir si el getter explota. */
function valorDe(nombre: string): unknown {
  try {
    return (globalThis as unknown as Record<string, unknown>)[nombre];
  } catch {
    return '«getter que explota»';
  }
}

/**
 * La identidad de todo lo que cuelga del global, mas los dos relojes que no
 * son globales: `hrtime` y `nextTick` viven en `process`.
 */
function fotoDeLosGlobales(): Map<string, unknown> {
  const foto = new Map<string, unknown>();

  for (const nombre of Object.getOwnPropertyNames(globalThis)) foto.set(nombre, valorDe(nombre));

  foto.set('hrtime', process.hrtime);
  foto.set('nextTick', process.nextTick);

  return foto;
}

/**
 * Que globales SUSTITUYE esta forma de instalar los relojes falsos.
 *
 * Por identidad y no por nombre: es lo unico que no hay que mantener a mano.
 * `NaN` sale siempre —no es igual a si mismo— y da igual, porque sale en las
 * dos medidas y las dos se comparan entre si, nunca contra una lista.
 */
function loQueSustituye(instalar: () => void): Set<string> {
  const antes = fotoDeLosGlobales();

  instalar();

  const sustituidos = new Set<string>();

  for (const [nombre, valor] of fotoDeLosGlobales()) {
    if (antes.get(nombre) !== valor) sustituidos.add(nombre);
  }

  vi.useRealTimers();

  return sustituidos;
}

it('los relojes falsos de este paquete son los de Vitest menos `performance`', () => {
  // `toFake: undefined` explicito pisa el de `vitest.config.ts` y hace que
  // Vitest calcule su conjunto por defecto, que es justo con lo que hay que
  // comparar.
  const porDefectoDeVitest = loQueSustituye(() => {
    vi.useFakeTimers({ toFake: undefined });
  });
  const losDeEstePaquete = loQueSustituye(() => {
    vi.useFakeTimers();
  });

  const queNoFalseamos = [...porDefectoDeVitest].filter((reloj) => !losDeEstePaquete.has(reloj));
  const queFalseamosDeMas = [...losDeEstePaquete].filter((reloj) => !porDefectoDeVitest.has(reloj));

  expect(
    queNoFalseamos.sort(),
    'la lista de `vitest.config.ts` se quedo corta: Vitest falsea relojes que nosotros no',
  ).toEqual([EL_RELOJ_QUE_NO_SE_FALSEA]);

  expect(
    queFalseamosDeMas.sort(),
    'la lista de `vitest.config.ts` falsea relojes que Vitest ya no falsea',
  ).toEqual([]);
});

it('y la lista escrita no tiene nombres que no falseen nada', () => {
  const losDeEstePaquete = loQueSustituye(() => {
    vi.useFakeTimers();
  });

  // Un nombre mal escrito no revienta —Vitest instala con
  // `ignoreMissingTimers: true`—: se queda sin falsear y en verde. Aqui se cae.
  expect([...RELOJES_FALSOS].filter((reloj) => !losDeEstePaquete.has(reloj))).toEqual([]);
});

it('con los relojes falsos puestos, una marca sigue llegando al buffer de verdad', () => {
  // Esta es la razon de ser de todo lo anterior: que el sexto canal del espia
  // —el buffer de User Timing— NO quede ciego dentro de un test que congela el
  // tiempo. Con `performance` falseado, esta marca no llega a ninguna parte.
  vi.useFakeTimers();

  performance.mark('relojes-falsos:sonda');
  const llego = performance.getEntriesByType('mark').some((e) => e.name === 'relojes-falsos:sonda');

  vi.useRealTimers();

  expect(llego).toBe(true);
});
