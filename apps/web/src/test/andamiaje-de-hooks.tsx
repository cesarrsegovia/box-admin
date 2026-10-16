import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

/**
 * EL ANDAMIAJE DE LOS SPECS DE HOOKS, EN UN SOLO SITIO.
 *
 * `montar`, `dobleDeFetch` y `llamada` nacieron copiados dentro de
 * `use-turnos.spec` y de ahi se replicaron. Esa duplicacion es la misma que
 * `src/test/mutaciones-sin-gctime.ts` documenta y condena: un andamiaje
 * copiado se arregla en una copia y se queda roto en las otras cuatro.
 *
 * Los specs viejos siguen con su copia a proposito —tocarlos no es de esta
 * tarea— y los cuatro de la Fase 10 usan este.
 */

/**
 * Monta el hook con su propio `QueryClient` y lo devuelve junto al cliente,
 * para poder espiar las invalidaciones y mirar que quedo en la cache.
 */
export function montar<T>(hook: () => T) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return { ...renderHook(hook, { wrapper: envoltorio }), cliente };
}

/** Un `fetch` que siempre responde 200 con el JSON que se le pase. */
export function dobleDeFetch(datos: unknown = {}) {
  const doble = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(datos), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', doble);
  return doble;
}

/** Un `fetch` que responde 204 y sin cuerpo, como el borrado de un horario. */
export function dobleDe204() {
  const doble = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', doble);
  return doble;
}

/**
 * Un `fetch` que SIEMPRE falla con ese estado.
 *
 * Para el camino de error, que es el unico donde se ve si una escritura se
 * reintenta. Todos los tests de conteo de peticiones corren sobre respuestas
 * 200, y ahi un reintento es invisible porque no llega a haberlo.
 */
export function dobleQueFalla(estado = 409, mensaje = 'Se pisa con otra') {
  const doble = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify({ message: mensaje }), {
        status: estado,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', doble);
  return doble;
}

export interface LlamadaVista {
  url: string;
  metodo: string;
  cuerpo: unknown;
}

/** Lo que `pedir` acabo mandando al navegador, ya desmenuzado. */
export function llamada(doble: ReturnType<typeof dobleDeFetch>, indice = 0): LlamadaVista {
  const argumentos = doble.mock.calls[indice] as [string, RequestInit] | undefined;
  if (argumentos === undefined) throw new Error(`No hubo llamada numero ${indice}`);

  const [url, opciones] = argumentos;
  return {
    url,
    metodo: String(opciones.method),
    cuerpo: typeof opciones.body === 'string' ? JSON.parse(opciones.body) : undefined,
  };
}

/** Todo lo que haya en la cache de CONSULTAS de ese cliente, como texto. */
export function cacheDeConsultas(cliente: QueryClient): { entradas: number; texto: string } {
  const todas = cliente.getQueryCache().getAll();
  return {
    entradas: todas.length,
    texto: JSON.stringify(todas.map((consulta) => [consulta.queryKey, consulta.state.data])),
  };
}
