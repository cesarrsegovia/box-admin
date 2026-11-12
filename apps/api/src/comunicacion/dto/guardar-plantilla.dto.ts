import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

export class GuardarPlantillaDto {
  @Recortado()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  asunto!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  cuerpoHtml!: string;
}
