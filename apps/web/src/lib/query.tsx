'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ErrorDeApi } from './cliente';
import { destinoSiCaducoLaSesion } from './sesion-caducada';

/**
 * El cliente de datos de la app.
 *
 * UN 401 MANDA AL LOGIN, desde aqui y para todo: lecturas y escrituras. Antes
 * solo las escrituras; las lecturas dependian de que cada pantalla atajara el
 * 401 de su lectura principal, y las que no lo hacian —las cinco de
 * configuracion, mi-pack, los comprobantes y el calendario del alumno, y las
 * lecturas internas de las fichas— se quedaban pintando «Unauthorized».
 *
 * Las pantallas que ya atajan su 401 con su propio `router.push` lo siguen
 * haciendo, y eso es UNA CARRERA CONOCIDA, no una redundancia limpia: si el
 * `router.push` de la pantalla gana, la navegacion es del router y esta cache
 * no se tira; y las pantallas que arman el destino con `SIN_QUERY` mandan a
 * otro `volverA` cuando la URL lleva query. Se acepta porque las dos salidas
 * terminan en el login de ese gimnasio.
 *
 * `window.location.assign` y no el router: la recarga entera tira esta cache, y
 * con ella cualquier dato de la sesion que vencio. `saliendo` es UNO para los
 * dos caches: una lectura y una escritura que fallan juntas navegan una vez.
 * `ir` y `donde` se inyectan solo para los tests: el guardian de consola
 * prohibe a un spec mover la URL del documento, asi que el spec no puede
 * ponerse en `/mi-gym/admin/...`.
 */
export function crearClienteDeDatos(
  ir: (destino: string) => void = (destino) => window.location.assign(destino),
  donde: () => { pathname: string; search: string } = () => window.location,
): QueryClient {
  let saliendo = false;

  const alFallar = (error: Error): void => {
    if (saliendo) return;
    const destino = destinoSiCaducoLaSesion(error, donde());
    if (destino === null) return;
    saliendo = true;
    ir(destino);
  };

  return new QueryClient({
    queryCache: new QueryCache({ onError: alFallar }),
    mutationCache: new MutationCache({ onError: alFallar }),
    defaultOptions: {
      queries: {
        // Un calendario de hace medio minuto sigue siendo util, y evita
        // recargar entero cada vez que el alumno cambia de pestaña.
        staleTime: 30_000,
        retry: (intentos, error) => {
          // Reintentar un 401 o un 403 no los va a arreglar, y reintentar
          // sin red solo retrasa el mensaje que el alumno necesita ver.
          if (error instanceof ErrorDeApi) {
            if (error.esSinConexion) return false;
            if (error.estado >= 400 && error.estado < 500) return false;
          }
          return intentos < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

/**
 * El cliente se crea DENTRO de un useState y no como constante de modulo.
 *
 * Con una constante, todos los usuarios de un mismo proceso de servidor
 * compartirian cache — es decir, un alumno podria ver datos de otro. Es el
 * error clasico de montar React Query en Next, y el sitio donde se paga es
 * imposible de reproducir en desarrollo con un solo usuario.
 */
export function ProveedorDeDatos({ children }: { children: ReactNode }) {
  const [cliente] = useState(() => crearClienteDeDatos());

  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
