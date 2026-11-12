import { IsEmail, IsNotEmpty, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Recortado } from '../../common/decorators/recortado.decorator';

/**
 * El DTO NO acepta `rol`, y el ValidationPipe global corre con
 * `forbidNonWhitelisted: true`: mandar `rol` en el cuerpo devuelve 400 antes de
 * llegar al servicio. El servicio ademas lo fija a ALUMNO por su cuenta, porque
 * una sola linea de defensa en un endpoint publico no es suficiente.
 */
export class AutoRegistroDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  tenantSlug!: string;

  /** 32 caracteres hexadecimales generados por el servidor al crear la clave. */
  @IsString()
  @Length(32, 32)
  codigo!: string;

  @Recortado()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
