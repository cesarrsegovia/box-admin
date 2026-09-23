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
 * OJO CON `ListaEspera.notificado`: esta columna existe y parece ser esa marca,
 * pero NO SIRVE, y los dos processors de aviso lo dicen en su cabecera. La fila
 * se borra en `ListaEsperaService.asignarPrimero`, dentro de la transaccion que
 * crea la reserva, y el aviso se encola despues del commit: cuando el worker
 * llega, no hay fila que marcar. Hoy la marca de los dos vive en el propio job
 * (`job.updateData`), y su sitio definitivo es una columna de `Reserva`.
 */
export interface DatosNotificacionReserva {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  accion: 'CONFIRMACION' | 'CANCELACION';
}

export interface DatosNotificacionListaEspera {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  entradaId: string;
}

/** Los diarios no llevan tenant: recorren todos. Ver la Task 10. */
export interface DatosDiarios {
  /** Inyectable para los tests; en produccion es el reloj del worker. */
  ahoraISO?: string;
}
