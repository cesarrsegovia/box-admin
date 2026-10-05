import { IsInt, Max, Min } from 'class-validator';

/**
 * El tope de la ventana, en minutos.
 *
 * Doce horas a cada lado. No es una restriccion tecnica: es que una ventana
 * mayor deja de ser una ventana y vuelve el check-in una lista de asistencia
 * que se puede firmar en cualquier momento del dia. Y un numero sin tope
 * convierte un cero de mas en "siempre abierto" sin que nadie lo note.
 */
const MAXIMO_MINUTOS = 720;

export class GuardarConfigQrDto {
  /** Cero es valido: significa "solo a partir de la hora exacta del inicio". */
  @IsInt()
  @Min(0)
  @Max(MAXIMO_MINUTOS)
  minutosAntes!: number;

  @IsInt()
  @Min(0)
  @Max(MAXIMO_MINUTOS)
  minutosDespues!: number;
}
