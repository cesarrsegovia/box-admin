import type { Logger } from '@nestjs/common';
import { comienzoDeHoyUtc } from '@boxadmin/shared';
import type { PrismaService } from '../../prisma/prisma.service';

/** Los jobs diarios que marcan en `AvisoDiario`. Es la columna `tipo`. */
export type TipoAvisoDiario = 'recordatorio-pago' | 'vencimiento-pack';

/**
 * ¿Este error es la clave unica `(tenantId, tipo, perfilId, dia)` violada?
 *
 * Las DOS formas, como en `checkin.service.ts` y `publicacion.service.ts`: con
 * el adapter `pg` de Prisma 7 la unicidad puede llegar como DriverAdapterError
 * con `cause.kind` y SIN `code`. Mirar solo `code` mandaria a esa persona por la
 * rama de "fallo raro": tambien se salta, pero con un error falso en el log.
 */
function esDuplicado(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const { code, name, cause } = error as { code?: unknown; name?: unknown; cause?: unknown };
  if (code === 'P2002') return true;

  if (name !== 'DriverAdapterError' || typeof cause !== 'object' || cause === null) return false;
  return (cause as { kind?: unknown }).kind === 'UniqueConstraintViolation';
}

/**
 * Inserta la marca de «ya avisado hoy» de UNA persona y dice si hay que
 * mandarle el aviso. El porque entero —por que por persona, por que antes de
 * mandar, que se pierde en un corte— esta en la cabecera de
 * `recordatorio-pago.processor.ts`.
 *
 * - `true`: la marca entro; mandar.
 * - `false` por la clave unica: ya se le aviso hoy (una ejecucion anterior del
 *   mismo job, re-encolado por atasco). Se salta en silencio: es el caso normal
 *   de la re-ejecucion, no un error.
 * - `false` por cualquier otro error: NO SE SABE si ya se le aviso, y mandar sin
 *   marca es justo lo que puede duplicar. Se registra y se salta. NO se propaga:
 *   un fallo con una persona no puede costarle el aviso a las que faltan.
 *
 * Tiene que correr DENTRO del `runWithTenant` del gimnasio: la extension pone el
 * `tenantId` (se pasa igual porque el tipo generado lo exige) y la FK compuesta
 * contra `perfiles` impide marcar a alguien de otro gimnasio.
 *
 * El `dia` sale de `ahora` —el `ahoraISO` del job—, no de un `new Date()` suelto:
 * es el dia del JOB, el mismo que decidio a quien avisar.
 */
export async function marcarAvisoDeHoy(
  db: PrismaService['db'],
  logger: Logger,
  marca: { tenantId: string; perfilId: string; tipo: TipoAvisoDiario; ahora: Date },
): Promise<boolean> {
  try {
    await db.avisoDiario.create({
      data: {
        tenantId: marca.tenantId,
        perfilId: marca.perfilId,
        tipo: marca.tipo,
        dia: comienzoDeHoyUtc(marca.ahora),
      },
    });
    return true;
  } catch (error) {
    if (esDuplicado(error)) return false;

    // Solo el id del perfil: ni nombre ni email en el log (ver el spec de
    // recordatorio-pago, «datos personales en el log»).
    const motivo = error instanceof Error ? error.message : String(error);
    logger.error(
      `No se pudo marcar el aviso ${marca.tipo} del perfil ${marca.perfilId}; se salta hoy: ${motivo}`,
      error instanceof Error ? error.stack : undefined,
    );
    return false;
  }
}
