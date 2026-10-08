import type { RolAsignable, RolUsuario } from '@boxadmin/shared';
import { rolAlcanza } from '@boxadmin/shared';

export interface EnlaceDelPanel {
  ruta: string;
  texto: string;
  /** El rol MINIMO que lo ve. */
  minimo: RolAsignable;
}

/**
 * Los enlaces del panel, declarados y no repartidos por el JSX.
 *
 * Cuando lleguen las otras cuatro areas (Operacion, Dinero, Analisis,
 * Configuracion), agregarlas es una linea aqui y no un `if` nuevo escondido en
 * un componente. Es tambien lo que permite que un test fije el conjunto ENTERO.
 */
export const ENLACES_DEL_PANEL: readonly EnlaceDelPanel[] = [
  { ruta: '', texto: 'Inicio', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'usuarios', texto: 'Personas', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'invitaciones', texto: 'Invitaciones', minimo: 'ADMIN_OPERATIVO' },
];

export function enlacesPara(rol: RolUsuario): EnlaceDelPanel[] {
  return ENLACES_DEL_PANEL.filter((enlace) => rolAlcanza(rol, enlace.minimo));
}
