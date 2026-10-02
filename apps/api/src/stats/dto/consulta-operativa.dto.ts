import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ConsultaMensualDto } from './consulta-mensual.dto';
import { MAX_LARGO_ID, PATRON_ID } from './patron-id';

/**
 * El mes del reporte operativo, con la sala opcional.
 *
 * AQUI EL `salaId` SI VA, y no es una incoherencia con `ConsultaMensualDto`:
 * un `Turno` tiene sala propia, asi que acotar las metricas que cuentan clases
 * no exige inventar ninguna regla de atribucion. Un `Pago` no tiene sala y por
 * eso la caja lo rechaza. El razonamiento entero esta en el docblock de
 * `StatsService.caja`.
 *
 * Hereda `anio` y `mes` en vez de repetirlos: son el mismo mes con los mismos
 * limites, y dos copias de `@Min(1) @Max(12)` son dos copias que algun dia
 * discrepan.
 */
export class ConsultaOperativaDto extends ConsultaMensualDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LARGO_ID)
  @Matches(PATRON_ID, { message: 'salaId debe ser un identificador valido' })
  salaId?: string;
}
