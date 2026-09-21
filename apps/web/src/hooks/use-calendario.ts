'use client';

import { useQuery } from '@tanstack/react-query';
import type { MiClase, MiPackPublico, TurnoDisponible } from '@boxadmin/shared';
import { pedir } from '@/lib/cliente';

/**
 * Las claves de cache, en un solo sitio.
 *
 * Tenerlas centralizadas es lo que permite invalidar con precision desde las
 * mutaciones: una clave escrita a mano en dos archivos se desincroniza y
 * aparece como "la pantalla no se actualiza al reservar".
 */
export const claves = {
  misClases: (desde: string, hasta: string) => ['mis-clases', desde, hasta] as const,
  turnosDisponibles: (desde: string, hasta: string) =>
    ['turnos-disponibles', desde, hasta] as const,
  miPack: () => ['mi-pack'] as const,
  comprobantes: () => ['comprobantes'] as const,
};

export function useMisClases(desde: string, hasta: string) {
  return useQuery({
    queryKey: claves.misClases(desde, hasta),
    queryFn: () => pedir<MiClase[]>(`/mi-calendario?desde=${desde}&hasta=${hasta}`),
  });
}

export function useTurnosDisponibles(desde: string, hasta: string) {
  return useQuery({
    queryKey: claves.turnosDisponibles(desde, hasta),
    queryFn: () => pedir<TurnoDisponible[]>(`/turnos-disponibles?desde=${desde}&hasta=${hasta}`),
  });
}

export function useMiPack() {
  return useQuery({
    queryKey: claves.miPack(),
    queryFn: () => pedir<MiPackPublico>('/mi-pack'),
  });
}
