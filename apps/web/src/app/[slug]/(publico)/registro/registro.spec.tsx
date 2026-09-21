import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormularioDeRegistro } from './formulario-de-registro';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

function campos() {
  return {
    nombre: screen.getByLabelText(/nombre/i),
    email: screen.getByLabelText(/email/i),
    codigo: screen.getByLabelText(/clave/i),
    password: screen.getByLabelText(/contrase/i),
    enviar: screen.getByRole('button', { name: /crear mi cuenta/i }),
  };
}

async function rellenarYEnviar(codigo = 'a'.repeat(32)) {
  const usuario = userEvent.setup();
  const c = campos();

  await usuario.type(c.nombre, 'Ana Perez');
  await usuario.type(c.email, 'ana@ejemplo.com');
  await usuario.type(c.codigo, codigo);
  await usuario.type(c.password, 'Password123!');
  await usuario.click(c.enviar);
}

describe('FormularioDeRegistro', () => {
  it('exige una clave de 32 caracteres antes de molestar al servidor', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    render(<FormularioDeRegistro slug="mi-gym" />);

    await rellenarYEnviar('corta');

    expect(await screen.findByText(/32 caracteres/i)).toBeInTheDocument();
    // Validar en el cliente no sustituye a la API: le ahorra al alumno un viaje
    // y un 401 que no explica nada, porque la API devuelve el mismo mensaje
    // para las cuatro formas de clave invalida.
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('manda el slug de la URL, que el alumno no escribe', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ usuario: { id: 'u1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    render(<FormularioDeRegistro slug="mi-gym" />);

    await rellenarYEnviar();

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    const cuerpo = JSON.parse(fetchFalso.mock.calls[0]![1].body) as Record<string, unknown>;
    expect(cuerpo.tenantSlug).toBe('mi-gym');
    expect(cuerpo).not.toHaveProperty('rol');
  });

  it('llama al BFF, nunca a la API', async () => {
    const fetchFalso = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ usuario: { id: 'u1' } }), { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);
    render(<FormularioDeRegistro slug="mi-gym" />);

    await rellenarYEnviar();

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    expect(fetchFalso.mock.calls[0]![0]).toBe('/api/auth/auto-registro');
  });

  it('tras el alta lleva al calendario de SU gimnasio', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ usuario: { id: 'u1' } }), { status: 201 }),
        ),
    );
    render(<FormularioDeRegistro slug="mi-gym" />);

    await rellenarYEnviar();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/mi-gym/calendario'));
  });

  it('muestra el error de la API tal cual', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: 'Clave de invitacion invalida' }), {
          status: 401,
        }),
      ),
    );
    render(<FormularioDeRegistro slug="mi-gym" />);

    await rellenarYEnviar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Clave de invitacion invalida');
    expect(push).not.toHaveBeenCalled();
  });

  it('un email invalido no llega al servidor', async () => {
    const fetchFalso = vi.fn();
    vi.stubGlobal('fetch', fetchFalso);
    render(<FormularioDeRegistro slug="mi-gym" />);

    const usuario = userEvent.setup();
    const c = campos();
    await usuario.type(c.nombre, 'Ana');
    await usuario.type(c.email, 'esto-no-es-un-email');
    await usuario.type(c.codigo, 'a'.repeat(32));
    await usuario.type(c.password, 'Password123!');
    await usuario.click(c.enviar);

    expect(await screen.findByText(/no parece valido/i)).toBeInTheDocument();
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});
