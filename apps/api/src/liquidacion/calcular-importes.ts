import type { FranjaDeLiquidacion, Importe, ImportesDeLiquidacion } from '@boxadmin/shared';

const MINUTOS_POR_HORA = 60;

/**
 * El importe de una liquidacion, en centavos enteros.
 *
 * PURA: ni una query, ni una fecha, ni un `new Date()`. Recibe las franjas que
 * `calcularLiquidacion` ya produjo —con la tarifa RESUELTA por franja, que es
 * justo lo que la Fase 4 dejo preparado— y multiplica.
 *
 * ---
 *
 * POR QUE CENTAVOS ENTEROS Y NO UNA LIBRERIA DECIMAL. Los ordenes de magnitud
 * de este dominio —unos diez mil minutos al mes, tarifas de hasta ocho digitos—
 * dejan el producto `minutos x tarifaCentavos` muy por debajo de
 * Number.MAX_SAFE_INTEGER, asi que la multiplicacion es EXACTA con enteros
 * nativos. Lo unico inexacto es dividir por 60, y eso se hace con aritmetica
 * entera unas lineas mas abajo, sin pasar por un float en ningun momento.
 *
 * POR QUE SE AGRUPA POR TARIFA. Redondear cada franja y despues sumar acumula
 * el error; sumar los minutos de cada tarifa y multiplicar una vez, no. Tres
 * franjas de cincuenta minutos a mil pesos dan 249999 centavos redondeando
 * cada una y 250000 redondeando al final. El centavo se lo lleva una persona, y
 * por eso hay un test que fija exactamente ese caso.
 *
 * POR QUE SOLO SE PAGAN LAS DICTADAS. Decision tomada con Cesar en la spec: la
 * profesora cobra por hora dictada a tarifa fija. Las contratadas sin turno y
 * las cerradas por feriado se calculan igual porque son la conversacion que el
 * admin va a tener con ella, pero no entran en `aPagar`.
 */
export function calcularImportes(franjas: FranjaDeLiquidacion[]): ImportesDeLiquidacion {
  const dictadas = importeDe(franjas, (f) => f.dictada);
  const contratadasSinDictar = importeDe(franjas, (f) => f.contratada && !f.dictada && !f.cerrada);
  const cerradas = importeDe(franjas, (f) => f.cerrada);

  return {
    dictadas,
    contratadasSinDictar,
    cerradas,
    // `aPagar` es una copia de `dictadas` y no una referencia al mismo objeto:
    // si manana la regla cambia —un porcentaje, un piso—, el cambio es aqui y
    // no hay que desenredar dos campos que apuntaban a lo mismo.
    aPagar: { ...dictadas },
    // CUALQUIER franja sin tarifa, no solo las dictadas: los otros dos grupos
    // tambien se muestran con importe, y un lector que ve `cerradas: 1500.00`
    // no tiene como saber que se saltaron noventa minutos. El numero existe
    // para decir que el informe tiene agujeros, asi que cubre el informe entero.
    minutosSinTarifa: franjas
      .filter((f) => f.tarifaPorHora === null)
      .reduce((total, f) => total + f.minutos, 0),
  };
}

function importeDe(
  franjas: FranjaDeLiquidacion[],
  incluye: (f: FranjaDeLiquidacion) => boolean,
): Importe {
  // Indexado por el VALOR en centavos, no por la grafia del string: `"1000.00"`,
  // `"1000.0"` y `"1000"` son el mismo dinero, y como tres claves distintas
  // romperian la agrupacion por la puerta de atras —tres franjas de cincuenta
  // minutos con esas tres grafias dan 249999 en vez de 250000, justo el centavo
  // que agrupar existe para no perder—. Hoy no llega asi porque la capa de datos
  // normaliza con `.toFixed(2)`, pero esta funcion es publica y su firma acepta
  // cualquier string: no puede depender de un invariante que vive en otro archivo.
  const minutosPorTarifa = new Map<number, number>();

  for (const franja of franjas) {
    if (!incluye(franja)) continue;
    // Sin tarifa no hay importe que calcular. Los minutos no se pierden: los
    // cuenta `minutosSinTarifa`, para que el total diga que esta incompleto.
    if (franja.tarifaPorHora === null) continue;

    const tarifaCentavos = aCentavos(franja.tarifaPorHora);
    const acumulado = minutosPorTarifa.get(tarifaCentavos) ?? 0;
    minutosPorTarifa.set(tarifaCentavos, acumulado + franja.minutos);
  }

  let centavos = 0;
  for (const [tarifaCentavos, minutos] of minutosPorTarifa) {
    centavos += dividirRedondeando(minutos * tarifaCentavos, MINUTOS_POR_HORA);
  }

  return { centavos, texto: aTexto(centavos) };
}

