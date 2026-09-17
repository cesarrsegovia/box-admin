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

export class CrearRutinaDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  @IsString()
  @IsNotEmpty()
  salaId!: string;

  /** Nombre del turno que generara esta rutina. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /** 0 = domingo ... 6 = sabado, igual que Date.getUTCDay(). */
  @IsInt()
  @Min(0)
  @Max(6)
  diaSemana!: number;

  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio!: string;

  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin!: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  /** Ausente = rutina indefinida. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}
