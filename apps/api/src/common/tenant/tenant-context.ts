import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexto de tenant de la request actual.
 * - `tenant`: hay un gimnasio activo, toda query se filtra por él.
 * - `unscoped`: se decidió explícitamente operar fuera de cualquier tenant.
 * La ausencia de contexto (undefined) NO es un tercer modo válido: es un bug,
 * y la extensión de Prisma lo trata como error.
 */
export type TenantContext =
  | { kind: 'tenant'; tenantId: string }
  | { kind: 'unscoped' };

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantIdInvalidoError extends Error {
  constructor(recibido: unknown) {
    super(
      `runWithTenant exige un tenantId que sea una cadena no vacia, y recibio ${typeof recibido === 'string' ? "''" : String(recibido)}. ` +
        'Un tenantId vacio o undefined produce where: { tenantId: undefined }, que Prisma interpreta como "sin filtro" ' +
        'y devolveria las filas de todos los gimnasios.',
    );
    this.name = 'TenantIdInvalidoError';
  }
}

/** Ejecuta `fn` con todas las queries filtradas por `tenantId`. */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new TenantIdInvalidoError(tenantId);
  }
  return storage.run({ kind: 'tenant', tenantId }, fn);
}

/**
 * Ejecuta `fn` sin filtro de tenant. Es la única vía legítima de salir del
 * aislamiento: crear un tenant, buscar al usuario en el login antes de que
 * exista JWT, validar un refresh token. Debe quedar visible en el código.
 */
export function runUnscoped<T>(fn: () => T): T {
  return storage.run({ kind: 'unscoped' }, fn);
}

export function getTenantContext(): TenantContext | undefined {
  return storage.getStore();
}
