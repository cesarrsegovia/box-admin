import { IsString, ValidateIf } from 'class-validator';

/**
 * `profesorId: null` es un valor legitimo —quitar la profesora del turno—, asi
 * que no vale con @IsOptional: hay que aceptar el null explicito y distinguirlo
 * de "no vino la clave".
 */
export class AsignarProfesorDto {
  @ValidateIf((_objeto, valor) => valor !== null)
  @IsString()
  profesorId!: string | null;
}
