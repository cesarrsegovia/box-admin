import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

/**
 * Sin `salaId` a proposito: mover un turno de sala invalidaria los accesos de
 * quienes ya reservaron. Si hace falta, se borra el turno y se recrea.
 */
export class ActualizarTurnoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cupo?: number;
}
