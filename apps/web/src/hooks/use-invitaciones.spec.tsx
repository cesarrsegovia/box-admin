import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import { useCambiarActiva, useGuardarClave } from './use-invitaciones';

/**
 * EL PRIMER SPEC DE ESTE HOOK, y existe por una sola propiedad.
 *
 * `use-invitaciones.ts` se probaba entero desde la pantalla
 * (`app/[slug]/admin/invitaciones/page.spec.tsx`), que es donde viven sus 48
 * tests de DOM, de rutas, de cuerpos y de los dos almacenes. Lo que ahi no se
 * puede ver es el ALCANCE de la invalidacion: la pantalla monta un solo arbol
 * y no hay ninguna consulta ajena a la que la diferencia entre invalidar
 * `['invitaciones']` e invalidar TODO pueda notarse.
 *
 * Es el mismo punto ciego que `use-usuarios`, `use-calendario-admin` y
 * `use-turnos`, y no es de ninguno de los cuatro: es de la FORMA de probar
 * hooks en este proyecto. Ver `src/test/consulta-ajena.ts`.
 */
function montar<T>(hook: () => T) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return { ...renderHook(hook, { wrapper: envoltorio }), cliente };
}

/** Un `fetch` que siempre responde 200 con el JSON que se le pase. */
function dobleDeFetch(datos: unknown) {
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

/** Una clave como la que devuelve la API, con su `codigo` dentro. */
const CLAVE = {
  id: 'i1',
  tenantId: 'g1',
  codigo: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  activa: true,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('una escritura no refresca consultas ajenas', () => {
  it('crear una clave', async () => {
    dobleDeFetch(CLAVE);

    const { result, cliente } = montar(() => useGuardarClave(undefined));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ activa: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('editar una clave', async () => {
    dobleDeFetch(CLAVE);

    const { result, cliente } = montar(() => useGuardarClave('i1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ activa: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('prender o apagar una clave', async () => {
    dobleDeFetch(CLAVE);

    const { result, cliente } = montar(() => useCambiarActiva());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ id: 'i1', activa: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });
});
