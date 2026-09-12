export const ROLES_USUARIO = [
  'SUPERADMIN',
  'ADMIN_SALON',
  'ADMIN_OPERATIVO',
  'PROFESOR',
  'ALUMNO',
  'FANTASMA',
] as const;

export type RolUsuario = (typeof ROLES_USUARIO)[number];

/**
 * Roles que pueden exigirse como mínimo en una ruta. FANTASMA queda fuera a
 * propósito: es un rol técnico, no un nivel de permiso, y admitirlo como umbral
 * abriría la ruta a todo el mundo porque su rango es 0.
 */
export type RolAsignable = Exclude<RolUsuario, 'FANTASMA'>;

/**
 * Jerarquía de roles: un número mayor incluye los permisos de los menores.
 * FANTASMA es un rol técnico (usuario placeholder que nunca se loguea), por eso
 * queda fuera de la escala con rango 0.
 */
export const JERARQUIA_ROLES: Record<RolUsuario, number> = {
  SUPERADMIN: 50,
  ADMIN_SALON: 40,
  ADMIN_OPERATIVO: 30,
  PROFESOR: 20,
  ALUMNO: 10,
  FANTASMA: 0,
};

/** ¿`rol` alcanza el nivel de `minimo`? */
export function rolAlcanza(rol: RolUsuario, minimo: RolAsignable): boolean {
  if (rol === 'FANTASMA' || (minimo as RolUsuario) === 'FANTASMA') return false;
  return JERARQUIA_ROLES[rol] >= JERARQUIA_ROLES[minimo];
}
