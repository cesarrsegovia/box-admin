import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

/** Ver `CrearTestimonioDto`. */
const MAXIMO_ORDEN = 100_000;

export class CrearFaqDto {
  @Recortado()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  pregunta!: string;

  /** Texto, nunca HTML. Ver `CrearTestimonioDto.texto`. */
  @Recortado()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  respuesta!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAXIMO_ORDEN)
  orden?: number;
}
