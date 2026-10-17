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
  /**
   * `ADMIN_OPERATIVO` porque es lo que piden cinco de los seis reportes, y el
   * que falta —`/stats/caja`, que lleva el margen y lo que cuesta cada
   * profesora— pide `ADMIN_SALON` Y SE RESUELVE DENTRO DE LA PANTALLA, no
   * aqui. Es el criterio de la 5A y lo explica el controller: registrar un
   * cobro es operativo, mirar el margen del salon no.
   *
   * Poner `ADMIN_SALON` en esta linea «por si acaso» le escondería al
   * operativo la ocupacion, la asistencia y las cancelaciones, que son
   * justamente su trabajo. El enlace lo ve `ADMIN_OPERATIVO`; lo que cambia es
   * que hay dentro.
   */
  { ruta: 'analisis', texto: 'Analisis', minimo: 'ADMIN_OPERATIVO' },
  /**
   * ENTRADA PROPIA Y NO UN ENLACE DENTRO DE ANALISIS, aunque la ruta cuelgue
   * de ella. Es el unico reporte de los seis que NO se pide por mes —toma
   * `ConsultaRangoDto`: un rango libre y un `perfilId` opcional— y lo explica
   * el controller: la conversacion con un alumno sobre su asistencia no
   * empieza ni termina un dia 1.
   *
   * El motivo de que suba a la navegacion en vez de quedarse a un clic por
   * dentro: es el unico sitio del panel donde se dice que el denominador son
   * las reservas de turnos CON LISTA PASADA. Enterrado dentro de la pantalla
   * mensual, eso solo lo encuentra quien ya fue a buscarlo, y quien no se
   * queda con el porcentaje agregado del mes — que es justo el numero que esta
   * pantalla existe para desmenuzar.
   *
   * `ADMIN_OPERATIVO` porque es lo que pide `/stats/asistencia`, como los
   * otros cuatro reportes que no son la caja. Aqui no hay nada que esconderle
   * a un operativo: no lleva ni un importe.
   *
   * La ruta es anidada y el enlace activo se decide por igualdad exacta
   * (`rutaActual === href`), asi que estar en `/analisis/asistencia` NO marca
   * tambien «Analisis». Si algun dia eso pasara a compararse por prefijo,
   * habria dos entradas marcadas a la vez y el test de `aria-current` lo diria.
   */
  { ruta: 'analisis/asistencia', texto: 'Asistencia', minimo: 'ADMIN_OPERATIVO' },
];

export function enlacesPara(rol: RolUsuario): EnlaceDelPanel[] {
  return ENLACES_DEL_PANEL.filter((enlace) => rolAlcanza(rol, enlace.minimo));
}
