import { comparaHoras, fechaEnRango } from '@boxadmin/shared';

/** Lo que la funcion necesita saber de un horario. Nada mas. */
export interface HorarioParaResolver {
  id: string;
  profesorId: string;
  salaId: string;
  /** 0 = domingo ... 6 = sabado. */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

/**
 * ¿De quien es esta franja?
 *
 * PURA: no toca la base ni la cola. Es lo que permite que los once casos de su
 * spec sean tests de verdad y no un e2e disfrazado.
 *
 * La pertenencia es por CONTENCION, no por igualdad de `horaInicio`: un turno
 * que empieza a las 18:30 dentro de una franja contratada de 18:00 a 19:00 es
 * suyo. Es la misma nocion de solape con la que el alta rechaza dos horarios en
 * la misma sala, y las dos reglas tienen que decir lo mismo o el sistema se
 * contradice consigo mismo.
 */
export function resolverProfesorDeFranja(
  horarios: HorarioParaResolver[],
  salaId: string,
  fecha: Date,
  horaInicio: string,
): string | null {
  const diaSemana = fecha.getUTCDay();

  const coincidencias = horarios.filter(
    (h) =>
      h.salaId === salaId &&
      h.diaSemana === diaSemana &&
      // Dentro de [horaInicio, horaFin): el final pertenece a la clase siguiente.
      comparaHoras(horaInicio, h.horaInicio) >= 0 &&
      comparaHoras(horaInicio, h.horaFin) < 0 &&
      fechaEnRango(fecha, h.desde, h.hasta),
  );

  if (coincidencias.length === 0) return null;

  // Orden determinista. No deberia haber dos —el alta lo rechaza— pero si los
  // hubiera, republicar el mismo mes no puede dar profesoras distintas segun el
  // orden en que la base devolvio las filas.
  coincidencias.sort((a, b) => a.id.localeCompare(b.id));

  return coincidencias[0]!.profesorId;
}
