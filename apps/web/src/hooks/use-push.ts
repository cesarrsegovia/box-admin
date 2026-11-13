'use client';

import { useMutation } from '@tanstack/react-query';
import { type ErrorDeApi, pedir } from '@/lib/cliente';
import { serializar } from '@/lib/push';

/**
 * Las dos escrituras de las notificaciones push.
 *
 * Son `useMutation` y no un `pedir` suelto por una sola razon: asi las ve el
 * `MutationCache` de `lib/query.tsx`, que manda al login ante un 401. Con el
 * `pedir` suelto, un alumno con la sesion vencida leia «Unauthorized» y se
 * quedaba en el perfil. `gcTime: 0` porque la suscripcion lleva el endpoint y
 * las claves de este navegador (ver `src/test/mutaciones-sin-gctime.ts`).
 *
 * `useGuardarSuscripcion` recibe la `PushSubscription` del navegador y no la
 * ya serializada: si el POST falla, la tiene que poder desuscribir el mismo.
 */
export function useGuardarSuscripcion() {
  return useMutation<unknown, ErrorDeApi, PushSubscription>({
    mutationFn: async (suscripcion) => {
      try {
        return await pedir('/push/suscripcion', {
          metodo: 'POST',
          cuerpo: serializar(suscripcion),
        });
      } catch (fallo) {
        // Si el servidor no se queda con la suscripcion, el navegador tampoco.
        // Sin esto queda una suscripcion viva que nadie conoce: el alumno ve
        // "Activar" —asi que se cree sin avisos— y ademas el navegador le
        // reserva un permiso que no usa nadie. Pulsar otra vez crearia una
        // segunda suscripcion con otro endpoint.
        //
        // AQUI y no en el `catch` de la pantalla: en TanStack v5 el `onError`
        // del `MutationCache` corre ANTES de que `mutateAsync` rechace, y ante
        // un 401 ese `onError` navega al login. Desde la pantalla, el deshacer
        // competiria con la descarga de la pagina; dentro del `mutationFn` ya
        // termino cuando el cache se entera del fallo.
        //
        // El `.catch()` es para que el error que suba sea el de verdad —el del
        // servidor—, no el del deshacer, que no le dice nada a nadie.
        await suscripcion.unsubscribe().catch(() => false);
        throw fallo;
      }
    },
    gcTime: 0,
  });
}

/** Sin endpoint la API borra TODOS los dispositivos del alumno: ver `boton-de-push.tsx`. */
export function useBorrarSuscripcion() {
  return useMutation<unknown, ErrorDeApi, string | null>({
    mutationFn: (endpoint) =>
      pedir(
        endpoint === null
          ? '/push/suscripcion'
          : `/push/suscripcion?endpoint=${encodeURIComponent(endpoint)}`,
        { metodo: 'DELETE' },
      ),
    gcTime: 0,
  });
}
