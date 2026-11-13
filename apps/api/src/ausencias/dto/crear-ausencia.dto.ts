import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';
import { Recortado } from '../../common/decorators/recortado.decorator';

export class CrearAusenciaDto {
  /** Ausente = cierra todo el salon. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  salaId?: string;

  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @Recortado()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  motivo?: string;
}
