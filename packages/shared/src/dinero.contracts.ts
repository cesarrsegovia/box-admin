/**
 * Un importe, en centavos enteros y en texto.
 *
 * `centavos` es la verdad: entero, exacto, sumable sin sorpresas. `texto` es
 * una comodidad para mostrar, con dos decimales y punto como separador. Mismo
 * criterio que `minutos` y `horas` en la liquidacion de la Fase 4: el entero
 * manda y el string derivado acompana.
 *
 * NO existe un campo `numero` con el importe en pesos como float. Es
 * deliberado: un float de dinero es una suma mal hecha esperando a ocurrir, y
 * tenerlo disponible garantiza que alguien lo use.
 */
export interface Importe {
  centavos: number;
  /** Dos decimales siempre, p. ej. `"1250.00"`. */
  texto: string;
}
