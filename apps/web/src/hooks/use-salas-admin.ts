'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SalaPublica } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';
import { clavesDeCatalogos } from './use-catalogos';

/**
 * El ABM de salas. La ruta base es `/salas`, verificada contra
 * `apps/api/src/salas/salas.controller.ts`.
 *
 * NO HAY AQUI UN HOOK DE LISTA, A PROPOSITO. `GET /salas` no acepta ningun
 * filtro y el service ya recorta por rol: para un ADMIN_OPERATIVO o superior
 * devuelve TODAS, incluidas las dadas de baja. O sea que la peticion que haria
 * una supuesta "lista de administracion" es byte por byte la misma que la de
 * `useSalas()` de `use-catalogos`. Duplicarla bajo otra clave serian dos
 * peticiones identicas en la misma pantalla y dos copias del mismo dato que
 * pueden quedar desincronizadas. La pantalla de salas usa `useSalas()`.
 *
 * Y por eso mismo toda escritura de aqui INVALIDA EL CATALOGO: esa lista la
 * consumen media docena de pantallas —el alta de usuario, los dias fijos, el
 * filtro de la grilla— y una sala nueva o dada de baja las cambia todas. La
 * clave se toma de `clavesDeCatalogos`, no se reescribe a mano: una copia
 * literal `['salas']` aqui sobreviviria a que alla la renombraran.
 */

export const clavesDeSalas = {
  /** La ficha de una sala. El catalogo vive en `clavesDeCatalogos.salas()`. */
  una: (id: string) => ['sala', id] as const,
};

export function useSala(id: string) {
  return useQuery({
    queryKey: clavesDeSalas.una(id),
    queryFn: () => pedir<SalaPublica>(`/salas/${id}`),
  });
}

/** Tras un alta: solo el catalogo. Todavia no hay ficha que refrescar. */
function useInvalidarCatalogo() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries({ queryKey: clavesDeCatalogos.salas() });
}

/** Tras tocar una sala que ya existe: su ficha Y el catalogo. */
function useInvalidarSala(id: string) {
  const cliente = useQueryClient();
  const invalidarCatalogo = useInvalidarCatalogo();

  return () => {
    void cliente.invalidateQueries({ queryKey: clavesDeSalas.una(id) });
    invalidarCatalogo();
  };
}

export function useCrearSala() {
  const invalidar = useInvalidarCatalogo();

  return useMutation<SalaPublica, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) => pedir<SalaPublica>('/salas', { metodo: 'POST', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

export function useActualizarSala(id: string) {
  const invalidar = useInvalidarSala(id);

  return useMutation<SalaPublica, ErrorDeApi, Record<string, unknown>>({
    mutationFn: (datos) => pedir<SalaPublica>(`/salas/${id}`, { metodo: 'PATCH', cuerpo: datos }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * La baja es LOGICA: la fila sigue ahi con `activa: false` y el DELETE
 * devuelve la sala, no un 204.
 *
 * Por eso SI se invalida la ficha, al reves que en `useBorrarTurno`: alli el
 * borrado es fisico y pedir la ficha despues seria un 404 pintado como error
 * justo tras un borrado correcto. Aca la ficha sigue existiendo y lo que
 * cambio es justamente el campo que el admin acaba de tocar.
 */
export function useBorrarSala(id: string) {
  const invalidar = useInvalidarSala(id);

  return useMutation<SalaPublica, ErrorDeApi, void>({
    mutationFn: () => pedir<SalaPublica>(`/salas/${id}`, { metodo: 'DELETE' }),
    onSuccess: invalidar,
    gcTime: 0,
  });
}
