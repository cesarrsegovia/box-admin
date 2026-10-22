import { type RolUsuario, rolAlcanza } from '@boxadmin/shared';

/**
 * A donde cae cada rol despues de entrar.
 *
 * `rolAlcanza` es la MISMA funcion que usa el guard de la API: la jerarquia de
 * roles no se reimplementa en el front, porque dos ideas de quien puede que es
 * lo que se separa con el tiempo.
 *
 * ---------------------------------------------------------------------------
 * EL PROFESOR YA NO CAE EN EL CALENDARIO, Y NO ES UN CAMBIO COSMETICO.
 *
 * Hasta la Fase 13 esta funcion distinguia `ADMIN_OPERATIVO` de TODO LO DEMAS y
 * mandaba al resto al calendario. Para una profesora eso no era «una pantalla
 * que no es la suya»: era un CALLEJON SIN SALIDA. El layout de `(alumno)` exige
 * `rol === 'ALUMNO'` —a proposito, y con jerarquia NO, para que un admin no se
 * pasee por el area del alumno—, asi que una profesora que ponia su
 * contraseña aterrizaba en «Esta no es tu area» y el unico boton que le quedaba
 * era cerrar sesion. Entrar correctamente la echaba.
 *
 * El comentario que habia aqui lo llamaba «deuda anotada, no un olvido», y era
 * cierto: sus endpoints existen desde la Fase 4 y la pantalla no existia. Lo
 * que cambia en esta fase es que la pantalla YA EXISTE, asi que la deuda se
 * paga en vez de volver a anotarse.
 *
 * ---------------------------------------------------------------------------
 * EL ORDEN DE LAS DOS COMPROBACIONES ES EL CONTRATO, Y NO ES INTERCAMBIABLE.
 *
 * Primero la jerarquia y despues la IGUALDAD. Un `rolAlcanza(rol, 'PROFESOR')`
 * en el segundo sitio seria cierto tambien para `ADMIN_OPERATIVO`,
 * `ADMIN_SALON` y `SUPERADMIN` —estan todos por encima de PROFESOR en
 * `JERARQUIA_ROLES`—, asi que si alguien algun dia reordena estas dos lineas,
 * un administrador aterrizaria en la agenda de clases de una profesora que no
 * es el. Con `=== 'PROFESOR'` el reordenado solo cambia a quien manda al panel
 * y no a quien manda a `mis-clases`, que es el fallo barato de los dos.
 *
 * Y es el mismo criterio que el de la puerta de `(profesor)`: el area de la
 * profesora es de la profesora, y un admin no es «una profesora con mas
 * permisos».
 *
 * ---------------------------------------------------------------------------
 * LO QUE ESTA FUNCION NO SABE: si el destino va a dejar entrar a esa persona.
 *
 * Decide un destino; las puertas deciden el acceso. Que las dos cosas coincidan
 * no se puede comprobar aqui —esto es una funcion pura sobre un rol y un slug—
 * y por eso se comprueba en el spec de la puerta de `(profesor)`, que monta el
 * layout en la ruta que esta funcion devuelve. Una de las dos mitades sola es
 * justo lo que habia antes: un destino perfectamente calculado hacia una
 * puerta cerrada.
 */
export function destinoPorRol(rol: RolUsuario, slug: string): string {
  if (rolAlcanza(rol, 'ADMIN_OPERATIVO')) return `/${slug}/admin`;

  if (rol === 'PROFESOR') return `/${slug}/mis-clases`;

  return `/${slug}/calendario`;
}
