'use client';

import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Disponibilidad, TurnoDisponible } from '@boxadmin/shared';
import { ErrorDeApi, pedir } from '@/lib/cliente';
import { claves } from './use-calendario';

/**
 * Aplica un cambio a la disponibilidad de UN turno dentro de la cache, sin
 * mutar nada: React Query compara por referencia para decidir si repintar.
 */
function parchearTurno(
  cliente: QueryClient,
  desde: string,
  hasta: string,
  turnoId: string,
  cambio: (d: Disponibilidad) => Disponibilidad,
): void {
  cliente.setQueryData<TurnoDisponible[]>(claves.turnosDisponibles(desde, hasta), (lista) =>
    (lista ?? []).map((turno) =>
      turno.turnoId === turnoId
        ? { ...turno, disponibilidad: cambio(turno.disponibilidad) }
        : turno,
    ),
  );
}

interface ContextoDeReversion {
  anterior: TurnoDisponible[] | undefined;
}

/**
 * Reservar, cancelar y lista de espera, con actualizacion optimista.
 *
 * El PDF pide el optimismo por su nombre: es donde TurnoFit se siente pesado.
 * Pero la parte que de verdad importa es el ROLLBACK. Reservar puede fallar por
 * cupo, por ventana o por pack, y una interfaz que se quedara mostrando una
 * reserva inexistente mandaria al alumno a una clase en la que no esta anotado
 * — peor que una interfaz lenta.
 *
 * Por eso cada mutacion guarda la lista anterior entera en `onMutate` y la
 * restaura en `onError`, y por eso todas invalidan en `onSettled`: el estado
 * real lo tiene el servidor.
 */
export function useAccionesDeTurno(desde: string, hasta: string) {
  const cliente = useQueryClient();
  const clave = claves.turnosDisponibles(desde, hasta);

  function preparar(): ContextoDeReversion {
    return { anterior: cliente.getQueryData<TurnoDisponible[]>(clave) };
  }

  function revertir(contexto: ContextoDeReversion | undefined): void {
    if (contexto?.anterior !== undefined) cliente.setQueryData(clave, contexto.anterior);
  }

  async function refrescar(): Promise<void> {
    await Promise.all([
      cliente.invalidateQueries({ queryKey: clave }),
      cliente.invalidateQueries({ queryKey: claves.misClases(desde, hasta) }),
      // Una reserva cambia el consumo del pack, y esa pantalla es otra.
      cliente.invalidateQueries({ queryKey: claves.miPack() }),
    ]);
  }

  const reservar = useMutation<unknown, ErrorDeApi, string, ContextoDeReversion>({
    mutationFn: (turnoId) => pedir(`/turnos/${turnoId}/mi-reserva`, { metodo: 'POST' }),
    onMutate: async (turnoId) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        ocupados: d.ocupados + 1,
        puedeReservar: false,
        motivo: 'YA_RESERVADO',
      }));

      return contexto;
    },
    onError: (_error, _turnoId, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  const cancelar = useMutation<
    unknown,
    ErrorDeApi,
    { turnoId: string; reservaId: string },
    ContextoDeReversion
  >({
    mutationFn: ({ reservaId }) => pedir(`/mis-reservas/${reservaId}`, { metodo: 'DELETE' }),
    onMutate: async ({ turnoId }) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        ocupados: Math.max(0, d.ocupados - 1),
        puedeReservar: true,
        motivo: null,
      }));

      return contexto;
    },
    onError: (_error, _variables, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  const anotarme = useMutation<unknown, ErrorDeApi, string, ContextoDeReversion>({
    mutationFn: (turnoId) => pedir(`/turnos/${turnoId}/lista-espera`, { metodo: 'POST' }),
    onMutate: async (turnoId) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        enListaEspera: true,
        // La posicion real la decide el servidor; mostrar una inventada seria
        // mentir sobre algo que el alumno va a comparar con la realidad.
        posicionEnLista: null,
      }));

      return contexto;
    },
    onError: (_error, _turnoId, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  /**
   * Salirse de la cola.
   *
   * DESVIACION CONOCIDA: la pantalla todavia no ofrece esta accion, porque
   * `TurnoDisponible` expone `enListaEspera` y `posicionEnLista` pero NO el id
   * de la entrada en la cola, que es lo que pide el endpoint. Queda escrita y
   * probada para cuando el contrato lo incluya.
   */
  const salirme = useMutation<
    unknown,
    ErrorDeApi,
    { turnoId: string; entradaId: string },
    ContextoDeReversion
  >({
    mutationFn: ({ entradaId }) => pedir(`/lista-espera/${entradaId}`, { metodo: 'DELETE' }),
    onMutate: async ({ turnoId }) => {
      await cliente.cancelQueries({ queryKey: clave });
      const contexto = preparar();

      parchearTurno(cliente, desde, hasta, turnoId, (d) => ({
        ...d,
        enListaEspera: false,
        posicionEnLista: null,
      }));

      return contexto;
    },
    onError: (_error, _variables, contexto) => revertir(contexto),
    onSettled: refrescar,
  });

  return { reservar, cancelar, anotarme, salirme };
}
