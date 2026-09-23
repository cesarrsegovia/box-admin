// ---------------------------------------------------------------------------
// Fase 5A — El ciclo de cobro
// ---------------------------------------------------------------------------

export type MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'CORTESIA' | 'OTRO';

/**
 * Un pago ya registrado.
 *
 * `monto` viaja como string con dos decimales, nunca como number: es dinero, y
 * un float binario no representa 25000.10 exactamente. Misma regla que el
 * precio de los packs desde la Fase 1.
 */
export interface PagoPublico {
  id: string;
  tenantId: string;
  perfilId: string;
  monto: string;
  metodo: MetodoPago;
  /** Una sena reserva un lugar; no pone al alumno al dia. */
  esSena: boolean;
  /** `YYYY-MM-DD`. */
  cubreDesde: string;
  cubreHasta: string;
  comprobanteId: string | null;
  /** Id del usuario que lo registro. */
  registradoPor: string;
  nota: string | null;
  /** ISO 8601 completo, o `null` si sigue vigente. */
  anuladoEn: string | null;
  anuladoPor: string | null;
  createdAt: string;
}
