import {
  ArrayNotEmpty,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CrearInvitacionDto {
  /** Para que el admin reconozca la clave en su listado. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /**
   * Las salas que otorga. Obligatorias y al menos una: una clave sin salas
   * produce alumnos que no pueden reservar nada.
   */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  salaIds!: string[];

  /** Ausente = el alumno queda sin pack, y el admin se lo asigna despues. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;

  /** Ausente = ilimitada. */
  @IsOptional()
  @IsInt()
  @Min(1)
  usosMax?: number;

  /** Ausente = no caduca. */
  @IsOptional()
  @IsISO8601()
  expiraEn?: string;
}
