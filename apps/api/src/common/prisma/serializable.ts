/**
 * Codigos que significan "la base aborto tu transaccion porque chocaba con
 * otra, vuelve a intentarlo".
 *
 * - `P2034` es como Prisma envuelve el conflicto.
 * - `40001` (serialization_failure) y `40P01` (deadlock_detected) son los
 *   SQLSTATE de Postgres, que a veces llegan sin envolver.
 *
 * Solo estos se reintentan. Un 409 de negocio —el turno esta lleno— no mejora
 * repitiendolo: reintentarlo triplicaria la latencia para dar la misma
 * respuesta.
 */
import { ConflictException } from '@nestjs/common';

const CODIGOS_DE_CONFLICTO = new Set(['P2034', '40001', '40P01']);

/**
 * La MISMA condicion, vista desde el driver adapter.
 *
 * Con el adapter `pg` de Prisma 7 el conflicto no llega como `P2034`: el propio
 * adapter traduce los SQLSTATE 40001 y 40P01 a `{ kind: 'TransactionWriteConflict' }`
 * y lo envuelve en un `DriverAdapterError`, que **no tiene `code`**. Comprobar
 * solo `code` dejaba el reintento como codigo muerto: no se disparaba nunca.
 *
 * Se descubrio con el e2e de 10 reservas simultaneas, donde una peticion de cada
 * ~20 salia con 500 en vez de 409. El cupo nunca se rompio —de eso ya se encarga
 * el aislamiento Serializable— pero el cliente recibia un error opaco.
 */
const CLASE_DE_CONFLICTO_DEL_ADAPTER = 'TransactionWriteConflict';

export function esConflictoDeSerializacion(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const codigo = (error as { code?: unknown }).code;
  if (typeof codigo === 'string' && CODIGOS_DE_CONFLICTO.has(codigo)) return true;

  const { name, cause } = error as { name?: unknown; cause?: unknown };
  if (name !== 'DriverAdapterError' || typeof cause !== 'object' || cause === null) {
    return false;
  }

  return (cause as { kind?: unknown }).kind === CLASE_DE_CONFLICTO_DEL_ADAPTER;
}

export interface OpcionesDeReintento {
  intentos?: number;
  esperaBaseMs?: number;
}

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ejecuta `fn` reintentando solo los conflictos de serializacion.
 *
 * Cinco intentos con espera creciente y jitter. El jitter importa: sin el, dos
 * transacciones que chocan vuelven a chocar a la vez al reintentar, y el segundo
 * conflicto es tan probable como el primero.
 *
 * Si se agotan los intentos sobre un conflicto de serializacion se lanza un
 * ConflictException (409), NO el error crudo de Prisma. Es deliberado y se
 * descubrio con el test de 10 reservas simultaneas: bajo contencion alta, a
 * algun cliente se le agotaban los reintentos y recibia un 500 opaco, porque
 * `AllExceptionsFilter` no traduce codigos de Prisma. Un 409 es la respuesta
 * honesta — la peticion choco con otra y no se aplico — y ademas es lo que
 * especifica el diseno de la fase.
 */
export async function conReintentoSerializable<T>(
  fn: () => Promise<T>,
  opciones: OpcionesDeReintento = {},
): Promise<T> {
  const intentos = opciones.intentos ?? 5;
  const esperaBaseMs = opciones.esperaBaseMs ?? 10;

  for (let intento = 0; ; intento++) {
    try {
      return await fn();
    } catch (error) {
      // Un error de negocio sale a la primera: reintentarlo solo multiplicaria
      // la latencia para devolver exactamente la misma respuesta.
      if (!esConflictoDeSerializacion(error)) throw error;

      if (intento >= intentos - 1) {
        throw new ConflictException(
          'La operacion choco repetidamente con otra simultanea sobre los mismos ' +
            'datos y no se aplico. Vuelve a intentarlo.',
        );
      }

      await esperar(esperaBaseMs * (intento + 1) + Math.floor(Math.random() * esperaBaseMs));
    }
  }
}
