import type { Mes } from '@/hooks/use-stats';

/**
 * LOS MESES DE LOS REPORTES MENSUALES: el mes que dice la URL, los que ofrece
 * el selector y como se escribe uno.
 *
 * Los usan Analisis (caja, composicion, operativo y liquidacion: los cuatro se
 * piden con el MISMO mes) y el area de la profesora. Viven en `lib` porque
 * ninguna area importa de otra.
 *
 * La pantalla usa estas funciones para armar la consulta y el spec las usa
 * para saber con que clave sembrar la cache. Que las dos cosas salgan de la
 * MISMA funcion es lo que impide que un test pase con una lectura equivocada.
 */

/**
 * Los limites del mes, COPIADOS DEL DTO porque es el DTO quien los decide.
 *
 * `ConsultaMensualDto` lleva `@Min(2000) @Max(2200)` en el anio y
 * `@Min(1) @Max(12)` en el mes. Fuera de eso la API contesta 400, y un mes que
 * viene de la URL —que escribe cualquiera— no puede convertirse en una
 * pantalla en blanco que no explica nada. Para la liquidacion
 * (`/liquidacion/:id` y `/mi-liquidacion`, que usan `ParseIntPipe` sin
 * limites) es una cota del cliente y no de la API.
 *
 * NO se recorta a «meses que ya pasaron». El reporte operativo acepta un mes
 * futuro y lo dice por escrito en `StatsService.operativo`: sin turnos, las
 * cuatro metricas de clases vuelven con denominador cero y `porcentaje: null`
 * —no se sabe, porque no paso nada todavia—. Eso es una respuesta honesta, no
 * un error, y rechazarla aqui seria inventar una regla que la API no tiene.
 */
const MIN_ANIO = 2000;
const MAX_ANIO = 2200;

/** Cuantos meses ofrece el selector hacia atras, contando el de hoy. */
const CUANTOS_SE_OFRECEN = 12;

/**
 * Los meses en castellano, ESCRITOS y no formateados.
 *
 * `Intl.DateTimeFormat` daria el nombre segun la configuracion regional de la
 * maquina: el mismo enlace compartido diria «November» en la computadora del
 * mostrador si alguien le cambio el idioma al sistema, y el test que fija los
 * textos pasaria o fallaria segun donde corra.
 *
 * `calendario/selectores.tsx` todavia tiene su propia copia; ya puede importar
 * `textoDelMes` de aqui.
 */
const NOMBRES_DE_MES: readonly string[] = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Un entero, o nada.
 *
 * `Number('')` es 0 y `Number(' 11 ')` es 11: la conversion directa acepta
 * cosas que la ruta de la API no acepta. Y `parseInt('11.5')` es 11, que
 * convertiria un parametro roto en uno valido en silencio.
 */
function enteroDeLaUrl(valor: string | null): number | null {
  if (valor === null || !/^-?\d+$/.test(valor)) return null;
  return Number(valor);
}

/** El mes en el que estamos, en UTC, que es el huso en el que piensa la API. */
export function mesDeHoy(ahora: Date): Mes {
  return { anio: ahora.getUTCFullYear(), mes: ahora.getUTCMonth() + 1 };
}

/** Un mes que la API puede contestar: dentro de los limites del DTO. */
function esMesPosible(mes: Mes): boolean {
  return (
    mes.anio >= MIN_ANIO &&
    mes.anio <= MAX_ANIO &&
    Number.isInteger(mes.mes) &&
    mes.mes >= 1 &&
    mes.mes <= 12
  );
}

/**
 * EL MES QUE DICE LA URL, y si no dice ninguno, el de hoy.
 *
 * El mes vive en la URL y nunca en `useState`. Un mes en la URL se comparte
 * por chat («mira la ocupacion de marzo»), sobrevive al boton de atras y vuelve
 * puesto desde el login. En estado se pierde al navegar, y la barra de
 * direcciones y la pantalla dicen cosas distintas.
 *
 * LAS DOS PARTES VAN JUNTAS O NO VAN. Un `?anio=2026` suelto no significa
 * «todo 2026» —el reporte no sabe contestar eso— ni «enero de 2026»: es media
 * eleccion, y la mitad que falta no se adivina. Se cae al mes de hoy, que es el
 * mismo sitio al que cae una URL sin nada.
 *
 * Y UN MES IMPOSIBLE TAMPOCO SE ARREGLA: `?mes=13` no se recorta a 12 —eso
 * pintaria diciembre debajo de una barra de direcciones que dice otra cosa—,
 * se cae al mes de hoy, que es lo que la pantalla ya estaba enseñando.
 */
