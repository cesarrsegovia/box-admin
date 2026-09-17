import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';

export class CrearVacacionDto {
  @IsString()
  @IsNotEmpty()
  perfilId!: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;

  /**
   * Se almacena y NO se aplica en la Fase 2: con el conteo derivado de clases,
   * no generar la reserva ya equivale a no gastarla. Ver D3 del spec.
   */
  @IsOptional()
  @IsBoolean()
  devuelveClase?: boolean;
}
