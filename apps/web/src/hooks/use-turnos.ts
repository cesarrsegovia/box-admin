'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ReservaCreada,
  ReservaEnTurno,
  ReservaPublica,
  TipoCancelacion,
  TurnoPublico,
} from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

export interface FiltrosDeTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
  profesorId?: string;
}

/** Las claves, en un solo sitio, como en `use-usuarios` y `use-calendario`. */
export const clavesDeTurnos = {
  lista: (f: FiltrosDeTurnos) => ['turnos', f] as const,
  uno: (id: string) => ['turno', id] as const,
  reservas: (turnoId: string) => ['reservas-de-turno', turnoId] as const,
};

/**
 * Solo los filtros con valor. Mandar `soloLibres=` vacio no es lo mismo que no
 * mandarlo: el `ParseBoolPipe` de la API lo rechazaria con un 400.
 */
export function queryDeTurnos(f: FiltrosDeTurnos): string {
  const partes = new URLSearchParams();
  if (f.desde !== undefined && f.desde !== '') partes.set('desde', f.desde);
  if (f.hasta !== undefined && f.hasta !== '') partes.set('hasta', f.hasta);
  if (f.salaId !== undefined && f.salaId !== '') partes.set('salaId', f.salaId);
  if (f.soloLibres !== undefined) partes.set('soloLibres', String(f.soloLibres));
  if (f.profesorId !== undefined && f.profesorId !== '') partes.set('profesorId', f.profesorId);

  const texto = partes.toString();
  return texto === '' ? '' : `?${texto}`;
}

export function useTurnos(filtros: FiltrosDeTurnos) {
  return useQuery({
    queryKey: clavesDeTurnos.lista(filtros),
    queryFn: () => pedir<TurnoPublico[]>(`/turnos${queryDeTurnos(filtros)}`),
  });
}

export function useTurno(id: string) {
  return useQuery({
    queryKey: clavesDeTurnos.uno(id),
    queryFn: () => pedir<TurnoPublico>(`/turnos/${id}`),
  });
}

export function useReservasDelTurno(turnoId: string) {
  return useQuery({
    queryKey: clavesDeTurnos.reservas(turnoId),
    queryFn: () => pedir<ReservaEnTurno[]>(`/turnos/${turnoId}/reservas`),
  });
}

/**
 * Tras escribir SOBRE EL TURNO: la ficha y la lista.
 *
 * El nombre, la fecha, las horas, el cupo y la profesora salen en los dos
 * sitios, asi que los dos se quedan rancios. LAS RESERVAS NO: ninguno de esos
 * cinco campos cambia quien esta anotado.
 */
function useInvalidarTurno(turnoId: string) {
  const cliente = useQueryClient();

  return () => {
    void cliente.invalidateQueries({ queryKey: clavesDeTurnos.uno(turnoId) });
    void cliente.invalidateQueries({ queryKey: ['turnos'] });
  };
}

/**
 * Tras escribir SOBRE QUIEN ESTA ANOTADO: ademas, la lista de reservas.
 *
 * ESTO ESTABA JUNTO Y NO DEBIA. Mientras nadie observaba `reservas`, invalidarla
 * tras cualquier escritura era un no-op y no se notaba. Desde que la ficha
 * tiene bloque de anotados, esa consulta SI tiene observador: con la version
 * unica, cambiar la hora de un turno —o poner una suplente— volvia a pedir la
 * lista de quien esta anotado, con sus nombres, por una escritura que no la
 * toca. Se vio escribiendo la lista blanca de `guardar los datos pide ESTO y
 * nada mas`, que gano una lectura que nadie habia pedido.
 */
function useInvalidarAnotados(turnoId: string) {
  const cliente = useQueryClient();
  const invalidarTurno = useInvalidarTurno(turnoId);

  return () => {
    void cliente.invalidateQueries({ queryKey: clavesDeTurnos.reservas(turnoId) });
    invalidarTurno();
  };
}

export function useActualizarTurno(id: string) {
  const invalidar = useInvalidarTurno(id);

  return useMutation<TurnoPublico, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) => pedir<TurnoPublico>(`/turnos/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useAsignarProfesor(id: string) {
  const invalidar = useInvalidarTurno(id);

  return useMutation<TurnoPublico, ErrorDeApi, string | null>({
    mutationFn: (profesorId) =>
      pedir<TurnoPublico>(`/turnos/${id}/profesor`, { metodo: 'PATCH', cuerpo: { profesorId } }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/** Lo que acepta `POST /turnos` (`CrearTurnoDto`). */
export interface TurnoACrear {
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  /** `perfilId`. AUSENTE = la del horario semanal; ni `null` ni vacio. */
  profesorId?: string;
}

export function useCrearTurno() {
  const cliente = useQueryClient();

  return useMutation<TurnoPublico, ErrorDeApi, TurnoACrear>({
    mutationFn: (datos) => pedir<TurnoPublico>('/turnos', { metodo: 'POST', cuerpo: datos }),
    // Solo los listados: la ficha del turno nuevo no existe todavia en cache.
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['turnos'] }),
    gcTime: 0,
  });
}

export function useBorrarTurno(id: string) {
  const cliente = useQueryClient();

  return useMutation<null, ErrorDeApi, void>({
    mutationFn: () => pedir<null>(`/turnos/${id}`, { metodo: 'DELETE' }),
    onSuccess: () => void cliente.invalidateQueries({ queryKey: ['turnos'] }),
    gcTime: 0,
  });
}

export function useAnotar(turnoId: string) {
  const invalidar = useInvalidarAnotados(turnoId);

  return useMutation<ReservaCreada, ErrorDeApi, string>({
    mutationFn: (perfilId) =>
      pedir<ReservaCreada>(`/turnos/${turnoId}/reservas`, { metodo: 'POST', cuerpo: { perfilId } }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * El tipo viaja en el QUERY y en minusculas, que es lo que acepta el DTO. Y NO
 * tiene valor por defecto a proposito: una DEFINITIVA le gasta la clase al
 * alumno y una RECUPERABLE se la devuelve, asi que elegir por el seria decidir
 * en su nombre.
 */
export function useCancelar(turnoId: string) {
  const invalidar = useInvalidarAnotados(turnoId);

  return useMutation<ReservaPublica, ErrorDeApi, { id: string; tipo: TipoCancelacion }>({
    mutationFn: ({ id, tipo }) =>
      pedir<ReservaPublica>(`/reservas/${id}?tipo=${tipo.toLowerCase()}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useReasignar(turnoId: string) {
  const invalidar = useInvalidarAnotados(turnoId);

  return useMutation<ReservaPublica, ErrorDeApi, { id: string; destinoId: string }>({
    mutationFn: ({ id, destinoId }) =>
      pedir<ReservaPublica>(`/reservas/${id}/reasignar`, {
        metodo: 'PATCH',
        cuerpo: { turnoId: destinoId },
      }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
