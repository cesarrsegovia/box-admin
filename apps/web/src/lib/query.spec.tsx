import { afterEach, describe, expect, it, vi } from 'vitest';
import type { QueryClient } from '@tanstack/react-query';
import { ErrorDeApi } from './cliente';
import { crearClienteDeDatos } from './query';

const CADUCADA = new ErrorDeApi('Unauthorized', 401);

const ir = vi.fn();

// El guardian global de consola prohibe a un spec mover la URL del documento
// (`pushState` y compania), asi que la ubicacion se inyecta en vez de fijarla.
const donde = () => ({ pathname: '/mi-gym/admin/usuarios', search: '?tipo=alumno' });

afterEach(() => {
  ir.mockReset();
});

function crear(): QueryClient {
  return crearClienteDeDatos(ir, donde);
}

async function escribirConFallo(cliente: QueryClient, error: unknown): Promise<void> {
  await cliente
    .getMutationCache()
    .build(cliente, { mutationFn: () => Promise.reject(error) })
    .execute(undefined)
    .catch(() => undefined);
}

describe('crearClienteDeDatos', () => {
  it('una escritura con 401 manda al login, con la vuelta a donde estaba', async () => {
    const cliente = crear();

    await escribirConFallo(cliente, CADUCADA);

    expect(ir.mock.calls).toEqual([
      ['/mi-gym/login?volverA=%2Fmi-gym%2Fadmin%2Fusuarios%3Ftipo%3Dalumno'],
    ]);
  });

  it('dos escrituras con 401 mandan UNA sola vez', async () => {
    const cliente = crear();

    await Promise.all([escribirConFallo(cliente, CADUCADA), escribirConFallo(cliente, CADUCADA)]);

    expect(ir).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['un 403', new ErrorDeApi('Forbidden', 403)],
    ['un 400', new ErrorDeApi('nombre should not be empty', 400)],
    ['un Error comun', new Error('se rompio')],
  ])('una escritura con %s no navega', async (_caso, error) => {
    await escribirConFallo(crear(), error);

    expect(ir).not.toHaveBeenCalled();
  });

  it('una LECTURA con 401 no lo dispara: eso lo decide cada pantalla', async () => {
    const cliente = crear();

    await cliente
      .fetchQuery({ queryKey: ['algo'], queryFn: () => Promise.reject(CADUCADA) })
      .catch(() => undefined);

    expect(ir).not.toHaveBeenCalled();
  });

  it('conserva los valores por defecto de siempre', () => {
    const opciones = crear().getDefaultOptions();

    expect(opciones.queries?.staleTime).toBe(30_000);
    expect(opciones.mutations?.retry).toBe(false);
  });

  it('cada cliente es nuevo: dos llamadas no comparten cache', () => {
    expect(crear()).not.toBe(crear());
  });
});
