import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * El `codigo` NO se puede cambiar: es una credencial ya repartida, y rotarla
 * silenciosamente dejaria fuera a quien la tuviera. Para eso se desactiva esta
 * clave y se crea otra.
 */
export class ActualizarInvitacionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  /** Presente = reemplaza el conjunto entero. Debe traer al menos una sala. */
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  salaIds?: string[];

  @IsOptional()
  @IsString()
  packId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  usosMax?: number;

  @IsOptional()
  @IsISO8601()
  expiraEn?: string;
}
