import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormularioDeLogin } from './formulario-de-login';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

async function entrar(volverA?: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
  );
  const usuario = userEvent.setup();

  render(<FormularioDeLogin slug="mi-gym" volverA={volverA} />);
  await usuario.type(screen.getByLabelText(/email/i), 'alumna@gym.test');
  await usuario.type(screen.getByLabelText(/contrasena/i), 'secreta');
  await usuario.click(screen.getByRole('button', { name: /entrar/i }));
}

describe('FormularioDeLogin · a donde vuelve', () => {
  it('sin volverA, al calendario de siempre', async () => {
    await entrar();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/calendario'));
  });

  it('con volverA honra el destino, CON su query', async () => {
    // Es el alumno que escaneo el QR de la pared: si no vuelve con la firma,
    // tiene que escanear otra vez.
    await entrar('/mi-gym/checkin?f=abc');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/checkin?f=abc'));
  });

  it('un volverA hacia fuera del dominio NO se obedece', async () => {
    await entrar('https://evil.com');

    await waitFor(() => expect(push).toHaveBeenCalled());
    // El destino sale de `rutaDeRetornoSegura`, nunca del parametro crudo.
    expect(push).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('un volverA hacia OTRO gimnasio tampoco', async () => {
    await entrar('/otro-gimnasio/calendario');

    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/calendario'));
  });
});
