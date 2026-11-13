import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { runUnscoped } from '../common/tenant/tenant-context';
import { tenantScopedExtension } from '../common/tenant/tenant-scoped.extension';
import { cifrar, clavesDeApp, descifrar } from '../comunicacion/cifrado';
import { validarEntorno } from '../config/validar-entorno';

/**
 * `pnpm --filter @boxadmin/api cifrado:rotar` — re-cifra con la clave ACTUAL
 * los secretos guardados con la ANTERIOR (Fase 20). El procedimiento completo
 * esta en el README: poner la nueva como APP_ENCRYPTION_KEY y la vieja como
 * APP_ENCRYPTION_KEY_ANTERIOR, desplegar, correr esto, quitar la anterior.
 *
 * QUE RECORRE: la unica columna cifrada del schema, `ConfiguracionSMTP.claveCifrada`
 * (medido en la Fase 20: `cifrar(` solo se llama desde config-email.service.ts).
 * Si un dia aparece otra, se agrega aqui; `rotar` no sabe de tablas.
 *
 * IDEMPOTENTE SALTANDO, no re-cifrando: lo que ya descifra con la actual se
 * deja como esta. Asi una segunda pasada no escribe nada y su informe lo dice
 * ("0 rotadas"), que es justo la senal de que ya se puede quitar la anterior.
 *
 * NO toca el `.env` ni imprime secretos: solo cuentas e ids de gimnasio.
 */

export interface FilaCifrada {
  /** Quien es la fila (aqui, el tenantId). Va al informe: no es secreto. */
  id: string;
  valor: string;
}

export interface ResultadoRotacion {
  rotadas: number;
  /** Ya estaban con la actual: se saltan. */
  alDia: number;
  /** Ids que ninguna clave descifra. Se informan y no se tocan. */
  fallidas: string[];
  /** Lo que hay que escribir: solo las rotadas. */
  nuevas: FilaCifrada[];
}

/** La logica, pura: ni base ni entorno. */
export function rotar(
  filas: readonly FilaCifrada[],
  claves: { actual: Buffer; paraDescifrar: readonly Buffer[] },
): ResultadoRotacion {
  const resultado: ResultadoRotacion = { rotadas: 0, alDia: 0, fallidas: [], nuevas: [] };

  for (const fila of filas) {
    if (descifraCon(fila.valor, [claves.actual]) !== null) {
      resultado.alDia += 1;
      continue;
    }

    const claro = descifraCon(fila.valor, claves.paraDescifrar);
    if (claro === null) {
      resultado.fallidas.push(fila.id);
      continue;
    }

    resultado.nuevas.push({ id: fila.id, valor: cifrar(claro, claves.actual) });
    resultado.rotadas += 1;
  }

  return resultado;
}

function descifraCon(valor: string, claves: readonly Buffer[]): string | null {
  try {
    return descifrar(valor, claves);
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  // La misma validacion que al arrancar la API: una anterior mal formada o
  // igual a la actual muere aqui, antes de abrir la base.
  const entorno = validarEntorno({ ...process.env }) as Record<string, string | undefined>;
  const claves = clavesDeApp(
    entorno.APP_ENCRYPTION_KEY as string,
    entorno.APP_ENCRYPTION_KEY_ANTERIOR,
  );
  if (claves.paraDescifrar.length === 1) {
    console.log(
      'Aviso: no hay APP_ENCRYPTION_KEY_ANTERIOR. Solo se comprueba que todo descifre con la actual.',
    );
  }

  const base = new PrismaClient({
    adapter: new PrismaPg({ connectionString: entorno.DATABASE_URL as string }),
  });
  const db = base.$extends(tenantScopedExtension);

  try {
    // Sin tenant, como los jobs diarios: recorre todos los gimnasios.
    await runUnscoped(async () => {
      const filas = await db.configuracionSMTP.findMany({
        select: { tenantId: true, claveCifrada: true },
      });
      const resultado = rotar(
        filas.map((f) => ({ id: f.tenantId, valor: f.claveCifrada })),
        claves,
      );

      // Se escribe con el valor VIEJO en el where: si un admin guardo otro
      // SMTP entre la lectura y esta escritura, su valor (ya con la actual,
      // porque la API corre con ella) no se pisa con uno re-cifrado del viejo.
      const viejoDe = new Map(filas.map((f) => [f.tenantId, f.claveCifrada]));
      let cambiadasEnMedio = 0;
      for (const nueva of resultado.nuevas) {
        const { count } = await db.configuracionSMTP.updateMany({
          where: { tenantId: nueva.id, claveCifrada: viejoDe.get(nueva.id) },
          data: { claveCifrada: nueva.valor },
        });
        if (count === 0) cambiadasEnMedio += 1;
      }

      console.log(`Secretos SMTP revisados: ${filas.length}`);
      console.log(`  rotados a la clave actual: ${resultado.rotadas - cambiadasEnMedio}`);
      console.log(`  ya estaban con la actual:  ${resultado.alDia}`);
      if (cambiadasEnMedio > 0) {
        console.log(`  cambiados durante la rotacion (no se tocaron): ${cambiadasEnMedio}`);
      }
      console.log(`  fallidos (ninguna clave los descifra): ${resultado.fallidas.length}`);
      for (const id of resultado.fallidas) {
        console.log(`    - gimnasio ${id}: hay que volver a cargar su contrasena SMTP`);
      }

      if (resultado.fallidas.length > 0) process.exitCode = 1;
    });
  } finally {
    await base.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // Solo el mensaje: un error de Prisma puede traer la URL de la base.
    console.error(`cifrado:rotar fallo: ${error instanceof Error ? error.message : 'error'}`);
    process.exitCode = 1;
  });
}
