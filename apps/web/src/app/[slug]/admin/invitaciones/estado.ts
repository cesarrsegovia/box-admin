import type { ClaveInvitacionPublica } from '@boxadmin/shared';

/**
 * EN QUE ESTA UNA CLAVE, Y POR QUE SON CUATRO NOMBRES Y TRES COLORES.
 *
 * `activa` es un booleano en la base, pero en la pantalla no alcanza: una clave
 * con `activa: true` que ya gasto sus diez usos NO sirve, y una que vencio
 * ayer tampoco. Pintar las tres como "Activa" es decirle al admin que el
 * problema del alumno que no puede registrarse esta en otro lado.
 *
 * Los tres colores son las tres cosas distintas que puede hacer el admin:
 *
 * - verde  (`activa`)                 -> no hay nada que hacer;
 * - ambar  (`agotada`, `vencida`)     -> dejo de servir SOLA; hay que crear otra;
 * - gris   (`desactivada`)            -> la apago alguien; se puede volver a prender.
 *
 * `agotada` y `vencida` comparten color porque se arreglan igual, pero no
 * comparten nombre porque se miran en columnas distintas: una se ve en "Usos" y
 * la otra en "Vence".
 *
 * PRECEDENCIA: `desactivada` gana a todo. Es el unico estado que puso una
 * persona a proposito y el unico que el boton de la fila puede cambiar. Que una
 * clave apagada este ademas agotada se lee en la columna "Usos", que sigue ahi.
 */
export type EstadoDeClave = 'activa' | 'agotada' | 'vencida' | 'desactivada';

export const ETIQUETAS_DE_ESTADO: Record<EstadoDeClave, string> = {
  activa: 'Activa',
  agotada: 'Agotada',
  vencida: 'Vencida',
  desactivada: 'Desactivada',
};

/** El color de cada estado. Tres valores distintos para cuatro estados. */
export const TONOS_DE_ESTADO: Record<EstadoDeClave, string> = {
  activa: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  agotada: 'border-amber-300 bg-amber-50 text-amber-900',
  vencida: 'border-amber-300 bg-amber-50 text-amber-900',
  desactivada: 'border-slate-300 bg-slate-100 text-slate-600',
};

/**
 * `ahora` entra por parametro y no se lee de dentro.
 *
 * Una funcion que llama a `new Date()` por su cuenta no se puede probar sin
 * relojes falsos, y con relojes falsos el test prueba el reloj.
 */
export function estadoDeLaClave(clave: ClaveInvitacionPublica, ahora: Date): EstadoDeClave {
  if (!clave.activa) return 'desactivada';

  if (clave.expiraEn !== null && new Date(clave.expiraEn).getTime() <= ahora.getTime()) {
    return 'vencida';
  }

  // `>=` y no `===`: si el limite se bajo despues de repartir la clave, los usos
  // gastados pueden pasarse del maximo y `===` dejaria la clave en verde.
  if (clave.usosMax !== null && clave.usosActuales >= clave.usosMax) return 'agotada';

  return 'activa';
}

/**
 * Lo que va en la columna "Usos".
 *
 * `usosMax: null` es ILIMITADA, no cero: el admin tiene que poder distinguir
 * "sin tope" de "se acabo", y un "0" ahi significaria lo contrario de lo que es.
 */
export function textoDeUsos(clave: ClaveInvitacionPublica): string {
  return clave.usosMax === null
    ? `${clave.usosActuales} (ilimitada)`
    : `${clave.usosActuales}/${clave.usosMax}`;
}

/**
 * Lo que va en la columna "Vence".
 *
 * Se recorta el dia del ISO en vez de formatearlo con `toLocaleDateString`: el
 * selector de fecha del formulario manda `AAAA-MM-DD`, la API lo guarda como
 * medianoche UTC, y pasarlo por la zona horaria del navegador devolveria el dia
 * anterior para medio planeta.
 */
export function textoDeVencimiento(clave: ClaveInvitacionPublica): string {
  return clave.expiraEn === null ? 'No vence' : clave.expiraEn.slice(0, 10);
}
