import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * `@ArrayNotEmpty` es el punto entero de este DTO.
 *
 * El alta admite cero salas y devuelve una advertencia, porque ahi puede faltar
 * informacion legitimamente. Pero una peticion cuyo unico proposito es fijar
 * las salas y que manda cero es siempre un error. Guardarla en silencio es el
 * bug de "Sin sala" de Wellness, y aqui se cierra con un 400.
 */
export class ActualizarSalasDto {
  @IsArray()
  @ArrayNotEmpty({
    message:
      'Un usuario sin salas no puede reservar nada. Manda al menos una sala, ' +
      'o da de baja al usuario si es lo que querias.',
  })
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];
}
