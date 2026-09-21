import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { TurnoDisponible } from '@boxadmin/shared';
import { claves } from './use-calendario';
import { useAccionesDeTurno } from './use-acciones-de-turno';

const DESDE = '2099-10-12';
const HASTA = '2099-10-18';

const TURNO: TurnoDisponible = {
  turnoId: 'turno-1',
  salaId: 'sala-1',
  nombre: 'Pilates',
  fecha: '2099-10-13',
  horaInicio: '18:00',
  horaFin: '19:00',
  disponibilidad: {
    turnoId: 'turno-1',
    estado: 'LIBRE',
    cupo: 5,
    ocupados: 1,
    puedeReservar: true,
    motivo: null,
    enListaEspera: false,
    posicionEnLista: null,
  },
};

function montar() {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cliente.setQueryData(claves.turnosDisponibles(DESDE, HASTA), [TURNO]);

  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  const hook = renderHook(() => useAccionesDeTurno(DESDE, HASTA), { wrapper: envoltorio });

  return { cliente, hook };
}

function turnoEnCache(cliente: QueryClient): TurnoDisponible {
  const lista = cliente.getQueryData<TurnoDisponible[]>(claves.turnosDisponibles(DESDE, HASTA));
  return lista![0]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useAccionesDeTurno — reservar', () => {
  it('marca el turno como reservado ANTES de que responda el servidor', async () => {
    let resolver: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolver = r))),
    );
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    // Es todo el objetivo del optimismo: la interfaz responde ya.
    await waitFor(() => {
      expect(turnoEnCache(cliente).disponibilidad.motivo).toBe('YA_RESERVADO');
    });
    expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(2);

    resolver(new Response(JSON.stringify({ id: 'r1' }), { status: 201 }));
  });

  it('REVIERTE si la API rechaza la reserva', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Este turno esta completo (5/5).' }), {
          status: 409,
        }),
      ),
    );
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));

    // Dejar la reserva pintada seria mandar al alumno a una clase en la que no
    // esta anotado. Peor que una interfaz lenta.
    expect(turnoEnCache(cliente).disponibilidad.motivo).toBeNull();
    expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(1);
  });

  it('conserva el mensaje de la API para poder mostrarlo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Ya paso el plazo para anotarse.' }), {
          status: 409,
        }),
      ),
    );
    const { hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));
    expect(hook.result.current.reservar.error?.message).toBe('Ya paso el plazo para anotarse.');
  });

  it('llama al endpoint correcto', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'r1' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    const { hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isSuccess).toBe(true));
    expect(fetchFalso.mock.calls[0]![0]).toBe('/api/bx/turnos/turno-1/mi-reserva');
    expect(fetchFalso.mock.calls[0]![1].method).toBe('POST');
  });
});

describe('useAccionesDeTurno — cancelar', () => {
  it('libera el lugar de forma optimista', async () => {
    let resolver: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolver = r))),
    );
    const { cliente, hook } = montar();

    hook.result.current.cancelar.mutate({ turnoId: 'turno-1', reservaId: 'r1' });

    await waitFor(() => {
      expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(0);
    });
    expect(turnoEnCache(cliente).disponibilidad.puedeReservar).toBe(true);

    resolver(new Response(JSON.stringify({ id: 'r1' }), { status: 200 }));
  });

  it('revierte si la API rechaza la cancelacion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Ya paso el plazo para cancelar' }), {
          status: 409,
        }),
      ),
    );
    const { cliente, hook } = montar();

    hook.result.current.cancelar.mutate({ turnoId: 'turno-1', reservaId: 'r1' });

    await waitFor(() => expect(hook.result.current.cancelar.isError).toBe(true));
    expect(turnoEnCache(cliente).disponibilidad.ocupados).toBe(1);
  });
});

describe('useAccionesDeTurno — lista de espera', () => {
  it('marca la cola de forma optimista y revierte si falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ message: 'Este turno tiene cupo' }), { status: 409 }),
        ),
    );
    const { cliente, hook } = montar();

    hook.result.current.anotarme.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.anotarme.isError).toBe(true));
    expect(turnoEnCache(cliente).disponibilidad.enListaEspera).toBe(false);
  });

  it('no inventa una posicion en la cola', async () => {
    let resolver: (r: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise<Response>((r) => (resolver = r))),
    );
    const { cliente, hook } = montar();

    hook.result.current.anotarme.mutate('turno-1');

    await waitFor(() => {
      expect(turnoEnCache(cliente).disponibilidad.enListaEspera).toBe(true);
    });
    // La posicion real la decide el servidor. Inventar un "1" seria mentir
    // sobre algo que el alumno va a comparar con la realidad.
    expect(turnoEnCache(cliente).disponibilidad.posicionEnLista).toBeNull();

    resolver(new Response(JSON.stringify({ posicion: 3 }), { status: 201 }));
  });
});

describe('useAccionesDeTurno — sin conexion', () => {
  it('el error dice que falta conexion y la interfaz vuelve atras', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const { cliente, hook } = montar();

    hook.result.current.reservar.mutate('turno-1');

    await waitFor(() => expect(hook.result.current.reservar.isError).toBe(true));
    // Offline se lee, no se escribe, y se dice.
    expect(hook.result.current.reservar.error?.message).toMatch(/conexion/i);
    expect(turnoEnCache(cliente).disponibilidad.motivo).toBeNull();
  });
});
