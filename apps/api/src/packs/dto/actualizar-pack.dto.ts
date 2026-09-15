import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import type { TipoPack } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_PRECIO = /^\d{1,8}(\.\d{1,2})?$/;

/** Todos los campos son opcionales: un PATCH toca solo lo que trae. */
export class ActualizarPackDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  /** `undefined` = no se toca. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  salaId?: string;

  @IsOptional()
  @IsIn(['MENSUAL', 'TOTAL'])
  tipo?: TipoPack;

  /**
   * String, nunca number: un float binario no representa 12500.10 exactamente y
   * esto es dinero.
   */
  @IsOptional()
  @Matches(PATRON_PRECIO, {
    message: 'precio debe ser un numero con hasta 2 decimales, como "12500.00"',
  })
  precio?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  clasesPorMes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  clasesTotales?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancelacionesPermitidas?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
