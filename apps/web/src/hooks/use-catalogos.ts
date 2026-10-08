'use client';

import { useQuery } from '@tanstack/react-query';
import type { PackPublico, SalaPublica } from '@boxadmin/shared';
import { pedir } from '@/lib/cliente';

/**
 * Los catalogos del gimnasio: salas y packs.
 *
 * Hacen falta porque `UsuarioDetalle` trae lo que la persona YA TIENE —sus
 * salas, su pack— pero no lo que podria tener. Sin el catalogo, el bloque de
 * salas sabria quitar y no agregar, el de dias fijos no tendria de donde elegir
 * sala, y el pack habria que escribirlo como un identificador a mano.
 *
 * Los dos endpoints EXISTEN y ninguno lleva `@Roles`: cualquiera del gimnasio
 * los lista y el service recorta segun el rol. No se inventa nada en la API.
 *
 * Van juntos en un archivo porque son la misma clase de cosa y los pide la
 * misma pantalla. Cuando una tercera pantalla necesite uno solo, se separan.
 */
export const clavesDeCatalogos = {
  salas: () => ['salas'] as const,
  packs: () => ['packs'] as const,
};

export function useSalas() {
  return useQuery({
    queryKey: clavesDeCatalogos.salas(),
    queryFn: () => pedir<SalaPublica[]>('/salas'),
  });
}

/**
 * Todos los packs, activos e inactivos.
 *
 * Sin los inactivos, el pack de un alumno que se dio de baja del catalogo no
 * estaria entre las opciones y el selector mostraria "sin pack" para alguien que
 * si tiene uno. Guardar entonces no lo rompe —el campo no estaria sucio— pero la
 * pantalla estaria mintiendo.
 */
export function usePacks() {
  return useQuery({
    queryKey: clavesDeCatalogos.packs(),
    queryFn: () => pedir<PackPublico[]>('/packs'),
  });
}
