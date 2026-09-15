import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ActualizarSalaDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activa?: boolean;

  @IsOptional()
  @IsBoolean()
  visibleAlumnos?: boolean;

  @IsOptional()
  @IsBoolean()
  soloCuposLiberados?: boolean;

  @IsOptional()
  @IsBoolean()
  exclusiva?: boolean;

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
