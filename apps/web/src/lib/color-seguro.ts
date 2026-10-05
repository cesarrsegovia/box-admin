/**
 * La lista blanca de los dos colores que el admin elige para su landing.
 *
 * Esto es un CORTAFUEGOS, igual que `api-url.ts`, y por eso vive aparte y con
 * sus propios tests. `colorPrimario` y `colorSecundario` son los dos unicos
 * valores escritos por un usuario que acaban dentro de CSS en una pagina
 * publica; todo lo demas que escribe el admin se pinta como texto.
 *
 * SI, LA API YA LOS VALIDA con `@IsHexColor`. Se validan otra vez aqui a
 * proposito: confiar en que el otro lado ya valido es exactamente el
 * razonamiento que convierte dos validaciones en cero el dia que alguien
 * relaje el DTO, siembre la base a mano o cambie el origen de los datos.
 *
 * Ademas `@IsHexColor` da la almohadilla por OPCIONAL (`aabbcc` le vale), y
 * eso como valor de una variable CSS no es un color. Aqui se exige.
 */

/** Los mismos que `WebSalonConfig` tiene por defecto en el schema. */
export const COLOR_PRIMARIO_POR_DEFECTO = '#000000';
export const COLOR_SECUNDARIO_POR_DEFECTO = '#ffffff';

/**
 * Las cuatro formas hexadecimales que CSS acepta y ninguna mas.
 *
 * Deliberadamente estrecha y anclada en los dos extremos: sin `^` y `$`, un
 * `#aabbcc; background: url(...)` encontraria su `#aabbcc` dentro y pasaria.
 * Nada de `\s*` alrededor: un color con espacios no es un color, es un sitio
 * donde alguien escondio algo.
 */
const HEXADECIMAL = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Devuelve `valor` si es un color hexadecimal, y `porDefecto` si no.
 *
 * Nunca lanza: una landing con el color equivocado se sigue leyendo, una que
 * revienta no.
 */
export function colorSeguro(valor: string, porDefecto: string): string {
  // `typeof` y no un `!valor`: el JSON viene de la red y nada garantiza que
  // esta clave sea una cadena, por mucho que el tipo diga que lo es.
  if (typeof valor !== 'string') return porDefecto;

  return HEXADECIMAL.test(valor) ? valor : porDefecto;
}
