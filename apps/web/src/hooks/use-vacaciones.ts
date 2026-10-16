'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VacacionPublica } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Las vacaciones de un alumno: los dias en los que no se le generan reservas.
 *
 * LA RUTA BASE ES `/vacaciones-alumnos`, NO `/vacaciones`. Esta verificada
 * contra `apps/api/src/vacaciones/vacaciones.controller.ts`, donde el
 * `@Controller` dice `vacaciones-alumnos` aunque el modulo, el service y el
 * contrato se llamen solo "vacaciones". Deducir la ruta del nombre del modulo
 * aca da un 404, y un 404 en el GET se veria en pantalla como "este alumno no
 * tiene vacaciones cargadas", que es exactamente la clase de error que nadie
 * reporta.
 *
 * Las tres operaciones piden ADMIN_OPERATIVO: es un dato de gestion que carga
 * el mostrador por el alumno.
 */

export interface FiltrosDeVacaciones {
  perfilId?: string;
}

export const clavesDeVacaciones = {
  lista: (f: FiltrosDeVacaciones) => ['vacaciones', f] as const,
};

/** Solo los filtros con valor: una cadena vacia no es "sin filtro" para la API. */
export function queryDeVacaciones(f: FiltrosDeVacaciones): string {
  const partes = new URLSearchParams();
  if (f.perfilId !== undefined && f.perfilId !== '') partes.set('perfilId', f.perfilId);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useVacaciones(filtros: FiltrosDeVacaciones) {
  return useQuery({
    queryKey: clavesDeVacaciones.lista(filtros),
    queryFn: () => pedir<VacacionPublica[]>(`/vacaciones-alumnos${queryDeVacaciones(filtros)}`),
  });
}

/** Tras escribir unas vacaciones: la lista de vacaciones, y nada mas. */
function useInvalidarVacaciones() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: ['vacaciones'] });
}

export function useCrearVacacion() {
  const invalidar = useInvalidarVacaciones();

  return useMutation<VacacionPublica, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<VacacionPublica>('/vacaciones-alumnos', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * Aca el borrado es REAL, no una baja logica: unas vacaciones mal cargadas se
 * corrigen borrandolas. Devuelve la fila borrada para poder deshacer.
 */
export function useBorrarVacacion(id: string) {
  const invalidar = useInvalidarVacaciones();

  return useMutation<VacacionPublica, ErrorDeApi, void>({
    mutationFn: () => pedir<VacacionPublica>(`/vacaciones-alumnos/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
