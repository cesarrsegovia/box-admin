import type { FranjaDeLiquidacion } from '@boxadmin/shared';
import { aCentavos, aTexto, calcularImportes } from './calcular-importes';

function franja(parcial: Partial<FranjaDeLiquidacion>): FranjaDeLiquidacion {
  return {
    fecha: '2026-10-05',
    salaId: 'sala-1',
    horaInicio: '10:00',
    horaFin: '11:00',
    minutos: 60,
    contratada: true,
    dictada: true,
    cerrada: false,
    motivoCierre: null,
    turnoId: 'turno-1',
    tarifaPorHora: '1000.00',
    origenTarifa: 'HORARIO',
    ...parcial,
  };
}

describe('calcularImportes', () => {
  it('una hora a mil pesos son mil pesos', () => {
    const r = calcularImportes([franja({})]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.dictadas.texto).toBe('1000.00');
    expect(r.aPagar.centavos).toBe(100_000);
  });

  it('redondea media unidad hacia arriba', () => {
    // 50 minutos a 1000.00 = 50 * 100000 / 60 = 83333.33 centavos
    const r = calcularImportes([franja({ minutos: 50 })]);

    expect(r.dictadas.centavos).toBe(83_333);
  });

  it('redondea hacia arriba cuando la mitad es exacta', () => {
    // 30 minutos a 0.01 la hora = 30 * 1 / 60 = 0.5 centavos -> 1
    const r = calcularImportes([franja({ minutos: 30, tarifaPorHora: '0.01' })]);

    expect(r.dictadas.centavos).toBe(1);
  });

  /**
   * EL CASO QUE JUSTIFICA AGRUPAR.
   *
   * Tres franjas de 50 minutos a la misma tarifa. Redondeando cada una:
   * 83333 x 3 = 249999. Sumando los minutos primero: 150 * 100000 / 60 =
   * 250000 exacto. Un centavo de diferencia, y se lo lleva una persona.
   */
  it('agrupa por tarifa ANTES de multiplicar, no despues', () => {
    const r = calcularImportes([
      franja({ minutos: 50 }),
      franja({ minutos: 50 }),
      franja({ minutos: 50 }),
    ]);

    expect(r.dictadas.centavos).toBe(250_000);
  });

  it('la misma tarifa escrita de tres formas es UN solo grupo', () => {
    // `"1000.00"`, `"1000.0"` y `"1000"` son el mismo dinero. Agrupadas por la
    // grafia serian tres grupos de 50 minutos, 83333 cada uno: 249999. Es el
    // mismo centavo que el caso de arriba, entrando por la puerta de atras.
    const r = calcularImportes([
      franja({ minutos: 50, tarifaPorHora: '1000.00' }),
      franja({ minutos: 50, tarifaPorHora: '1000.0' }),
      franja({ minutos: 50, tarifaPorHora: '1000' }),
    ]);

    expect(r.dictadas.centavos).toBe(250_000);
  });

  it('con dos tarifas distintas, cada grupo se redondea por separado', () => {
    const r = calcularImportes([
      franja({ minutos: 50, tarifaPorHora: '1000.00' }),
      franja({ minutos: 50, tarifaPorHora: '2000.00' }),
    ]);

    // 83333 + 166667 = 250000
    expect(r.dictadas.centavos).toBe(250_000);
  });

  it('las contratadas sin dictar se calculan pero NO se pagan', () => {
    const r = calcularImportes([franja({ dictada: false })]);

    expect(r.contratadasSinDictar.centavos).toBe(100_000);
    expect(r.dictadas.centavos).toBe(0);
    expect(r.aPagar.centavos).toBe(0);
  });

  it('las cerradas se calculan pero NO se pagan', () => {
    const r = calcularImportes([
      franja({ contratada: true, dictada: false, cerrada: true, motivoCierre: 'Feriado' }),
    ]);

    expect(r.cerradas.centavos).toBe(100_000);
    expect(r.aPagar.centavos).toBe(0);
    // Y NO cuenta ademas como contratada sin dictar: es un feriado, no una hora
    // que nadie uso por falta de alumnos. Mismo criterio que `minutosContratados`
    // de la Fase 4, que tambien excluye las cerradas. Sin esta linea, quitar el
    // `!f.cerrada` del filtro no rompe ningun test.
    expect(r.contratadasSinDictar.centavos).toBe(0);
  });

  it('una suplencia sin contrato se paga igual: fue dictada', () => {
    const r = calcularImportes([franja({ contratada: false, dictada: true })]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.aPagar.centavos).toBe(100_000);
    expect(r.contratadasSinDictar.centavos).toBe(0);
  });

  it('una franja sin tarifa no suma importe, y sus minutos se reportan', () => {
    const r = calcularImportes([
      franja({ minutos: 60 }),
      franja({ minutos: 90, tarifaPorHora: null, origenTarifa: null }),
    ]);

    expect(r.dictadas.centavos).toBe(100_000);
    expect(r.minutosSinTarifa).toBe(90);
  });

  it('una franja CERRADA sin tarifa tambien reporta sus minutos', () => {
    // `cerradas` se muestra con importe igual que `dictadas`, asi que quien lo
    // lee tiene el mismo derecho a saber que el numero esta incompleto. Si el
    // filtro mirara solo las dictadas, estos noventa minutos desaparecerian.
    const r = calcularImportes([
      franja({ minutos: 60 }),
      franja({
        minutos: 90,
        contratada: true,
        dictada: false,
        cerrada: true,
        motivoCierre: 'Feriado',
        tarifaPorHora: null,
        origenTarifa: null,
      }),
    ]);

    expect(r.cerradas.centavos).toBe(0);
    expect(r.minutosSinTarifa).toBe(90);
  });

  it('sin franjas, todo en cero y sin minutos sueltos', () => {
    const r = calcularImportes([]);

    expect(r.aPagar.centavos).toBe(0);
    expect(r.aPagar.texto).toBe('0.00');
    expect(r.minutosSinTarifa).toBe(0);
  });

  it('una tarifa con centavos no se pierde en el camino', () => {
    const r = calcularImportes([franja({ minutos: 60, tarifaPorHora: '1234.56' })]);

    expect(r.dictadas.centavos).toBe(123_456);
    expect(r.dictadas.texto).toBe('1234.56');
  });
});

