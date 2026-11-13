'use client';

import { useMutation } from '@tanstack/react-query';
import type { PresenteMarcado } from '@boxadmin/shared';
import { type ErrorDeApi, pedir } from '@/lib/cliente';

/**
 * Marcar el presente con la firma del QR.
 *
 * `useMutation` para que un 401 lo vea el `MutationCache` y mande al login. El
 * destino conserva la URL entera —`/{slug}/checkin?f=<firma>`—, asi que el
 * alumno vuelve con la firma y no tiene que escanear otra vez. `gcTime: 0`
 * porque la firma es la llave del presente.
 */
export function useMarcarPresente() {
  return useMutation<PresenteMarcado, ErrorDeApi, string>({
    mutationFn: (firma) =>
      pedir<PresenteMarcado>('/checkin', { metodo: 'POST', cuerpo: { firma } }),
    gcTime: 0,
  });
}
