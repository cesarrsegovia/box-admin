import {
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class GuardarSmtpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  host!: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  puerto!: number;

  @IsOptional()
  @IsBoolean()
  seguro?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  usuario!: string;

  /**
   * En claro SOLO aqui, de camino al cifrado. Nunca vuelve al cliente y nunca
   * se loguea.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  clave!: string;

  @IsEmail()
  @MaxLength(180)
  emailOrigen!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  emailDestino?: string;
}