/**
 * Las dos funciones que definen que es un importe en este sistema, probadas de
 * frente y no de rebote.
 *
 * Importa el valor de cada caso, no que haya una tabla: `"1234.56"` —el unico
 * decimal que ejercitaba el resto del spec— es justo uno de los que la
 * multiplicacion en coma flotante ACIERTA, asi que no distingue la version
 * exacta de la rota. `"0.29"` y `"1.15"` si: `0.29 * 100` da 28.999999999999996
 * en doubles. De las dos millones de tarifas de dos decimales entre 0.01 y
 * 20000.00, 131252 —un 6,6%— pierden un centavo por ese camino.
 */
describe('aCentavos / aTexto', () => {
  it.each([
    // tarifa          centavos      texto normalizado
    ['0.01', 1, '0.01'],
    ['0.1', 10, '0.10'],
    ['0.29', 29, '0.29'],
    ['1.15', 115, '1.15'],
    ['1000', 100_000, '1000.00'],
    ['1000.5', 100_050, '1000.50'],
    ['99999999.99', 9_999_999_999, '99999999.99'],
  ])('%s vale %i centavos y vuelve como %s', (tarifa, centavos, texto) => {
    expect(aCentavos(tarifa as string)).toBe(centavos);
    expect(aTexto(centavos as number)).toBe(texto);
  });

  it.each(['1000,50', '1000.555', '', 'mil', '1.2.3'])(
    'lanza con %p en vez de devolver un numero cualquiera',
    (tarifa) => {
      // Sin la guarda, "1000,50" da NaN —que termina en un `centavos: null` del
      // JSON— y "1000.555" da 100555, o sea 1005.55 en vez de 1000.56. Las dos
      // son corrupciones silenciosas de dinero.
      expect(() => aCentavos(tarifa)).toThrow(/forma invalida/);
    },
  );

  /**
   * EL IMPORTE EN ROJO.
   *
   * `calcularImportes` no produce ninguno, pero `aTexto` es publica y el
   * `margen` de `/stats/caja` —`cobrado - costoProfesoras`— se pone en negativo
   * en cuanto un mes paga mas clases de las que cobra. Sin tratar el signo,
   * `aTexto(-1)` devolvia `"0.-1"`: no un numero mal redondeado, directamente
   * una cadena que no es un importe.
   */
  it.each([
    [-1, '-0.01'],
    [-29, '-0.29'],
    [-100, '-1.00'],
    [-123_456, '-1234.56'],
    [0, '0.00'],
  ])('%i se escribe %s', (centavos, texto) => {
    expect(aTexto(centavos)).toBe(texto);
  });
});
