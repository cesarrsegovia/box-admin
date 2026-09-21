import type { Disponibilidad } from '@boxadmin/shared';

/**
 * Traduce el estado consolidado de la API a lo que ve el alumno.
 *
 * Aqui NO se decide nada: `calcularDisponibilidad` ya resolvio el estado, el
 * permiso y el motivo en el servidor (y con la misma funcion que podria correr
 * aqui). Este archivo solo pone palabras.
 *
 * Si alguna vez aparece un `if` comparando cupos o fechas en esta pantalla,
 * esta duplicando una regla que ya vive en @boxadmin/shared, y las dos copias
 * se van a separar.
 */

export type AccionDeTurno = 'reservar' | 'cancelar' | 'anotarme' | 'salirme' | 'ninguna';

export function accionDeTurno(d: Disponibilidad): AccionDeTurno {
  if (d.motivo === 'YA_RESERVADO') return 'cancelar';
  if (d.enListaEspera) return 'salirme';
  if (d.puedeReservar) return 'reservar';
  // Solo se ofrece la cola cuando el turno esta en LISTA_ESPERA Y no hay otro
  // impedimento: sin acceso a la sala o fuera de ventana, anotarse fallaria.
  if (d.estado === 'LISTA_ESPERA' && d.motivo === null) return 'anotarme';

  return 'ninguna';
}

export function textoDeDisponibilidad(d: Disponibilidad): string {
  if (d.enListaEspera) {
    return `Estas en la lista de espera, en el puesto ${d.posicionEnLista ?? '?'}`;
  }

  switch (d.motivo) {
    case 'YA_RESERVADO':
      return 'Ya tenes tu lugar reservado';
    case 'VENTANA_CERRADA':
      return 'Ya paso el plazo para anotarse';
    case 'SOLO_CUPOS_LIBERADOS':
      return 'Solo se pueden tomar lugares liberados, y todavia no se libero ninguno';
    case 'SIN_ACCESO_A_SALA':
    case 'SALA_NO_VISIBLE':
      return 'No tenes acceso a esta sala';
    case 'MES_NO_PUBLICADO':
      return 'Este mes todavia no esta abierto';
    case null:
      break;
  }

  switch (d.estado) {
    case 'LIBRE':
      return `Quedan ${Math.max(0, d.cupo - d.ocupados)} lugares`;
    case 'LISTA_ESPERA':
      return `Completo (${d.ocupados}/${d.cupo}). Podes anotarte en la lista de espera`;
    case 'LLENO':
      return `Completo (${d.ocupados}/${d.cupo})`;
    case 'SOLO_ADMIN':
      return 'Solo el salon puede asignar este lugar';
  }
}
