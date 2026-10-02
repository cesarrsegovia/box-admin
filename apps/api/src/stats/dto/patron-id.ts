/**
 * Un id tal como lo genera `@default(cuid())`: letras y digitos.
 *
 * NO ES VALIDACION COSMETICA Y NO ES UN `@IsString()` DISFRAZADO. Estos valores
 * viajan a la clave del cache, y los separadores `:` de la clave no se escapan
 * —lo dice el docblock de `StatsService`—. Un id con dos puntos no puede
 * suplantar a otro reporte, porque entra al final de la clave y el prefijo
 * `<reporte>:<params>:` queda delante igual; lo que si puede es meter texto
 * arbitrario y sin tope en una clave de Redis. El patron lo cierra en el borde,
 * que es donde la regla "a la clave solo van valores ya validados" se cumple o
 * no se cumple.
 *
 * Un id inexistente NO es un 400: el patron comprueba la forma, no la
 * existencia. Pedir el reporte de una sala que no esta devuelve un reporte sin
 * turnos, que es la respuesta honesta a "no hubo clases ahi".
 *
 * VIVE EN SU PROPIO ARCHIVO y no copiado en cada DTO: la regla es la misma para
 * el `salaId` del operativo, el de los turnos libres y el `perfilId` de la
 * asistencia, y tres copias de una regex son tres copias que algun dia
 * discrepan —el mismo motivo por el que `ConsultaOperativaDto` hereda el mes en
 * vez de repetirlo—.
 */
export const PATRON_ID = /^[A-Za-z0-9]+$/;

/** Tope de longitud de un id en la clave del cache. Un cuid ronda los 25. */
export const MAX_LARGO_ID = 64;
