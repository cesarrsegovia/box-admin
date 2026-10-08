'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ClaveInvitacionPublica } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Las claves de cache, en un solo sitio, como en `use-usuarios`.
 *
 * Hay UNA sola: `GET /invitaciones` devuelve la lista entera y no existe un
 * `GET /invitaciones/:id`. Por eso tampoco hay ruta de ficha en esta pantalla:
 * inventarla obligaria a buscar la clave dentro de la lista y a quedarse en
 * blanco al recargar.
 */
export const clavesDeInvitaciones = {
  lista: () => ['invitaciones'] as const,
};

export function useInvitaciones() {
  return useQuery({
    queryKey: clavesDeInvitaciones.lista(),
    queryFn: () => pedir<ClaveInvitacionPublica[]>('/invitaciones'),
  });
}

/** Tras cualquier escritura, la lista queda rancia: es lo unico que hay. */
function useInvalidar(): () => void {
  const cliente = useQueryClient();

  return () => void cliente.invalidateQueries({ queryKey: clavesDeInvitaciones.lista() });
}

/**
 * Crear y editar son la MISMA mutacion, con `id` o sin el.
 *
 * El cuerpo lo arma quien llama (`cuerpoDeLaClave`) y es el mismo para los dos
 * verbos: `CrearInvitacionDto` y `ActualizarInvitacionDto` aceptan exactamente
 * las mismas cinco claves, y el segundo solo las hace opcionales.
 *
 * LA RESPUESTA SE TIRA, A PROPOSITO. `POST /invitaciones` devuelve la clave
 * recien creada CON SU `codigo` dentro, y ese codigo es la credencial que
 * alguien escribe para darse de alta en el gimnasio. Si se devolviera, TanStack
 * la guardaria en el cache de MUTACIONES —otro almacen, distinto del de
 * consultas, que ningun test de cache miraba hasta la fase pasada— y se
 * quedaria ahi, legible desde la consola, hasta que el recolector pasara.
 *
 * Por eso van las dos defensas y no una:
 *
 * 1. no se devuelve el cuerpo, asi que no hay nada que guardar; y
 * 2. `gcTime: 0`, para que tampoco sobreviva lo que SI se guarda (`variables`),
 *    y para que el dia que alguien necesite la respuesta y quite el `void` no
 *    herede de regalo los cinco minutos que TanStack da por defecto.
 *
 * La lista SI tiene los codigos y vive en el cache de consultas: no hay forma
 * de pintar la pantalla sin ellos. Ese cache muere con la pestaña. Lo que no
 * puede pasar —y hay un test— es que ademas acaben en `localStorage`.
 */
export function useGuardarClave(id: string | undefined) {
  const invalidar = useInvalidar();

  return useMutation<void, ErrorDeApi, Record<string, unknown>>({
    mutationFn: async (datos) => {
      await (id === undefined
        ? pedir<ClaveInvitacionPublica>('/invitaciones', { metodo: 'POST', cuerpo: datos })
        : pedir<ClaveInvitacionPublica>(`/invitaciones/${id}`, {
            metodo: 'PATCH',
            cuerpo: datos,
          }));
    },
    onSuccess: invalidar,
    gcTime: 0,
  });
}

/**
 * Prender y apagar una clave, que es lo que sustituye a rotar el `codigo`.
 *
 * Va aparte del formulario y toma el `id` en las VARIABLES, no en el hook: el
 * boton esta en cada fila de la tabla y un hook por fila seria un hook dentro
 * de un bucle.
 *
 * Tambien tira la respuesta, por lo mismo: el PATCH devuelve la clave entera.
 */
export function useCambiarActiva() {
  const invalidar = useInvalidar();

  return useMutation<void, ErrorDeApi, { id: string; activa: boolean }>({
    mutationFn: async ({ id, activa }) => {
      await pedir<ClaveInvitacionPublica>(`/invitaciones/${id}`, {
        metodo: 'PATCH',
        cuerpo: { activa },
      });
    },
    onSuccess: invalidar,
    gcTime: 0,
  });
}
