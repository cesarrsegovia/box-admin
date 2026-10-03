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

  @IsOptional()
  @IsBoolean()
  devuelveClase?: boolean;

  // NO hay `devuelveClase`. Se borro en la Fase 6B: las clases perdidas no se
  // devuelven. Y como el ValidationPipe global corre con forbidNonWhitelisted,
  // mandarlo ahora es un 400 y no un campo ignorado en silencio, que es lo que
  // se quiere de un cambio de contrato visible.
}
