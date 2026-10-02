import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { MAX_LARGO_ID, PATRON_ID } from './patron-id';

/**
 * Donde hay lugar, de aqui a unos meses.
 *
 * EL `salaId` SI VA, igual que en el operativo y al reves que en la caja: un
 * `Turno` tiene sala propia, asi que acotar no exige inventar ninguna regla de
 * atribucion. Y aqui es ademas el uso natural del reporte —"donde meto a este
 * alumno los martes"—, que es una pregunta de una sala concreta.
 *
 * EL TOPE DE `mesesAdelante` NO ESTA AQUI, Y ES LA DECISION DEL DTO. Un
 * `@Max(12)` devolveria 400 a quien pida 24, y la respuesta correcta a "dame
 * dos anos" no es un error: es "te doy uno". El tope vive en el service, que es
 * quien puede recortar y seguir contestando. Ver `StatsService.turnosLibres`.
 *
 * EL PISO SI ESTA AQUI, y la asimetria es a proposito: `mesesAdelante=0` o un
 * negativo no tienen ninguna respuesta razonable que dar —no existe "mirar
 * hacia atras" en un reporte de turnos futuros—, asi que es un 400. Es el mismo
 * criterio que separa el `@Max(12)` del mes (un mes 13 no se puede contestar)
 * del tope de este parametro.
 */
export class ConsultaTurnosLibresDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_LARGO_ID)
  @Matches(PATRON_ID, { message: 'salaId debe ser un identificador valido' })
  salaId?: string;

  /**
   * `@Type(() => Number)` es imprescindible y no decorativo: un query param
   * llega siempre como string, y sin la transformacion `@IsInt` rechazaria
   * incluso un `?mesesAdelante=3` perfectamente valido.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  mesesAdelante?: number;
}
