import { ArrayUnique, IsArray, IsString } from 'class-validator';

/**
 * Una FOTO de la clase entera, no un incremento: quien no esta en `presentes`
 * queda marcado como ausente. Asi pasar lista dos veces con la misma entrada da
 * el mismo resultado, y corregir un error es volver a mandar la lista buena.
 *
 * Un array vacio es valido y significa "no vino nadie".
 */
export class PasarListaDto {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  presentes!: string[];
}
