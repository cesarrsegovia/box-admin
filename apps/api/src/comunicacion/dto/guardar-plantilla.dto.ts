import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class GuardarPlantillaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  asunto!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  cuerpoHtml!: string;
}
