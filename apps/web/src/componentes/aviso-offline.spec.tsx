import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AvisoOffline, textoDeAntiguedad } from './aviso-offline';

afterEach(() => {
  vi.unstubAllGlobals();
});

function conConexion(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
}

describe('textoDeAntiguedad', () => {
  it('menos de un minuto se dice "hace instantes"', () => {
    expect(textoDeAntiguedad(30_000)).toMatch(/instantes/i);
  });

  it('los minutos se cuentan', () => {
    expect(textoDeAntiguedad(5 * 60_000)).toMatch(/5 minutos/);
  });

  it('a partir de una hora se cuentan horas', () => {
    expect(textoDeAntiguedad(3 * 60 * 60_000)).toMatch(/3 horas/);
  });

  it('un dia entero se dice en singular', () => {
    expect(textoDeAntiguedad(26 * 60 * 60_000)).toMatch(/1 dia/);
  });

  it('dos dias, en plural', () => {
    expect(textoDeAntiguedad(50 * 60 * 60_000)).toMatch(/2 dias/);
  });
});

describe('AvisoOffline', () => {
  it('con conexion no molesta', async () => {
    conConexion(true);
    const { container } = render(<AvisoOffline actualizadoEn={Date.now() - 60_000} />);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('sin conexion dice de cuando son los datos', async () => {
    conConexion(false);
    render(<AvisoOffline actualizadoEn={Date.now() - 5 * 60_000} />);

    // Un calendario viejo SIN fecha es peor que no tenerlo: el alumno no sabe
    // si puede fiarse.
    expect(await screen.findByText(/5 minutos/)).toBeInTheDocument();
    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
  });

  it('sin datos cacheados, lo dice sin inventar una fecha', async () => {
    conConexion(false);
    render(<AvisoOffline actualizadoEn={0} />);

    expect(await screen.findByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.queryByText(/hace/i)).toBeNull();
  });
});
