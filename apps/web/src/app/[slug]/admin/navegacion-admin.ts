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
  { ruta: 'calendario', texto: 'Calendario', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'turnos', texto: 'Turnos', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'usuarios', texto: 'Personas', minimo: 'ADMIN_OPERATIVO' },
  { ruta: 'invitaciones', texto: 'Invitaciones', minimo: 'ADMIN_OPERATIVO' },
  /**
   * `ADMIN_OPERATIVO` y no `ADMIN_SALON`, aunque las cuatro ESCRITURAS de salas
   * pidan `ADMIN_SALON`: `GET /salas` y `GET /salas/:id` no llevan `@Roles`, y
   * un operativo necesita poder mirar por que una sala no genera turnos. Las
   * pantallas no le dibujan ni un boton de escritura.
   */
  { ruta: 'salas', texto: 'Salas', minimo: 'ADMIN_OPERATIVO' },
  /**
   * `ADMIN_OPERATIVO` porque es lo que pide la API, y aqui lo pide TAMBIEN
   * PARA LEER: las cuatro operaciones de `horarios-profesor.controller.ts`
   * llevan `@Roles('ADMIN_OPERATIVO')`, incluido el `@Get()`. Es la diferencia
   * con salas, donde las lecturas no llevan rol y las escrituras piden
   * `ADMIN_SALON`.
   */
  { ruta: 'horarios', texto: 'Horarios', minimo: 'ADMIN_OPERATIVO' },
  /**
   * `ADMIN_OPERATIVO` como salas, y por la misma forma invertida: `GET
   * /ausencias` NO lleva `@Roles` —esta escrito en el controller, «a un
   * profesor le interesa saber que el salon cierra»— y las dos ESCRITURAS
   * piden `ADMIN_SALON`. Un operativo necesita poder mirar por que el
   * calendario no genero turnos ese dia; la pantalla no le dibuja ni un boton
   * de escritura.
   *
   * «Cierres» y no «Ausencias»: la entidad se llama `Ausencia` en el schema,
   * pero delante del mostrador una ausencia es la de una persona —hay
   * `VacacionAlumno` al lado— y esto es que la sala no abre. Es el mismo
   * motivo por el que `usuarios` se llama «Personas» aqui.
   */
  { ruta: 'ausencias', texto: 'Cierres', minimo: 'ADMIN_OPERATIVO' },
];

export function enlacesPara(rol: RolUsuario): EnlaceDelPanel[] {
  return ENLACES_DEL_PANEL.filter((enlace) => rolAlcanza(rol, enlace.minimo));
}
