import { type RolUsuario, rolAlcanza } from '@boxadmin/shared';

/**
 * A donde cae cada rol despues de entrar.
 *
 * `rolAlcanza` es la MISMA funcion que usa el guard de la API: la jerarquia de
 * roles no se reimplementa en el front, porque dos ideas de quien puede que es
 * lo que se separa con el tiempo.
 *
 * El profesor cae en el calendario a proposito: sus endpoints existen desde la
 * Fase 4, pero no hay ninguna pantalla de profesor todavia. Es deuda anotada,
 * no un olvido.
 */
export function destinoPorRol(rol: RolUsuario, slug: string): string {
  if (rolAlcanza(rol, 'ADMIN_OPERATIVO')) return `/${slug}/admin`;

  return `/${slug}/calendario`;
}
