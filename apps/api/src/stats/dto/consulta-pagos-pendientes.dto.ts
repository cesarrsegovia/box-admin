/**
 * EL DTO QUE NO TIENE NI UN CAMPO, Y SU VACIO ES LA FUNCIONALIDAD.
 *
 * La spec pedia `/stats/pagos-pendientes?salaId=`. El `salaId` se quito al
 * implementarlo, por la MISMA razon por la que la caja lo rechaza y por la que
 * la cobranza del operativo no se acota: **estar al dia es una propiedad del
 * alumno y de sus pagos, no de una sala.** Un alumno tiene acceso a varias
 * salas a la vez y su `pendienteEstimado` es el precio de su pack ENTERO, no el
 * de una sala, asi que la misma persona apareceria con su deuda completa en la
 * lista de la sala A y en la de la B. Sumar las dos listas contaria el mismo
 * peso dos veces, que es exactamente la atribucion de ingresos que la seccion 3
 * de la spec borro.
 *
 * Aceptarlo e ignorarlo tampoco vale: un parametro que se acepta y no hace nada
 * es una mentira con codigo 200. Alguien lo manda, recibe una lista y cree que
 * es de esa sala, y eso es peor que no tenerlo porque parece que anduvo.
 *
 * CON ESTA CLASE VACIA Y EL ValidationPipe GLOBAL —que corre con
 * `forbidNonWhitelisted`—, mandar `?salaId=` devuelve 400 con "property salaId
 * should not exist", y una query vacia pasa limpia. Sin el `@Query()` del
 * controller apuntando aqui, Nest ignoraria el parametro en silencio y
 * volveriamos a la mentira con 200. Hay un caso que lo fija.
 *
 * TAMPOCO LLEVA `anio`/`mes`, y eso tambien es una decision: este reporte
 * contesta "a quien le reclamo HOY", no "quien debia en marzo". La fecha de
 * evaluacion esta escrita en el docblock de `StatsService.pagosPendientes`.
 */
export class ConsultaPagosPendientesDto {}
