import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Tope del `orden`. No es una restriccion del dominio: es que la columna es un
 * `Int` de Postgres y un numero mayor que 2^31-1 revienta con un error del
 * driver en vez de con un 400.
 */
const MAXIMO_ORDEN = 100_000;

export class CrearTestimonioDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  nombre!: string;

  /**
   * Se guarda y se muestra COMO TEXTO, nunca como HTML: es la primera vez en el
   * proyecto que algo escrito por un usuario se renderiza en una pagina publica
   * sin sesion. No se sanea aqui a proposito —sanear al guardar destruye el
   * dato original— ; la garantia la da que la landing nunca use
   * `dangerouslySetInnerHTML`.
   */
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  texto!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAXIMO_ORDEN)
  orden?: number;
}
