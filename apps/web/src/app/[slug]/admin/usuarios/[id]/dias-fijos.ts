import { z } from 'zod';
import { comparaHoras, PATRON_FECHA, PATRON_HORA, type RutinaPublica } from '@boxadmin/shared';

/**
 * Lo que comparten el alta de un dia fijo y su edicion: como se nombra un dia,
 * y que campos y reglas tiene una rutina. Una sola copia: si el alta y la
 * edicion discreparan en una regla, el mismo horario valdria en una y no en la otra.
 */

/** Indexado por `DiaSemana`: 0 = domingo, como `Date.getUTCDay()`. */
export const NOMBRES_DE_DIA: readonly string[] = [
  'domingo',
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
];

export function conMayuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** En orden de semana (el lunes primero): lo que ofrece un `<select>` de dia. */
export const OPCIONES_DE_DIA = [1, 2, 3, 4, 5, 6, 0].map((dia) => ({
  valor: String(dia),
  texto: conMayuscula(NOMBRES_DE_DIA[dia] ?? ''),
}));

/** "martes de 18:00 a 19:00". En minusculas: se interpola dentro de frases. */
export function descripcionDe(rutina: RutinaPublica): string {
  return `${NOMBRES_DE_DIA[rutina.diaSemana] ?? ''} de ${rutina.horaInicio} a ${rutina.horaFin}`;
}

/**
 * Los campos de una rutina, TODOS como texto: un `<select>` y un `<input>`
 * siempre devuelven texto, y el dia es un numero recien en el cuerpo.
 */
export const esquemaBase = z.object({
  nombre: z.string().min(1, 'El turno necesita un nombre').max(80, 'Como mucho 80 caracteres'),
  diaSemana: z.string(),
  horaInicio: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
  horaFin: z.string().regex(PATRON_HORA, 'La hora va como HH:MM'),
  desde: z.string().regex(PATRON_FECHA, 'La fecha va como YYYY-MM-DD'),
});

/** El fin es posterior al inicio. Va con `REGLA_DE_HORAS` en un `.refine`. */
export function finDespuesDeInicio(datos: { horaInicio: string; horaFin: string }): boolean {
  return comparaHoras(datos.horaFin, datos.horaInicio) > 0;
}

export const REGLA_DE_HORAS = {
  path: ['horaFin'],
  message: 'La hora de fin tiene que ser despues de la de inicio',
};
