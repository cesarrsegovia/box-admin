'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ErrorDeApi } from './cliente';

/**
 * El cliente se crea DENTRO de un useState y no como constante de modulo.
 *
 * Con una constante, todos los usuarios de un mismo proceso de servidor
 * compartirian cache — es decir, un alumno podria ver datos de otro. Es el
 * error clasico de montar React Query en Next, y el sitio donde se paga es
 * imposible de reproducir en desarrollo con un solo usuario.
 */
export function ProveedorDeDatos({ children }: { children: ReactNode }) {
  const [cliente] = useState(
    () =>
      new QueryClient({
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
      }),
  );

  return <QueryClientProvider client={cliente}>{children}</QueryClientProvider>;
}
