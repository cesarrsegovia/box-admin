import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotonDeSalir } from './boton-de-salir';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('BotonDeSalir', () => {
  it('llama al logout del BFF y vuelve al login del gimnasio', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchFalso);
    const usuario = userEvent.setup();

    render(<BotonDeSalir slug="mi-gym" />);
    await usuario.click(screen.getByRole('button', { name: /cerrar sesion/i }));

    await waitFor(() =>
      expect(fetchFalso).toHaveBeenCalledWith('/api/auth/logout', expect.anything()),
    );
    expect(push).toHaveBeenCalledWith('/mi-gym/login');
  });

  it('si la API falla, IGUAL saca al alumno', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const usuario = userEvent.setup();

    render(<BotonDeSalir slug="mi-gym" />);
    await usuario.click(screen.getByRole('button', { name: /cerrar sesion/i }));

    // Un logout que deja al usuario "dentro" porque la red fallo es peor que
    // uno que no revoca: el navegador tiene que quedar limpio igual.
    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/login'));
  });

  it('nunca llama a la API directamente: el token no esta en el navegador', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    vi.stubGlobal('fetch', fetchFalso);
    const usuario = userEvent.setup();

    render(<BotonDeSalir slug="mi-gym" />);
    await usuario.click(screen.getByRole('button', { name: /cerrar sesion/i }));

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(fetchFalso.mock.calls[0]![0]).toBe('/api/auth/logout');
  });
});
