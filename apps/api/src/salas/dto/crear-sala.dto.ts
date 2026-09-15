import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CrearSalaDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  @IsOptional()
  @IsBoolean()
  visibleAlumnos?: boolean;

  @IsOptional()
  @IsBoolean()
  soloCuposLiberados?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusiva?: boolean;

  // null explicito = "hereda del tenant". Por eso son opcionales y no tienen
  // default aqui: el default vive en el schema o en la herencia, no en el DTO.
  @IsOptional()
  @IsInt()
  @Min(1)
  cupoBase?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosCancelar?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minMinutosAnotarse?: number;

  @IsOptional()
  @IsBoolean()
  listaEsperaHabilitada?: boolean;
}
