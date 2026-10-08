'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiaSemana, RutinaPublica } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * UNA RUTINA NO ES UN PLAN DE ENTRENAMIENTO.
 *
 * Es una RESERVA RECURRENTE: perfil, sala, dia de la semana, horario y nombre
 * del turno que generara. Es el motor de recurrencia de la Fase 2, y por eso
 * estos hooks se consumen desde la ficha de una persona —"¿que dias viene
 * Ana?"— y no desde una pantalla de rutinas, que nadie abriria.
 */

/** La clave lleva el `perfilId` DENTRO: la lista es siempre la de una persona. */
export const clavesDeRutinas = {
  dePersona: (perfilId: string) => ['rutinas', perfilId] as const,
};

/**
 * Las rutinas de UNA persona.
 *
 * El `perfilId` no es opcional. `GET /rutinas` sin filtro devuelve las del
 * gimnasio entero, y esta pantalla pinta lo que recibe: pedirlas sin filtrar
 * llenaria la ficha de Ana con los dias fijos de todo el mundo, y el fallo se
 * veria como "esta alumna viene 40 veces por semana", no como un error.
 */
export function useRutinas(perfilId: string) {
  return useQuery({
    queryKey: clavesDeRutinas.dePersona(perfilId),
    queryFn: () => pedir<RutinaPublica[]>(`/rutinas?perfilId=${encodeURIComponent(perfilId)}`),
  });
}

/**
 * Lo que `POST /rutinas` exige.
 *
 * `desde` ES OBLIGATORIO en el DTO de la API (`CrearRutinaDto`), aunque el plan
 * de la fase solo mencionaba dia, hora, sala y nombre. Sin el, la peticion es
 * un 400 del ValidationPipe. Esta cara del contrato esta escrita a mano porque
 * `@boxadmin/shared` publica `RutinaPublica` (lo que sale) pero no los DTOs de
 * entrada.
 */
export interface NuevaRutina {
  perfilId: string;
  salaId: string;
  /** Nombre del turno que generara, p. ej. "Pilates". */
  nombre: string;
  diaSemana: DiaSemana;
  /** `HH:MM`. */
  horaInicio: string;
  horaFin: string;
  /** `YYYY-MM-DD`. */
  desde: string;
  /** Ausente = rutina indefinida. */
  hasta?: string;
}

function useInvalidar(perfilId: string) {
  const cliente = useQueryClient();

  return () => {
    void cliente.invalidateQueries({ queryKey: clavesDeRutinas.dePersona(perfilId) });
  };
}

export function useCrearRutina(perfilId: string) {
  const invalidar = useInvalidar(perfilId);

  return useMutation<RutinaPublica, ErrorDeApi, NuevaRutina>({
    mutationFn: (datos) => pedir<RutinaPublica>('/rutinas', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/** Campos que `PATCH /rutinas/:id` acepta. NO lleva `perfilId` ni `salaId`. */
export type CambiosDeRutina = Partial<
  Pick<RutinaPublica, 'nombre' | 'diaSemana' | 'horaInicio' | 'horaFin' | 'activa'> & {
    desde: string;
    hasta: string;
  }
>;

export function useActualizarRutina(perfilId: string) {
  const invalidar = useInvalidar(perfilId);

  return useMutation<RutinaPublica, ErrorDeApi, { id: string; cambios: CambiosDeRutina }>({
    mutationFn: ({ id, cambios }) =>
      pedir<RutinaPublica>(`/rutinas/${id}`, { metodo: 'PATCH', cuerpo: cambios }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * Baja LOGICA: la API no borra la fila, le pone `activa: false`.
 *
 * Importa para la pantalla: la respuesta trae la rutina, no un 204, y la lista
 * sigue teniendola. Si el bloque pintara todo lo que viene, la rutina dada de
 * baja seguiria ahi despues de darla de baja.
 */
export function useDarDeBajaRutina(perfilId: string) {
  const invalidar = useInvalidar(perfilId);

  return useMutation<RutinaPublica, ErrorDeApi, string>({
    mutationFn: (id) => pedir<RutinaPublica>(`/rutinas/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
