import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { dobleDe204, dobleQueFalla, llamada, montar } from '@/test/andamiaje-de-hooks';
import { useBorrarSuscripcion, useGuardarSuscripcion } from './use-push';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Lo que tiene que viajar: la suscripcion serializada, como la deja `serializar` de `lib/push`. */
const SERIALIZADA = {
  endpoint: 'https://push.example/abc',
  p256dh: 'clave-publica',
  auth: 'secreto',
};

/**
 * Una `PushSubscription` de mentira: el hook recibe la del navegador y la
 * serializa el. `unsubscribe` se puede sustituir para mirar el orden.
 */
function suscripcionFalsa(unsubscribe = vi.fn().mockResolvedValue(true)) {
  const falsa = {
    endpoint: SERIALIZADA.endpoint,
    toJSON: () => ({
      endpoint: SERIALIZADA.endpoint,
      keys: { p256dh: SERIALIZADA.p256dh, auth: SERIALIZADA.auth },
    }),
    unsubscribe,
  };
  return falsa as unknown as PushSubscription & { unsubscribe: typeof unsubscribe };
}

/**
 * Monta el hook con un `MutationCache` espiado: es el que, en la app, manda al
 * login ante un 401. Si la escritura no pasa por ahi, el espia no se entera.
 */
function montarConCacheEspiada<T>(hook: () => T, espia = vi.fn()) {
  const cliente = new QueryClient({
    mutationCache: new MutationCache({ onError: espia }),
    defaultOptions: { mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return { ...renderHook(hook, { wrapper: envoltorio }), espia };
}

describe('useGuardarSuscripcion', () => {
  it('manda POST /push/suscripcion con la suscripcion serializada', async () => {
    const doble = dobleDe204();
    const suscripcion = suscripcionFalsa();
    const { result } = montar(() => useGuardarSuscripcion());

    await result.current.mutateAsync(suscripcion);

    expect(doble).toHaveBeenCalledTimes(1);
    expect(llamada(doble)).toEqual({
      url: '/api/bx/push/suscripcion',
      metodo: 'POST',
      cuerpo: SERIALIZADA,
    });
    // Si el servidor se la quedo, el navegador tambien.
    expect(suscripcion.unsubscribe).not.toHaveBeenCalled();
  });

  it('un 401 pasa por el MutationCache', async () => {
    dobleQueFalla(401, 'Unauthorized');
    const suscripcion = suscripcionFalsa();
    const { result, espia } = montarConCacheEspiada(() => useGuardarSuscripcion());

    await expect(result.current.mutateAsync(suscripcion)).rejects.toMatchObject({ estado: 401 });

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 401 }),
      suscripcion,
      undefined,
      expect.anything(),
      expect.anything(),
    );
  });

  it('si el POST falla, desuscribe el navegador ANTES de que se entere el MutationCache', async () => {
    // En TanStack v5 el `onError` del cache corre ANTES de que `mutateAsync`
    // rechace, y en la app ese `onError` navega al login ante un 401. Un
    // deshacer en el `catch` de la pantalla compite con la descarga de la
    // pagina; dentro del `mutationFn` ya termino cuando el cache se entera.
    dobleQueFalla(401, 'Unauthorized');
    const orden: string[] = [];
    const suscripcion = suscripcionFalsa(
      vi.fn().mockImplementation(async () => {
        orden.push('unsubscribe');
        return true;
      }),
    );
    const espia = vi.fn().mockImplementation(() => {
      orden.push('cache');
    });
    const { result } = montarConCacheEspiada(() => useGuardarSuscripcion(), espia);

    await expect(result.current.mutateAsync(suscripcion)).rejects.toMatchObject({ estado: 401 });

    expect(orden).toEqual(['unsubscribe', 'cache']);
  });

  it('si ademas falla el unsubscribe, el error que sale es el del servidor', async () => {
    dobleQueFalla(500, 'Se cayo la base');
    const suscripcion = suscripcionFalsa(
      vi.fn().mockRejectedValue(new Error('el navegador dijo que no')),
    );
    const { result } = montar(() => useGuardarSuscripcion());

    await expect(result.current.mutateAsync(suscripcion)).rejects.toMatchObject({
      estado: 500,
      message: 'Se cayo la base',
    });
    expect(suscripcion.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('useBorrarSuscripcion', () => {
  it('con endpoint manda DELETE con el endpoint codificado', async () => {
    const doble = dobleDe204();
    const { result } = montar(() => useBorrarSuscripcion());

    await result.current.mutateAsync('https://push.example/a b?c=d&e');

    expect(doble).toHaveBeenCalledTimes(1);
    expect(llamada(doble)).toEqual({
      url: `/api/bx/push/suscripcion?endpoint=${encodeURIComponent('https://push.example/a b?c=d&e')}`,
      metodo: 'DELETE',
      cuerpo: undefined,
    });
  });

  it('sin endpoint manda DELETE a la ruta pelada (borra todos los dispositivos)', async () => {
    const doble = dobleDe204();
    const { result } = montar(() => useBorrarSuscripcion());

    await result.current.mutateAsync(null);

    expect(llamada(doble)).toEqual({
      url: '/api/bx/push/suscripcion',
      metodo: 'DELETE',
      cuerpo: undefined,
    });
  });

  it('un 401 pasa por el MutationCache', async () => {
    dobleQueFalla(401, 'Unauthorized');
    const { result, espia } = montarConCacheEspiada(() => useBorrarSuscripcion());

    await expect(result.current.mutateAsync('https://push.example/abc')).rejects.toMatchObject({
      estado: 401,
    });

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith(
      expect.objectContaining({ estado: 401 }),
      'https://push.example/abc',
      undefined,
      expect.anything(),
      expect.anything(),
    );
  });
});
