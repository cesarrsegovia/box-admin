import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { PATRON_FECHA, type MetodoPago } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

const METODOS: MetodoPago[] = ['EFECTIVO', 'TRANSFERENCIA', 'CORTESIA', 'OTRO'];

export class CrearPagoDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  /**
   * String, nunca number: es dinero, y un float binario no representa 25000.10
   * exactamente. Misma regla que el precio de los packs desde la Fase 1.
   */
  @Matches(PATRON_MONTO, {
    message: 'monto debe ser un numero con hasta 2 decimales, como "25000.00"',
  })
  monto!: string;

  @IsIn(METODOS)
  metodo!: MetodoPago;

  @Matches(PATRON_FECHA, { message: 'cubreDesde debe tener formato YYYY-MM-DD' })
  cubreDesde!: string;

  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta!: string;

  @IsOptional()
  @IsBoolean()
  esSena?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  comprobanteId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
