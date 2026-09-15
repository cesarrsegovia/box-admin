import { Prisma } from '@prisma/client';
import { getTenantContext } from './tenant-context';

/** Modelos con columna `tenantId` propia. */
export const MODELOS_CON_TENANT = [
  'Usuario',
  'HistorialAccion',
  'Sala',
  'Perfil',
  'UsuarioSala',
  'Pack',
  'Turno',
  'Reserva',
] as const;

/** Modelos que se aíslan a través de una relación: modelo -> campo de relación. */
export const MODELOS_POR_RELACION: Readonly<Record<string, string>> = {
  RefreshToken: 'usuario',
};

/** Modelos globales, fuera de todo gimnasio. */
export const MODELOS_GLOBALES = ['Tenant'] as const;

/** Operaciones cuyo `where` admite campos no únicos: se les inyecta el filtro. */
const OPERACIONES_CON_WHERE = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

/** Operaciones que escriben filas nuevas: se les rellena el `tenantId`. */
const OPERACIONES_DE_CREACION = new Set(['create', 'createMany', 'createManyAndReturn']);

/** Operaciones que modifican filas existentes: su `data` no puede mover de gimnasio. */
const OPERACIONES_DE_ACTUALIZACION = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/** Operaciones cuyo `where` solo admite campos únicos: no se les puede inyectar nada. */
const OPERACIONES_UNICAS = new Set(['findUnique', 'findUniqueOrThrow', 'upsert']);

/** Claves de `data` que reasignarían la fila a otro gimnasio. */
const CLAVES_DE_REASIGNACION = ['tenantId', 'tenant'] as const;

export class MissingTenantContextError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} se ejecuto sin contexto de tenant. ` +
        'Envuelve la llamada en runWithTenant() o, si es deliberadamente global, en runUnscoped().',
    );
    this.name = 'MissingTenantContextError';
  }
}

export class UnsafeUniqueOperationError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} no admite el filtro de tenant porque su where ` +
        'solo acepta campos unicos. Usa findFirst / update con where no unico, ' +
        'o runUnscoped() si la operacion es realmente global.',
    );
    this.name = 'UnsafeUniqueOperationError';
  }
}

export class ModeloNoClasificadoError extends Error {
  constructor(modelo: string) {
    super(
      `El modelo ${modelo} no esta clasificado en tenant-scoped.extension.ts. ` +
        'Anadelo a MODELOS_CON_TENANT (si tiene columna tenantId), a ' +
        'MODELOS_POR_RELACION (si se aisla a traves de una relacion) o a ' +
        'MODELOS_GLOBALES (si vive fuera de todo gimnasio). Sin clasificar no se ' +
        'puede garantizar el aislamiento, asi que la query se bloquea.',
    );
    this.name = 'ModeloNoClasificadoError';
  }
}

