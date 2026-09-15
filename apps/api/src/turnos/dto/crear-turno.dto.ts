import { IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min } from 'class-validator';
import { PATRON_FECHA, PATRON_HORA } from '@boxadmin/shared';

export class CrearTurnoDto {
  @IsString()
  @IsNotEmpty()
  salaId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  @Matches(PATRON_FECHA, { message: 'fecha debe tener formato YYYY-MM-DD' })
  fecha!: string;

  @Matches(PATRON_HORA, { message: 'horaInicio debe tener formato HH:MM en 24 h' })
  horaInicio!: string;

  @Matches(PATRON_HORA, { message: 'horaFin debe tener formato HH:MM en 24 h' })
  horaFin!: string;

  @IsInt()
  @Min(1)
  cupo!: number;
}
