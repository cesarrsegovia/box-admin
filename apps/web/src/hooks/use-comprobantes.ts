'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ComprobanteCreado, ComprobantePublico } from '@boxadmin/shared';
import { ErrorDeApi, pedir } from '@/lib/cliente';
import { claves } from './use-calendario';

/**
 * Los mismos tipos que admite la API (lista blanca en ComprobantesService).
 * Validar aqui no sustituye a la validacion del servidor: le ahorra al alumno
 * subir diez megas para recibir un 409.
 */
const TIPOS_ADMITIDOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

export function useComprobantes() {
  return useQuery({
    queryKey: claves.comprobantes(),
    queryFn: () => pedir<ComprobantePublico[]>('/comprobantes'),
  });
}

/**
 * La subida, en tres pasos.
 *
 * 1. `POST /comprobantes` crea la fila y devuelve una URL firmada.
 * 2. `PUT` del archivo A ESA URL, **directo del navegador al almacen**. No pasa
 *    por Next ni por la API: es exactamente para lo que existen las URLs
 *    presignadas, y es el unico punto de la aplicacion donde el navegador habla
 *    con otro origen (de ahi el CORS de la Task 2).
 * 3. `PATCH .../confirmar` marca que el archivo llego.
 *
 * El tercer paso existe porque ni S3 ni el adaptador local pueden avisar a la
 * API de que el PUT termino.
 */
export function useSubirComprobante() {
  const cliente = useQueryClient();

  return useMutation<ComprobantePublico, ErrorDeApi, File>({
    mutationFn: async (archivo) => {
      if (!TIPOS_ADMITIDOS.includes(archivo.type)) {
        throw new ErrorDeApi('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).', 0);
      }

      const creado = await pedir<ComprobanteCreado>('/comprobantes', {
        metodo: 'POST',
        cuerpo: { nombreOriginal: archivo.name, tipoMime: archivo.type },
      });

      let subida: Response;
      try {
        subida = await fetch(creado.urlDeSubida, {
          method: 'PUT',
          // El archivo crudo, sin envolver. La URL se firmo para este
          // Content-Type; un FormData cambiaria los bytes y el almacen
          // guardaria basura que despues no se puede abrir.
          headers: { 'content-type': archivo.type },
          body: archivo,
        });
      } catch {
        throw new ErrorDeApi('Sin conexion: no se pudo subir el archivo.', 0);
      }

      if (!subida.ok) {
        // Sin confirmar: la fila queda con `subidoEn` en null y no le aparece
        // al admin. Confirmarla le dejaria un comprobante que no se puede abrir.
        throw new ErrorDeApi(
          `No se pudo subir el archivo (${subida.status}). Volve a intentarlo.`,
          subida.status,
        );
      }

      return pedir<ComprobantePublico>(`/comprobantes/${creado.comprobante.id}/confirmar`, {
        metodo: 'PATCH',
      });
    },
    onSuccess: () => cliente.invalidateQueries({ queryKey: claves.comprobantes() }),
  });
}
