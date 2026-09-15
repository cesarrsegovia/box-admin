import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

/**
 * Edicion de perfil. Acepta los campos de alumno, pero el service los rechaza
 * con 400 si el usuario es PROFESOR: el DTO es uno solo porque la ruta es una
 * sola, y la separacion que importa —la del alta— ya esta hecha en dos DTOs.
 */
export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  fichaMedica?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  packId?: string;

  @IsOptional()
  @IsBoolean()
  pagoAlDia?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  clasesExtra?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancelacionesUsadas?: number;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaDesde debe tener formato YYYY-MM-DD' })
  vigenciaDesde?: string;

  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'vigenciaHasta debe tener formato YYYY-MM-DD' })
  vigenciaHasta?: string;
}
