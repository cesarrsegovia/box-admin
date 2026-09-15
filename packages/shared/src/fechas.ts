/** `YYYY-MM-DD`, sin hora ni huso. */
export const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM` en 24 h. */
export const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class FechaInvalidaError extends Error {
  constructor(recibido: string) {
    super(
      `Se esperaba una fecha con formato YYYY-MM-DD y se recibio ${JSON.stringify(recibido)}.`,
    );
    this.name = 'FechaInvalidaError';
  }
}

/**
 * Parte de fecha de un `Date`, en UTC.
 *
 * Las columnas `@db.Date` de Prisma vuelven como `Date` a medianoche UTC. Usar
 * `toISOString().slice(0, 10)` y no `getFullYear()` es deliberado: los getters
 * locales desplazarian el dia en cualquier maquina al oeste de Greenwich.
 */
export function aFechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Convierte `"YYYY-MM-DD"` en la medianoche UTC de ese dia.
 *
 * Valida el ida y vuelta, no solo el patron: asi se rechaza `2026-02-31` en vez
 * de dejar que se convierta silenciosamente en el 3 de marzo.
 */
export function desdeFechaISO(iso: string): Date {
  if (!PATRON_FECHA.test(iso)) throw new FechaInvalidaError(iso);

  const fecha = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || aFechaISO(fecha) !== iso) {
    throw new FechaInvalidaError(iso);
  }

  return fecha;
}

export function esFechaValida(iso: string): boolean {
  try {
    desdeFechaISO(iso);
    return true;
  } catch {
    return false;
  }
}

export function esHoraValida(hora: string): boolean {
  return PATRON_HORA.test(hora);
}

/**
 * Compara dos horas `HH:MM`. Con ceros a la izquierda y 24 h, el orden
 * lexicografico coincide con el cronologico, asi que no hace falta parsear.
 */
export function comparaHoras(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Medianoche UTC de hoy. Util para "turnos futuros". */
export function comienzoDeHoyUtc(ahora: Date = new Date()): Date {
  return desdeFechaISO(aFechaISO(ahora));
}
