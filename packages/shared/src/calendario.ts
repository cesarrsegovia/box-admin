import { comparaHoras, FechaInvalidaError } from './fechas';

/** Medianoche UTC del dia 1 del mes. */
export function primerDiaDelMesUtc(anio: number, mes: number): Date {
  exigirMesValido(mes);
  return new Date(Date.UTC(anio, mes - 1, 1));
}

/**
 * Medianoche UTC del ultimo dia del mes.
 *
 * El dia 0 del mes SIGUIENTE es el ultimo de este, y `Date.UTC` normaliza solo:
 * asi no hay que saberse cuantos dias tiene febrero ni que anios son bisiestos.
 */
export function ultimoDiaDelMesUtc(anio: number, mes: number): Date {
  exigirMesValido(mes);
  return new Date(Date.UTC(anio, mes, 0));
}

export function diasDelMes(anio: number, mes: number): number {
  return ultimoDiaDelMesUtc(anio, mes).getUTCDate();
}

/**
 * Todas las fechas del mes que caen en `diaSemana` (0 = domingo ... 6 = sabado),
 * a medianoche UTC para poder compararlas con las columnas `@db.Date` de Prisma.
 */
export function fechasDelMesEnDiaSemana(anio: number, mes: number, diaSemana: number): Date[] {
  exigirMesValido(mes);
  if (!Number.isInteger(diaSemana) || diaSemana < 0 || diaSemana > 6) {
    throw new RangeError(`diaSemana debe estar entre 0 y 6, y llego ${diaSemana}`);
  }

  const total = diasDelMes(anio, mes);
  const fechas: Date[] = [];

  for (let dia = 1; dia <= total; dia++) {
    const fecha = new Date(Date.UTC(anio, mes - 1, dia));
    if (fecha.getUTCDay() === diaSemana) fechas.push(fecha);
  }

  return fechas;
}

/**
 * ¿Cae esta fecha dentro del rango, con los dos extremos incluidos?
 *
 * Un `hasta` nulo significa "sin limite por ese lado", que es como se modelan
 * tanto las rutinas indefinidas como los horarios de profesora sin fecha de fin.
 */
export function fechaEnRango(fecha: Date, desde: Date, hasta: Date | null): boolean {
  if (fecha.getTime() < desde.getTime()) return false;
  return hasta === null || fecha.getTime() <= hasta.getTime();
}

/**
 * ¿Se solapan dos rangos de fechas, con los extremos incluidos?
 *
 * Un `hasta` nulo significa "sin limite por ese lado", que es como se modelan
 * las rutinas indefinidas.
 */
export function rangosSeSolapan(
  desdeA: Date,
  hastaA: Date | null,
  desdeB: Date,
  hastaB: Date | null,
): boolean {
  const finA = hastaA?.getTime() ?? Number.POSITIVE_INFINITY;
  const finB = hastaB?.getTime() ?? Number.POSITIVE_INFINITY;

  return desdeA.getTime() <= finB && desdeB.getTime() <= finA;
}

/**
 * ¿Se pisan dos tramos horarios del mismo dia?
 *
 * Los extremos NO cuentan: un tramo que termina a las 19:00 y otro que empieza
 * a las 19:00 son consecutivos, no simultaneos. Sin esa exclusion, dos clases
 * seguidas en la misma sala se rechazarian como solape.
 */
export function horasSeSolapan(
  inicioA: string,
  finA: string,
  inicioB: string,
  finB: string,
): boolean {
  return comparaHoras(inicioA, finB) < 0 && comparaHoras(inicioB, finA) < 0;
}

function exigirMesValido(mes: number): void {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new FechaInvalidaError(`mes ${String(mes)}`);
  }
}
