import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

/**
 * El override del admin. `alDia: true` crea una cortesia que cubre hasta la
 * fecha indicada; `alDia: false` anula las cortesias vigentes y NO toca los
 * pagos reales.
 */
export class EstadoPagoDto {
  @IsBoolean()
  alDia!: boolean;

  /** Obligatorio cuando `alDia` es true. Lo comprueba el servicio. */
  @IsOptional()
  @Matches(PATRON_FECHA, { message: 'cubreHasta debe tener formato YYYY-MM-DD' })
  cubreHasta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  nota?: string;
}
