import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useSubirComprobante } from './use-comprobantes';

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return renderHook(() => useSubirComprobante(), { wrapper: envoltorio });
}

function archivo(nombre = 'transferencia.pdf', tipo = 'application/pdf'): File {
  return new File([new Uint8Array([1, 2, 3])], nombre, { type: tipo });
}

function respuestaDeCreacion(
  id = 'comp-1',
  url = 'http://almacen/abc.pdf?exp=1&firma=ff',
): Response {
  return new Response(JSON.stringify({ comprobante: { id }, urlDeSubida: url }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSubirComprobante', () => {
  it('hace los tres pasos en orden', async () => {
    const llamadas: string[] = [];
    const fetchFalso = vi.fn().mockImplementation((url: string) => {
      llamadas.push(url);
      if (url === '/api/bx/comprobantes') return Promise.resolve(respuestaDeCreacion());
      return Promise.resolve(
        new Response(JSON.stringify({ id: 'comp-1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    expect(llamadas).toEqual([
      '/api/bx/comprobantes',
      // El PUT va DIRECTO al almacen: ni por Next ni por la API. Es para lo que
      // existe la URL firmada.
      'http://almacen/abc.pdf?exp=1&firma=ff',
      '/api/bx/comprobantes/comp-1/confirmar',
    ]);
  });

  it('el PUT manda el archivo crudo, no un JSON ni un FormData', async () => {
    const fetchFalso = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        url === '/api/bx/comprobantes'
          ? respuestaDeCreacion()
          : new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
      ),
    );
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));

    const opcionesDelPut = fetchFalso.mock.calls[1]![1];
    expect(opcionesDelPut.method).toBe('PUT');
    // La URL firmada se emitio para un Content-Type concreto; envolver el
    // archivo cambiaria los bytes y el almacen guardaria basura.
    expect(opcionesDelPut.body).toBeInstanceOf(File);
    expect(opcionesDelPut.headers['content-type']).toBe('application/pdf');
  });

  it('manda el nombre y el tipo reales del archivo', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaDeCreacion());
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo('mi pago.png', 'image/png'));

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(JSON.parse(fetchFalso.mock.calls[0]![1].body)).toEqual({
      nombreOriginal: 'mi pago.png',
      tipoMime: 'image/png',
    });
  });

  it('si el PUT falla, NO confirma', async () => {
    const llamadas: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        llamadas.push(url);
        if (url === '/api/bx/comprobantes') return Promise.resolve(respuestaDeCreacion('c1'));
        return Promise.resolve(new Response('', { status: 403 }));
      }),
    );

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    // Confirmar sin archivo dejaria al admin un comprobante que no se puede
    // abrir. La fila sin confirmar simplemente no le aparece.
    expect(llamadas).not.toContain('/api/bx/comprobantes/c1/confirmar');
  });

  it('rechaza un tipo no admitido antes de molestar al servidor', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);

    const hook = montar();
    hook.result.current.mutate(archivo('virus.exe', 'application/x-msdownload'));

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.error?.message).toMatch(/PDF|imagen/i);
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('sin red durante el PUT, el mensaje lo dice', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url === '/api/bx/comprobantes') return Promise.resolve(respuestaDeCreacion());
        return Promise.reject(new TypeError('Failed to fetch'));
      }),
    );

    const hook = montar();
    hook.result.current.mutate(archivo());

    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.error?.message).toMatch(/conexion/i);
  });
});