/**
 * Division entera con redondeo de media unidad HACIA ARRIBA.
 *
 * Entera de punta a punta: no se divide con `/` y se redondea despues, porque
 * entonces el resultado depende de un float intermedio. Aqui el cociente y el
 * resto son enteros exactos y la comparacion `resto * 2 >= divisor` decide sin
 * ambiguedad. Los importes son siempre positivos, asi que no hace falta pensar
 * en como redondea el negativo.
 */
function dividirRedondeando(dividendo: number, divisor: number): number {
  // El resto primero, y el cociente sobre un dividendo que ya es multiplo exacto
  // del divisor. Asi la division no redondea nada: `Math.floor(a / b)` daria el
  // mismo numero en este dominio, pero pasaria por un float y dejaria el
  // comentario de arriba convertido en una aproximacion defendible en vez de un
  // hecho.
  const resto = dividendo % divisor;
  const cociente = (dividendo - resto) / divisor;

  return resto * 2 >= divisor ? cociente + 1 : cociente;
}

/** Digitos, y como mucho dos decimales. Sin signo: los importes no son negativos. */
const FORMA_DE_TARIFA = /^\d+(\.\d{1,2})?$/;

/**
 * `"1234.56"` -> `123456`. Entero exacto, sin pasar por un float.
 *
 * Exportada a proposito: junto con `aTexto` es el UNICO sitio donde este sistema
 * convierte dinero. Una segunda copia en otro modulo garantiza que algun dia las
 * dos difieran, y la que difiera va a ser la que nadie mire.
 *
 * LANZA ante una tarifa con otra forma, en vez de devolver un numero cualquiera.
 * Sin la guarda, `"1000,50"` —con coma— da `NaN`, que viaja hasta un
 * `centavos: null` en el JSON; y `"1000.555"` da 100555, o sea 1005.55 en vez de
 * 1000.56, medio punto de error en silencio. Hoy no llegan: el DTO valida y la
 * columna es `Decimal(10, 2)`. Pero es dinero, y entre corromperlo callando y
 * fallar ruidosamente, falla.
 */
export function aCentavos(tarifa: string): number {
  if (!FORMA_DE_TARIFA.test(tarifa)) {
    throw new Error(`Tarifa con forma invalida: ${tarifa}`);
  }

  const [enteros, decimales = ''] = tarifa.split('.');

  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

/**
 * `123456` -> `"1234.56"`. La vuelta de `aCentavos`, y por el mismo motivo
 * exportada: el unico sitio donde un importe se convierte a texto.
 *
 * ACEPTA NEGATIVOS, y eso es un cambio de la Task 4 sobre lo que esta funcion
 * hacia al nacer. Nacio asumiendo importes no negativos —minutos y tarifas lo
 * son— con la advertencia de que "quien traiga el primer importe en rojo tiene
 * que arreglar esto ANTES". Ese momento llego en la misma fase: el `margen` de
 * `/stats/caja` es `cobrado - costoProfesoras` y se pone en rojo en cuanto un
 * mes paga mas clases de las que cobra, que es un mes flojo perfectamente
 * normal y no un error. Sin esto, `aTexto(-1)` no daba `"-1.99"` sino la
 * cadena `"0.-1"`: basura silenciosa en un campo de dinero.
 *
 * El signo se separa ANTES de descomponer y se vuelve a pegar al final. Hacer
 * el resto sobre el valor absoluto es lo que evita el `%` negativo de
 * JavaScript, donde `-1 % 100` es `-1` y no `99`.
 */
export function aTexto(centavos: number): string {
  const signo = centavos < 0 ? '-' : '';
  const absoluto = Math.abs(centavos);
  const resto = absoluto % 100;
  const enteros = (absoluto - resto) / 100;

  return `${signo}${enteros}.${String(resto).padStart(2, '0')}`;
}
