'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AusenciaPublica } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Los cierres: una sala —o el salon entero— que no abre esos dias.
 *
 * Ruta base `/ausencias`, verificada contra
 * `apps/api/src/ausencias/ausencias.controller.ts`. POST y DELETE piden
 * ADMIN_SALON; el GET no lleva `@Roles` a proposito, porque a un profesor le
 * interesa saber que el salon cierra.
 *
 * `salaId` ausente = todo el salon, tanto en el filtro como en el alta.
 */

export interface FiltrosDeAusencias {
  salaId?: string;
  desde?: string;
  hasta?: string;
}

export const clavesDeAusencias = {
  lista: (f: FiltrosDeAusencias) => ['ausencias', f] as const,
};

/** Solo los filtros con valor: una cadena vacia no es "sin filtro" para la API. */
export function queryDeAusencias(f: FiltrosDeAusencias): string {
  const partes = new URLSearchParams();
  if (f.salaId !== undefined && f.salaId !== '') partes.set('salaId', f.salaId);
  if (f.desde !== undefined && f.desde !== '') partes.set('desde', f.desde);
  if (f.hasta !== undefined && f.hasta !== '') partes.set('hasta', f.hasta);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useAusencias(filtros: FiltrosDeAusencias) {
  return useQuery({
    queryKey: clavesDeAusencias.lista(filtros),
    queryFn: () => pedir<AusenciaPublica[]>(`/ausencias${queryDeAusencias(filtros)}`),
  });
}

/** Tras escribir una ausencia: la lista de ausencias, y nada mas. */
function useInvalidarAusencias() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: ['ausencias'] });
}

export function useCrearAusencia() {
  const invalidar = useInvalidarAusencias();

  return useMutation<AusenciaPublica, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) => pedir<AusenciaPublica>('/ausencias', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * No hay PATCH de ausencias en la API: una ausencia mal cargada se borra y se
 * vuelve a crear. El DELETE devuelve la fila borrada, no un 204.
 */
export function useBorrarAusencia(id: string) {
  const invalidar = useInvalidarAusencias();

  return useMutation<AusenciaPublica, ErrorDeApi, void>({
    mutationFn: () => pedir<AusenciaPublica>(`/ausencias/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