export function mesDeLaBusqueda(parametros: URLSearchParams, ahora: Date): Mes {
  const anio = enteroDeLaUrl(parametros.get('anio'));
  const mes = enteroDeLaUrl(parametros.get('mes'));

  if (anio === null || mes === null) return mesDeHoy(ahora);

  const pedido = { anio, mes };
  return esMesPosible(pedido) ? pedido : mesDeHoy(ahora);
}

/** Dos meses son el mismo cuando coinciden las dos partes. */
export function mismoMes(uno: Mes, otro: Mes): boolean {
  return uno.anio === otro.anio && uno.mes === otro.mes;
}

/**
 * Los meses que el selector ofrece: el de hoy y los once anteriores.
 *
 * Un año de historia es lo que se mira para decidir algo, y el reporte ya trae
 * su propio trimestre dentro de cada mes.
 *
 * EL ELEGIDO ENTRA SIEMPRE, aunque caiga fuera de ese año. La URL la escribe
 * cualquiera y un enlace guardado hace dos años sigue siendo una peticion que
 * la API contesta: si el mes elegido no estuviera entre las opciones, el
 * `<select>` quedaria en blanco mientras la pantalla pinta ese mes —la barra
 * de direcciones y el control diciendo cosas distintas, que es exactamente lo
 * que poner el mes en la URL vino a evitar—.
 *
 * El reloj entra por parametro para poder probarlo sin congelar el global.
 */
export function mesesOfrecidos(ahora: Date, elegido: Mes): Mes[] {
  const hoy = mesDeHoy(ahora);
  const base = hoy.anio * 12 + (hoy.mes - 1);

  const meses: Mes[] = [];
  for (let atras = 0; atras < CUANTOS_SE_OFRECEN; atras += 1) {
    const indice = base - atras;
    meses.push({ anio: Math.floor(indice / 12), mes: (indice % 12) + 1 });
  }

  if (!meses.some((uno) => mismoMes(uno, elegido))) meses.push(elegido);

  // Del mas nuevo al mas viejo: en un selector, lo que se elige casi siempre
  // es lo reciente. (El TRIMESTRE se pinta al reves, del mas viejo al mas
  // nuevo, porque eso es una serie de tiempo y no una lista de opciones.)
  return meses.sort((uno, otro) => otro.anio * 12 + otro.mes - (uno.anio * 12 + uno.mes));
}

/** Lo que el mes vale EN EL CONTROL. Las dos partes van juntas o no van. */
export function valorDelMes(mes: Mes): string {
  return `${mes.anio}-${mes.mes}`;
}

/**
 * El mes que representa ese valor, o `null` si no representa ninguno.
 *
 * Es la vuelta de `valorDelMes`, y el `null` no es defensa decorativa: lo que
 * llega aqui es el `value` de un `<option>`, que en un test —o en las
 * herramientas del navegador— puede ser cualquier cosa. Un valor que no se
 * entiende NO navega: dejar la URL como esta es mejor que escribir en ella un
 * mes que nadie eligio.
 */
export function mesDelValor(valor: string): Mes | null {
  const partes = valor.split('-');
  if (partes.length !== 2) return null;

  const anio = enteroDeLaUrl(partes[0] ?? null);
  const mes = enteroDeLaUrl(partes[1] ?? null);
  if (anio === null || mes === null) return null;

  const pedido = { anio, mes };
  return esMesPosible(pedido) ? pedido : null;
}

/** El mes como se lee: «marzo 2026». */
export function textoDelMes(mes: Mes): string {
  return `${NOMBRES_DE_MES[mes.mes - 1] ?? String(mes.mes)} ${mes.anio}`;
}
