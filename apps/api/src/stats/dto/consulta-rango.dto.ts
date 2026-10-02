import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PATRON_FECHA } from '@boxadmin/shared';
import { MAX_LARGO_ID, PATRON_ID } from './patron-id';

/**
 * Un rango de dias, y opcionalmente un alumno.
 *
 * DOS CORRECCIONES SOBRE LA FORMA QUE TRAIA EL PLAN:
 *
 * - `@IsDateString()` por `@Matches(PATRON_FECHA)`. `@IsDateString` acepta un
 *   ISO 8601 COMPLETO, asi que `?desde=2026-10-01T12:00:00Z` pasaria la
 *   validacion y llegaria al service, donde `desdeFechaISO` lo rechaza con una
 *   `FechaInvalidaError` que nadie traduce: un 500 opaco en vez de un 400. Los
 *   otros nueve DTOs con fechas del repositorio usan `PATRON_FECHA` desde la
 *   Fase 1; este no iba a ser el decimo distinto.
 *
 *   Lo que este parrafo decia ADEMAS y era falso: que los `:` del timestamp
 *   llegarian a la clave del cache. No llegan — `desdeFechaISO` lanza antes de
 *   `cache.recordar`, y la clave se arma con las fechas ya reescritas desde un
 *   `Date`. Lo comprobo una revision. El 500 opaco si es real, y alcanza.
 * - `@IsString()` por el patron de id en `perfilId`. Es el mismo valor que el
 *   `salaId` del operativo —texto de la query que entra en una clave de
 *   Redis— y la regla "a la clave solo van valores ya validados" no distingue
 *   entre un id de sala y uno de perfil.
 *
 * EL RANGO INVERTIDO NO SE VALIDA AQUI, y es a proposito: `desde > hasta` es
 * una relacion ENTRE dos campos, y los validadores de class-validator miran uno
 * solo. Escribirlo con un validador custom pondria la unica regla interesante
 * de este DTO en un decorador que nadie lee. Lo rechaza el service, con su caso
 * propio. El tope de longitud del rango tambien vive alli, por el mismo motivo
 * que el de `mesesAdelante`: recortar y contestar es mejor respuesta que un
 * error.
 */
export class ConsultaRangoDto {
  @IsString()
  @Matches(PATRON_FECHA, { message: 'desde debe tener formato YYYY-MM-DD' })
  desde!: string;

  @IsString()
  @Matches(PATRON_FECHA, { message: 'hasta debe tener formato YYYY-MM-DD' })
  hasta!: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_LARGO_ID)
  @Matches(PATRON_ID, { message: 'perfilId debe ser un identificador valido' })
  perfilId?: string;
}
