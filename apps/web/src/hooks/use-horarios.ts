'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HorarioProfesorPublico } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Los horarios fijos de una profesora.
 *
 * La ruta base es `/horarios-profesor`, verificada contra
 * `apps/api/src/horarios-profesor/horarios-profesor.controller.ts`. Las cuatro
 * operaciones piden ADMIN_OPERATIVO, incluida la LECTURA: este hook no sirve
 * para la vista del profesor.
 *
 * `tarifaPorHora` viaja SIEMPRE como CADENA (`'1500.00'`), nunca como number.
 * Es dinero: un float binario no representa 1500.10 exactamente, y el DTO de
 * la API la valida con `@Matches(/^\d{1,8}(\.\d{1,2})?$/)`, que un number
 * serializado como `1500` tampoco cumpliria igual. Misma regla que el precio
 * de los packs desde la Fase 1.
 */

export interface FiltrosDeHorarios {
  profesorId?: string;
  salaId?: string;
}

/** Las claves, en un solo sitio, como en `use-turnos` y `use-usuarios`. */
export const clavesDeHorarios = {
  lista: (f: FiltrosDeHorarios) => ['horarios', f] as const,
};

/** Solo los filtros con valor: una cadena vacia no es "sin filtro" para la API. */
export function queryDeHorarios(f: FiltrosDeHorarios): string {
  const partes = new URLSearchParams();
  if (f.profesorId !== undefined && f.profesorId !== '') partes.set('profesorId', f.profesorId);
  if (f.salaId !== undefined && f.salaId !== '') partes.set('salaId', f.salaId);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useHorarios(filtros: FiltrosDeHorarios) {
  return useQuery({
    queryKey: clavesDeHorarios.lista(filtros),
    queryFn: () => pedir<HorarioProfesorPublico[]>(`/horarios-profesor${queryDeHorarios(filtros)}`),
  });
}

/**
 * Tras escribir un horario: la lista de horarios, y NADA MAS.
 *
 * El prefijo `['horarios']` alcanza a cualquier combinacion de filtros, que es
 * lo que hace falta: un horario nuevo puede entrar o no en la lista que esta
 * en pantalla segun el profesor por el que este filtrada.
 */
function useInvalidarHorarios() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: ['horarios'] });
}

export function useCrearHorario() {
  const invalidar = useInvalidarHorarios();

  return useMutation<HorarioProfesorPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<HorarioProfesorPublico>('/horarios-profesor', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useActualizarHorario(id: string) {
  const invalidar = useInvalidarHorarios();

  return useMutation<HorarioProfesorPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) =>
      pedir<HorarioProfesorPublico>(`/horarios-profesor/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * El borrado responde 204 SIN CUERPO, al reves que el de salas, ausencias y
 * vacaciones, que devuelven la fila. Por eso el tipo de dato es `null`: es lo
 * que `pedir` devuelve ante un 204.
 */
export function useBorrarHorario(id: string) {
  const invalidar = useInvalidarHorarios();

  return useMutation<null, ErrorDeApi, void>({
    mutationFn: () => pedir<null>(`/horarios-profesor/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
