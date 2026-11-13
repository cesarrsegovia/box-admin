import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { dobleDeFetch, dobleQueFalla, llamada, montar } from '@/test/andamiaje-de-hooks';
import { useMarcarPresente } from './use-check-in';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const MARCADO = {
  reservaId: 'res-1',
  turnoId: 'turno-1',
  fecha: '2026-10-03',
  horaInicio: '19:00',
  clase: 'Funcional',
  marcadaEn: '2026-10-03T22:01:00.000Z',
};

describe('useMarcarPresente', () => {
  it('manda POST /checkin con la firma en el cuerpo y devuelve el presente', async () => {
    const doble = dobleDeFetch(MARCADO);
    const { result } = montar(() => useMarcarPresente());

    const datos = await result.current.mutateAsync('firma-del-cartel');

    expect(doble).toHaveBeenCalledTimes(1);
    expect(llamada(doble)).toEqual({
      url: '/api/bx/checkin',
      metodo: 'POST',
      cuerpo: { firma: 'firma-del-cartel' },
    });
    expect(datos).toEqual(MARCADO);
  });

  it('un 401 pasa por el MutationCache', async () => {
    dobleQueFalla(401, 'Unauthorized');
    const espia = vi.fn();
    const cliente = new QueryClient({
      mutationCache: new MutationCache({ onError: espia }),
      defaultOptions: { mutations: { retry: false } },
    });
    const envoltorio = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMarcarPresente(), { wrapper: envoltorio });

    await expect(result.current.mutateAsync('firma-abc')).rejects.toMatchObject({ estado: 401 });

    // Sin esto, la Tarea 3 no prueba nada: es el `MutationCache` el que manda
    // al login, y solo ve las escrituras que pasan por `useMutation`.
    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 401 }),
      'firma-abc',
      undefined,
      expect.anything(),
      expect.anything(),
    );
  });
});
