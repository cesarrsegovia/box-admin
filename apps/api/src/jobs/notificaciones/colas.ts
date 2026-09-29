export const NOTIFICACION_RESERVA_QUEUE = 'notificacion-reserva-queue';
export const NOTIFICACION_LISTA_ESPERA_QUEUE = 'notificacion-lista-espera-queue';
export const RECORDATORIO_PAGO_QUEUE = 'recordatorio-pago-queue';
export const VENCIMIENTO_PACK_QUEUE = 'vencimiento-pack-queue';

/**
 * `tenantId` es un DATO DE SEGURIDAD en todos los payloads: el worker no tiene
 * request ni JWT, asi que es lo unico que le dice sobre que gimnasio puede
 * operar. Lo pone quien encola, desde el contexto ya abierto, NUNCA el cuerpo
 * de una peticion. Mismo criterio que DatosGeneracionMes desde la Fase 2.
 *
 * REGLA QUE NO SE ROMPE: un payload lleva IDENTIFICADORES Y NADA MAS.
 *
 * Y ENTRE ESOS IDENTIFICADORES VA EL `reservaId`, que es la fila de la que
 * cuelga la marca de idempotencia. No es opcional ni redundante con
 * `(perfilId, turnoId)`: `Reserva` NO tiene unique sobre `(tenantId, turnoId,
 * perfilId)` —un alumno puede reservar, cancelar y volver a reservar el mismo
 * turno—, asi que sin el id un processor tendria que ELEGIR una fila entre
 * varias, y dos jobs distintos podrian elegir la MISMA. El desarrollo esta en
 * la cabecera de `notificacion-reserva.processor.ts`.
 *
 * Nunca, bajo ninguna circunstancia, un `DatosSmtp` ni nada que salga de
 * `datosDeEnvio()`. Un job de BullMQ se serializa a Redis en JSON y se queda
 * ahi hasta que caduque: meter la credencial descifrada en el payload la
 * persiste en claro, la expone en cualquier panel de Bull y la deja fuera de
 * las cuatro puertas que la Task 5 cerro con tests.
 *
 * El SMTP se resuelve DENTRO del processor, que ya abre su contexto de tenant
 * y puede pedirlo. Cuesta una consulta y evita una fuga.
 *
 * La regla no vive solo en este comentario: `notificaciones.service.spec.ts`
 * comprueba con `toEqual` —forma exacta, no `objectContaining`— que lo que
 * llega a `cola.add` son estos campos y ni uno mas.
 */
/**
 * ⚠️ LOS PROCESSORS DE ESTAS COLAS TIENEN QUE SER IDEMPOTENTES. Se decide aqui
 * porque se decide aqui: `NotificacionesService.encolar` pone `attempts: 3`.
 *
 * Un job que falle DESPUES de haber mandado el email —al marcar la entrada de
 * la lista como notificada, al escribir el historial, por un timeout de la
 * base— se reintenta, y el reintento vuelve a mandarlo. Es el mismo aviso
 * fantasma que se saco de las transacciones de reserva, entrando por la otra
 * puerta: un alumno que recibe dos veces el mismo correo, o al que se le
 * confirma dos veces algo que pidio una.
 *
 * Quien escriba un processor (Tasks 8, 9 y 10) tiene que asumir que su `process`
 * puede ejecutarse dos veces con el MISMO payload, y comprobar antes de enviar
 * si el trabajo ya estaba hecho.
 *
 * DONDE ESTA LA MARCA DE LOS DOS PROCESSORS DE AVISO: en tres columnas
 * nullable de `Reserva` —`avisoConfirmacionEn`, `avisoCancelacionEn` y
 * `avisoCupoEn`—, escritas COMO COMPARE-AND-SET (`updateMany` con el termino
 * `...En: null` en el where, mandando solo si el `count` vale 1). No es un
 * detalle de estilo: ese termino del where es lo que hace atomica la pareja
 * comprobar+escribir, y sin el dos workers con el mismo job mandan los dos.
 * El razonamiento entero esta en la cabecera de cada processor.
 *
 * OJO CON `ListaEspera.notificado`: esta columna existe y parece ser esa marca,
 * pero NO SIRVE, y los dos processors de aviso lo dicen en su cabecera. La fila
 * se borra en `ListaEsperaService.asignarPrimero`, dentro de la transaccion que
 * crea la reserva, y el aviso se encola despues del commit: cuando el worker
 * llega, no hay fila que marcar.
 *
 * LOS DOS JOBS DIARIOS (`recordatorio-pago` y `vencimiento-pack`) SON OTRA
 * COSA: su marca es `gimnasiosHechos` en `job.updateData`, una lista de que
 * gimnasios ya se procesaron DENTRO de una tanda. No cuelga de ninguna reserva
 * y se queda donde esta.
 */
export interface DatosNotificacionReserva {
  tenantId: string;
  /** La fila que este aviso describe, y sobre la que se hace el compare-and-set. */
  reservaId: string;
  perfilId: string;
  turnoId: string;
  accion: 'CONFIRMACION' | 'CANCELACION';
}

export interface DatosNotificacionListaEspera {
  tenantId: string;
  /** La fila que este aviso describe, y sobre la que se hace el compare-and-set. */
  reservaId: string;
  perfilId: string;
  turnoId: string;
  entradaId: string;
}

/** Los diarios no llevan tenant: recorren todos. Ver la Task 10. */
export interface DatosDiarios {
  /** Inyectable para los tests; en produccion es el reloj del worker. */
  ahoraISO?: string;
}
