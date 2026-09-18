import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CrearComprobanteDto {
  /** Solo informativo: la clave real del archivo la genera el servidor. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombreOriginal!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  tipoMime!: string;
}
