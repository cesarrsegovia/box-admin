import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * Un mes concreto de un gimnasio. Nada mas.
 *
 * `@Type(() => Number)` es imprescindible y no decorativo: un query param llega
 * siempre como string, y sin la transformacion `@IsInt` rechazaria incluso un
 * `?mes=10` perfectamente valido. El ValidationPipe global corre con
 * `transform: true`, asi que el DTO llega al service ya con numeros.
 *
 * LOS LIMITES ESTAN AQUI Y NO EN EL SERVICE porque un mes 13 no es una peticion
 * que se pueda contestar de otra forma: es un 400. Distinto del tope de
 * `mesesAdelante` de la Task 7, que si tiene respuesta razonable ("te doy uno")
 * y por eso se topea en el service.
 *
 * NO HAY `salaId`, Y SU AUSENCIA ES LA FUNCIONALIDAD. El ValidationPipe global
 * corre con `forbidNonWhitelisted`, asi que mandar `?salaId=` devuelve 400 en
 * vez de aceptarse y no hacer nada. El porque esta en el docblock de
 * `StatsService.caja`.
 */
export class ConsultaMensualDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2200)
  anio!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  mes!: number;
}
