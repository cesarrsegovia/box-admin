export const GENERACION_MES_QUEUE = 'generacion-mes-queue';

/**
 * Lo que viaja en el job.
 *
 * `tenantId` es un DATO DE SEGURIDAD: el worker no tiene request ni JWT, asi que
 * es lo unico que le dice sobre que gimnasio puede operar. Lo pone el controller
 * a partir del token del actor, NUNCA del cuerpo de la peticion.
 */
export interface DatosGeneracionMes {
  tenantId: string;
  salaId: string;
  anio: number;
  mes: number;
  actorId: string;
}
