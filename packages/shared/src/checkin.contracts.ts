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
