import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormularioDeLogin } from './formulario-de-login';

const empujar = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: empujar, refresh: vi.fn() }) }));

afterEach(() => {
  vi.unstubAllGlobals();
  empujar.mockClear();
});

/**
 * El doble del BFF. Su respuesta lleva el usuario, y de ahi sale el rol: no
 * hace falta ninguna peticion extra para saber a donde mandar a quien entra.
 */
function servidorResponde(cuerpo: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(JSON.stringify(cuerpo), { status: 200 })),
  );
}

async function entrar({ volverA }: { volverA?: string } = {}) {
  const usuario = userEvent.setup();

  render(<FormularioDeLogin slug="mi-gym" volverA={volverA} />);
  await usuario.type(screen.getByLabelText(/email/i), 'alumna@gym.test');
  await usuario.type(screen.getByLabelText(/contrasena/i), 'secreta');
  await usuario.click(screen.getByRole('button', { name: /entrar/i }));

  // El envio es asincrono: se espera aqui para que cada test pueda afirmar
  // sobre el destino sin repetir el `waitFor`.
  await waitFor(() => expect(empujar).toHaveBeenCalled());
}

describe('FormularioDeLogin · a donde vuelve', () => {
  it('sin volverA, al calendario de siempre', async () => {
    servidorResponde({ usuario: { rol: 'ALUMNO' } });
    await entrar();

    expect(empujar).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('con volverA honra el destino, CON su query', async () => {
    // Es el alumno que escaneo el QR de la pared: si no vuelve con la firma,
    // tiene que escanear otra vez.
    servidorResponde({ usuario: { rol: 'ALUMNO' } });
    await entrar({ volverA: '/mi-gym/checkin?f=abc' });

    expect(empujar).toHaveBeenCalledWith('/mi-gym/checkin?f=abc');
  });

  it('un volverA hacia fuera del dominio NO se obedece', async () => {
    servidorResponde({ usuario: { rol: 'ALUMNO' } });
    await entrar({ volverA: 'https://evil.com' });

    // El destino sale de `rutaDeRetornoSegura`, nunca del parametro crudo.
    expect(empujar).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('un volverA hacia OTRO gimnasio tampoco', async () => {
    servidorResponde({ usuario: { rol: 'ALUMNO' } });
    await entrar({ volverA: '/otro-gimnasio/calendario' });

    expect(empujar).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('un admin cae en el PANEL, no en el calendario', async () => {
    servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });
    await entrar();
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin');
  });

  it('un alumno sigue cayendo en el calendario', async () => {
    servidorResponde({ usuario: { rol: 'ALUMNO' } });
    await entrar();
    expect(empujar).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('el volverA valido gana al destino por rol', async () => {
    servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });
    await entrar({ volverA: '/mi-gym/checkin?f=abc' });
    expect(empujar).toHaveBeenCalledWith('/mi-gym/checkin?f=abc');
  });

  it('se navega UNA sola vez: nadie pasa por el panel de camino a su volverA', async () => {
    // Un `push` de mas no lo ve ningun `toHaveBeenCalledWith`, que solo exige
    // "se llamo al menos una vez con esto". Solo lo ve contar las llamadas.
    // Y hace falta: el admin que venia del QR de la pared tiene que acabar en
    // el checkin, no asomarse al panel por el camino.
    servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });
    await entrar({ volverA: '/mi-gym/checkin?f=abc' });

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/checkin?f=abc');
  });

  it('un volverA de otro gimnasio cae al destino del rol', async () => {
    servidorResponde({ usuario: { rol: 'ADMIN_OPERATIVO' } });
    await entrar({ volverA: '/otro-gimnasio/admin' });
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin');
  });
});
