import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA, type MetodoPago } from '@boxadmin/shared';

/** Hasta 8 enteros y como mucho 2 decimales: encaja en DECIMAL(10, 2). */
const PATRON_MONTO = /^\d{1,8}(\.\d{1,2})?$/;

const METODOS: MetodoPago[] = ['EFECTIVO', 'TRANSFERENCIA', 'CORTESIA', 'OTRO'];

/**
 * Aprobar deja de ser un clic: el admin esta mirando la foto de la
 * transferencia y es el unico que sabe de cuanto era y hasta cuando vale.
 *
 * `rechazar` sigue usando RevisarComprobanteDto, que solo lleva nota: rechazar
 * no mueve dinero.
 */
export class AprobarComprobanteDto {
  @Matches(PATRON_MONTO, {
    message: 'monto debe ser un numero con hasta 2 decimales, como "25000.00"',
  })
  monto!: string;

  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta!: string;

  /** Por defecto TRANSFERENCIA, que es lo que un comprobante es casi siempre. */
  @IsOptional()
  @IsIn(METODOS)
  metodo?: MetodoPago;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
