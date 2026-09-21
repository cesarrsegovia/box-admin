import { aFechaISO, desdeFechaISO } from '@boxadmin/shared';

/**
 * Aritmetica de semanas, en UTC.
 *
 * Todo el sistema trata las fechas como UTC desde la Fase 1 —los turnos son
 * columnas `@db.Date` y las horas son cadenas "HH:MM"—, asi que mezclar aqui la
 * zona local del navegador haria que un alumno en otro huso viera la semana
 * corrida un dia.
 */

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export interface Semana {
  desde: string;
  hasta: string;
}

/** La semana (lunes a domingo) a la que pertenece una fecha. */
export function semanaDe(fecha: string): Semana {
  const dia = desdeFechaISO(fecha);
  // getUTCDay: 0 = domingo. Se convierte a "dias desde el lunes", donde el
  // domingo es 6 y no 0: sin esto, el domingo saltaria solo a la semana
  // siguiente.
  const desdeElLunes = (dia.getUTCDay() + 6) % 7;

  const lunes = new Date(dia.getTime() - desdeElLunes * MS_POR_DIA);
  const domingo = new Date(lunes.getTime() + 6 * MS_POR_DIA);

  return { desde: aFechaISO(lunes), hasta: aFechaISO(domingo) };
}

export function sumarSemanas(fecha: string, semanas: number): string {
  return aFechaISO(new Date(desdeFechaISO(fecha).getTime() + semanas * 7 * MS_POR_DIA));
}

/** Los siete dias de la semana que empieza en `lunes`, en orden. */
export function diasDeLaSemana(lunes: string): string[] {
  const inicio = desdeFechaISO(lunes);

  return Array.from({ length: 7 }, (_, i) =>
    aFechaISO(new Date(inicio.getTime() + i * MS_POR_DIA)),
  );
}
