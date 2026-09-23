import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

export class CrearAlumnoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fichaMedica?: string;

  /**
   * Obligatorio como campo, pero puede venir vacio: un alta sin salas devuelve
   * 201 con la advertencia SIN_SALAS. Exigirlo en el DTO obliga al cliente a
   * tomar una decision consciente en vez de omitirlo sin darse cuenta.
   */
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;


  @IsOptional()
  @IsInt()
  @Min(0)
  clasesExtra?: number;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaHasta debe tener formato YYYY-MM-DD' })
  vigenciaHasta?: string;
}
