import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * El alta de profesor NO acepta packId, clasesExtra, cancelaciones, pagoAlDia ni
 * vigencias. No es que los ignore: con `forbidNonWhitelisted: true` en el
 * ValidationPipe global, mandarlos devuelve 400.
 *
 * Esta es exactamente la limitacion de TurnoFit que la Fase 1 viene a romper —
 * alli el alta de profesor arrastraba campos de alumno y podia exigir "clases
 * mensuales" a alguien que da la clase.
 */
export class CrearProfesorDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombreCompleto!: string;

  @IsEmail()
  @MaxLength(180)
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  salaIds!: string[];
}
