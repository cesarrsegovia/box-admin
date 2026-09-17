import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

/**
 * Los mismos campos que al crear MENOS `perfilId` y `salaId`, a proposito: mover
 * una rutina de alumno o de sala por PATCH dejaria los turnos ya generados
 * colgando de un patron que ya no existe. Para eso se da de baja y se crea otra.
 */
export class ActualizarRutinaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  /** 0 = domingo ... 6 = sabado, igual que Date.getUTCDay(). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana?: number;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio?: string;

  @IsOptional()
  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
