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

/**
 * `retry: false` porque lo que se prueba es que hace el `QueryCache` con el
 * fallo FINAL, no la politica de reintentos: con la de `crearClienteDeDatos`,
 * un `Error` comun se reintenta dos veces con espera y el caso tardaba ~3 s.
 * El `onError` del cache corre igual, una vez, cuando la lectura se rinde.
 */
async function leerConFallo(cliente: QueryClient, error: unknown, clave = 'algo'): Promise<void> {
  await cliente
    .fetchQuery({ queryKey: [clave], queryFn: () => Promise.reject(error), retry: false })
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

  it('una LECTURA con 401 tambien manda al login, con la vuelta a donde estaba', async () => {
    await leerConFallo(crear(), CADUCADA);

    expect(ir.mock.calls).toEqual([
      ['/mi-gym/login?volverA=%2Fmi-gym%2Fadmin%2Fusuarios%3Ftipo%3Dalumno'],
    ]);
  });

  it.each([
    ['un 403', new ErrorDeApi('Forbidden', 403)],
    ['un 404', new ErrorDeApi('No existe', 404)],
    ['sin conexion', new ErrorDeApi('Sin conexion', 0)],
    ['un Error comun', new Error('se rompio')],
  ])('una lectura con %s no navega', async (_caso, error) => {
    await leerConFallo(crear(), error);

    expect(ir).not.toHaveBeenCalled();
  });

  it('una lectura y una escritura con 401 a la vez mandan UNA sola vez', async () => {
    const cliente = crear();

    await Promise.all([
      leerConFallo(cliente, CADUCADA),
      leerConFallo(cliente, CADUCADA, 'otra'),
      escribirConFallo(cliente, CADUCADA),
    ]);

    expect(ir).toHaveBeenCalledTimes(1);
  });

  it('en el login una lectura con 401 no navega: ya esta ahi', async () => {
    const cliente = crearClienteDeDatos(ir, () => ({ pathname: '/mi-gym/login', search: '' }));

    await leerConFallo(cliente, CADUCADA);

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
