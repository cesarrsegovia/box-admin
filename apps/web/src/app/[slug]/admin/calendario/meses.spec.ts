import { describe, expect, it } from 'vitest';
import { mesesOfrecidos } from './meses';

const NOVIEMBRE_2026 = new Date(Date.UTC(2026, 10, 15));

// Fabrica, no constante compartida: cada test recibe un Date propio. Que
// `mesesOfrecidos` no lo toque ya lo fija un test de mas abajo, pero un reloj
// de un solo uso no depende de que ese test exista.
const marzo2026 = () => new Date(Date.UTC(2026, 2, 5));

describe('mesesOfrecidos', () => {
  it('empieza por el mes actual', () => {
    expect(mesesOfrecidos(NOVIEMBRE_2026)[0]).toEqual({ anio: 2026, mes: 11 });
  });

  it('NO ofrece meses pasados', () => {
    const pasados = mesesOfrecidos(NOVIEMBRE_2026).filter(
      (m) => m.anio * 12 + m.mes < 2026 * 12 + 11,
    );
    expect(pasados).toEqual([]);
  });

  it('cruza el fin de anio', () => {
    const desdeDiciembre = mesesOfrecidos(new Date(Date.UTC(2026, 11, 1)));
    expect(desdeDiciembre.slice(0, 3)).toEqual([
      { anio: 2026, mes: 12 },
      { anio: 2027, mes: 1 },
      { anio: 2027, mes: 2 },
    ]);
  });

  // El ultimo dia del mes sigue siendo el mes actual: la API lo compara por
  // mes, no por dia, asi que ofrecerlo es correcto.
  it('el ultimo dia del mes todavia ofrece ese mes', () => {
    expect(mesesOfrecidos(new Date(Date.UTC(2026, 10, 30)))[0]).toEqual({ anio: 2026, mes: 11 });
  });

  it('ofrece una cantidad fija y conocida', () => {
    expect(mesesOfrecidos(NOVIEMBRE_2026)).toHaveLength(12);
  });

  // Los tests de arriba miran el primero y, en el caso de diciembre, los tres
  // primeros. Del cuarto en adelante lo unico que los rozaba era el filtro de
  // meses pasados, que les lee dos campos para compararlos y nada mas: un mes
  // repetido en el medio, o un hueco, pasaba entero. Asi que aca se compara la
  // lista COMPLETA contra la esperada, no una muestra. De paso fija que cada
  // elemento tenga exactamente las claves del contrato: `toEqual` rechaza un
  // campo de mas, en la posicion que sea.
  it('la lista entera es esta, mes por mes', () => {
    expect(mesesOfrecidos(NOVIEMBRE_2026)).toEqual([
      { anio: 2026, mes: 11 },
      { anio: 2026, mes: 12 },
      { anio: 2027, mes: 1 },
      { anio: 2027, mes: 2 },
      { anio: 2027, mes: 3 },
      { anio: 2027, mes: 4 },
      { anio: 2027, mes: 5 },
      { anio: 2027, mes: 6 },
      { anio: 2027, mes: 7 },
      { anio: 2027, mes: 8 },
      { anio: 2027, mes: 9 },
      { anio: 2027, mes: 10 },
    ]);
  });

  // Lo anterior clava una base; esto fija la propiedad para cualquier otra. Se
  // arranca en marzo para que el salto de anio caiga en la posicion 10, bien
  // lejos de los primeros elementos que el resto de los tests ya vigila.
  it('avanza de a un mes exacto, sin huecos ni repetidos, de punta a punta', () => {
    const corridos = mesesOfrecidos(marzo2026()).map((m) => m.anio * 12 + m.mes);
    const progresion = Array.from({ length: 12 }, (_, i) => 2026 * 12 + 3 + i);

    expect(corridos).toEqual(progresion);
  });

  // El salto de un mes corrido no distingue «enero del ano que viene» de «mes
  // 13 de este»: las dos cuentas dan lo mismo. Por eso el rango va aparte.
  it('ningun mes se sale de 1..12', () => {
    const fuera = mesesOfrecidos(marzo2026()).filter((m) => m.mes < 1 || m.mes > 12);

    expect(fuera).toEqual([]);
  });

  // El reloj es un parametro prestado, no un borrador. Si la funcion lo
  // escribiera -por ejemplo "normalizando" el dia, que para el mes da igual-
  // le estaria cambiando el reloj a quien se lo presto, y encima en silencio:
  // ningun otro test de este archivo lo notaria, porque la comparacion es por
  // mes. El NOVIEMBRE_2026 compartido quedaria contaminado para los demas.
  it('no toca el Date que recibe', () => {
    const reloj = new Date(Date.UTC(2026, 10, 30, 13, 45, 7, 11));
    const copia = reloj.getTime();

    mesesOfrecidos(reloj);

    expect(reloj.getTime()).toBe(copia);
  });

  // Corolario del anterior: dos llamadas con el mismo Date dan lo mismo.
  it('es repetible con el mismo reloj', () => {
    const reloj = new Date(Date.UTC(2026, 10, 30));

    expect(mesesOfrecidos(reloj)).toEqual(mesesOfrecidos(reloj));
  });
});
