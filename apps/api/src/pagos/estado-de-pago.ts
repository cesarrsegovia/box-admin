import { comienzoDeHoyUtc, fechaEnRango } from '@boxadmin/shared';

/** Lo que la regla necesita saber de un pago. Nada mas. */
export interface PagoParaEstado {
  esSena: boolean;
  cubreDesde: Date;
  cubreHasta: Date;
  anuladoEn: Date | null;
}

/**
 * ¿Esta este alumno al dia?
 *
 * PURA: no toca la base. Es la regla de negocio entera de la Fase 5A, y todo lo
 * que la pregunte —el listado de usuarios, el detalle y `mi-pack`— pasa por
 * aqui. Una sola implementacion, un solo sitio donde equivocarse.
 *
 * `hoy` se normaliza a medianoche UTC antes de comparar. `cubreDesde` y
 * `cubreHasta` son `@db.Date`, o sea medianoche; comparar contra un `hoy` con
 * hora dejaria fuera todo el ultimo dia del periodo, que es justo el dia en que
 * el alumno se acerca a pagar.
 */
export function estaAlDia(pagos: PagoParaEstado[], hoy: Date = new Date()): boolean {
  const dia = comienzoDeHoyUtc(hoy);

  return pagos.some((pago) => cuenta(pago, dia));
}

function cuenta(pago: PagoParaEstado, dia: Date): boolean {
  if (pago.anuladoEn !== null) return false;
  // Una sena reserva un lugar; no salda el periodo.
  if (pago.esSena) return false;

  return fechaEnRango(dia, pago.cubreDesde, pago.cubreHasta);
}
