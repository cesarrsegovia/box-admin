/**
 * Contratos del check-in por QR (Fase 6B).
 *
 * El QR es ESTATICO, firmado, impreso y pegado en la pared: garantiza
 * comodidad, no presencia. La ventana horaria acota *cuando*, no *donde*. El
 * dia que la asistencia tenga que probar presencia hara falta un QR que rote en
 * una pantalla, y eso es otro diseno.
 */

/**
 * La ventana alrededor del INICIO del turno, en minutos.
 *
 * Un gimnasio sin fila de configuracion usa quince y quince: la ausencia de
 * configuracion no puede ser un check-in roto.
 */
export interface ConfigCheckIn {
  minutosAntes: number;
  minutosDespues: number;
}

/** Lo que se le devuelve al alumno cuando queda marcado. */
export interface PresenteMarcado {
  reservaId: string;
  turnoId: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM`. */
  horaInicio: string;
  /**
   * El nombre de la clase. Sale de `Turno.nombre`: la columna se llama
   * `nombre`, y "clase" es como se le dice de cara al alumno, igual que en las
   * plantillas de email de la Fase 5B (`{{clase}}`).
   */
  clase: string;
  /** ISO-8601 del instante exacto en que se marco. */
  marcadaEn: string;
}

/**
 * Por que no se pudo marcar. Viaja en el cuerpo del 409.
 *
 * SON DISTINGUIBLES A PROPOSITO: son datos del propio alumno, asi que decirle
 * cual de los cuatro no filtra nada y le ahorra una llamada a recepcion. "No se
 * pudo marcar" lo manda a preguntar; "llegaste 40 minutos tarde" no.
 *
 * ESTA LISTA ES EL CONTRATO, y por eso vive aqui y no dentro del modulo de la
 * API: la pantalla de check-in tiene que ramificar sobre los cuatro, y si cada
 * lado escribiera sus propias cadenas habria dos listas que tienen que
 * coincidir y nadie las compara.
 *
 * - `sin-reserva`: no tiene ninguna reserva viva cerca.
 * - `fuera-de-ventana`: tiene una, pero el reloj esta fuera de su ventana.
 * - `ya-marcada`: ya paso por este mismo check-in.
 * - `lista-ya-pasada`: la profesora ya paso lista en esa clase. NO es lo mismo
 *   que `ya-marcada` y no se pueden fusionar: decirle "ya marcaste" a quien no
 *   marco lo manda a buscar un problema que no existe. Lo que tiene que hacer
 *   es hablar con su profesora, que es quien puede corregirlo.
 */
export type MotivoDeRechazoDeCheckIn =
  'sin-reserva' | 'fuera-de-ventana' | 'ya-marcada' | 'lista-ya-pasada';

/**
 * El cuerpo del 409 de `POST /checkin`.
 *
 * Los tres campos de la clase viajan en todos los motivos MENOS en
 * `sin-reserva`, que es el unico sin candidata de la que hablar.
 */
export interface CheckInRechazado {
  motivo: MotivoDeRechazoDeCheckIn;
  /** Texto ya redactado para mostrarle al alumno. */
  message: string;
  clase?: string;
  /** `YYYY-MM-DD`. */
  fecha?: string;
  /** `HH:MM`. */
  horaInicio?: string;
}