export class ReasignacionDeTenantError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} intenta escribir tenantId / tenant en su data, ` +
        'lo que moveria la fila a otro gimnasio y permitiria secuestrar la cuenta. ' +
        'Quita esa clave del data; si de verdad necesitas reasignar, hazlo dentro de ' +
        'runUnscoped() y dejalo visible en el codigo.',
    );
    this.name = 'ReasignacionDeTenantError';
  }
}

export class CreacionNoPermitidaError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `${operacion} sobre ${modelo} no se permite dentro de un contexto de tenant: ` +
        'el modelo no tiene columna tenantId propia, asi que no se puede garantizar a ' +
        'que gimnasio pertenece la fila. Envuelve la creacion en runUnscoped() y ' +
        'asegura tu mismo la pertenencia (por ejemplo, resolviendo antes el usuario ' +
        'del tenant actual).',
    );
    this.name = 'CreacionNoPermitidaError';
  }
}

export class OperacionNoSoportadaError extends Error {
  constructor(modelo: string, operacion: string) {
    super(
      `La operacion ${operacion} sobre ${modelo} no esta contemplada por el aislamiento ` +
        'de tenant. Se bloquea por seguridad (fail-closed) en vez de dejarla pasar sin ' +
        'filtrar. Clasificala en tenant-scoped.extension.ts (OPERACIONES_CON_WHERE, ' +
        'OPERACIONES_DE_CREACION o OPERACIONES_UNICAS) antes de usarla.',
    );
    this.name = 'OperacionNoSoportadaError';
  }
}

export class RawQueryEnTenantError extends Error {
  constructor(operacion: string) {
    super(
      `${operacion} no pasa por el filtro de tenant: Prisma no expone el modelo ni el ` +
        'where de una consulta raw, asi que no hay forma de aislarla. Reescribe la ' +
        'consulta con el Client API o, si es deliberadamente global, envuelvela en ' +
        'runUnscoped().',
    );
    this.name = 'RawQueryEnTenantError';
  }
}

type CategoriaDeModelo =
  | { tipo: 'conTenant' }
  | { tipo: 'porRelacion'; campo: string }
  | { tipo: 'global' };

function clasificarModelo(modelo: string | undefined): CategoriaDeModelo {
  if (modelo && (MODELOS_CON_TENANT as readonly string[]).includes(modelo)) {
    return { tipo: 'conTenant' };
  }
  if (modelo && Object.prototype.hasOwnProperty.call(MODELOS_POR_RELACION, modelo)) {
    return { tipo: 'porRelacion', campo: MODELOS_POR_RELACION[modelo] };
  }
  if (modelo && (MODELOS_GLOBALES as readonly string[]).includes(modelo)) {
    return { tipo: 'global' };
  }
  throw new ModeloNoClasificadoError(modelo ?? '(desconocido)');
}

function intentaReasignarTenant(data: unknown): boolean {
  if (Array.isArray(data)) return data.some(intentaReasignarTenant);
  if (!data || typeof data !== 'object') return false;
  return CLAVES_DE_REASIGNACION.some((clave) =>
    Object.prototype.hasOwnProperty.call(data, clave),
  );
}

/**
 * Núcleo del aislamiento, extraído como función pura para poder testearlo sin
 * base de datos. Devuelve los `args` que debe recibir Prisma.
 *
 * Es fail-closed: toda combinación de modelo y operación que no esté
 * explícitamente contemplada lanza en vez de dejar pasar la query sin filtrar.
 */
export function aplicarScopeDeTenant(
  modelo: string | undefined,
  operacion: string,
  args: any,
): any {
  // Un modelo sin clasificar es un bug siempre, haya contexto o no: por eso se
  // comprueba antes que el contexto.
  const categoria = clasificarModelo(modelo);
  const nombre = modelo as string;

  const ctx = getTenantContext();
  if (!ctx) throw new MissingTenantContextError(nombre, operacion);
  if (ctx.kind === 'unscoped') return args;

  const { tenantId } = ctx;

  if (OPERACIONES_UNICAS.has(operacion)) {
    throw new UnsafeUniqueOperationError(nombre, operacion);
  }

  if (OPERACIONES_DE_ACTUALIZACION.has(operacion) && intentaReasignarTenant(args?.data)) {
    throw new ReasignacionDeTenantError(nombre, operacion);
  }

  if (OPERACIONES_DE_CREACION.has(operacion)) {
    if (categoria.tipo !== 'conTenant') {
      throw new CreacionNoPermitidaError(nombre, operacion);
    }
    const data = args?.data;
    if (Array.isArray(data)) {
      return { ...args, data: data.map((fila: any) => ({ ...fila, tenantId })) };
    }
    return { ...args, data: { ...(data ?? {}), tenantId } };
  }

  if (OPERACIONES_CON_WHERE.has(operacion)) {
    const where = args?.where ?? {};
    switch (categoria.tipo) {
      case 'conTenant':
        return { ...args, where: { ...where, tenantId } };
      case 'porRelacion':
        return { ...args, where: { ...where, [categoria.campo]: { tenantId } } };
      case 'global':
        // Restringir el Tenant a su propio id neutraliza además cualquier
        // `include` anidado: no queda otro gimnasio del que colgar filas ajenas.
        return { ...args, where: { ...where, id: tenantId } };
    }
  }

  throw new OperacionNoSoportadaError(nombre, operacion);
}

/**
 * Bloquea las consultas raw dentro de un contexto de tenant. Prisma no expone
 * modelo ni `where` para ellas, así que no hay nada que filtrar.
 *
 * Verificado empíricamente en Prisma 7.10.0: el `$allOperations` de primer nivel
 * (fuera de `$allModels`) recibe `$queryRaw`, `$queryRawUnsafe`, `$executeRaw` y
 * `$executeRawUnsafe` con `model === undefined`. También recibe las operaciones
 * de modelo, con `model` definido, que aquí se dejan pasar porque de ellas ya se
 * encarga el hook de `$allModels`.
 */
export function bloquearRawEnTenant(modelo: string | undefined, operacion: string): void {
  if (modelo !== undefined) return;
  const ctx = getTenantContext();
  if (ctx?.kind === 'tenant') throw new RawQueryEnTenantError(operacion);
}

/** Extensión de Prisma Client que aplica el scoping a toda query. */
export const tenantScopedExtension = Prisma.defineExtension({
  name: 'tenantScoped',
  query: {
    $allOperations({ model, operation, args, query }) {
      bloquearRawEnTenant(model, operation);
      return query(args);
    },
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return query(aplicarScopeDeTenant(model, operation, args));
      },
    },
  },
});
