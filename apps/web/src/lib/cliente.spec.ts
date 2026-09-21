import { afterEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';

afterEach(() => {
  vi.unstubAllGlobals();
});

function respuestaFalsa(cuerpo: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('pedir', () => {
  it('llama al proxy, no a la API directamente', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa([{ id: 'x' }]));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/mi-calendario?desde=2099-10-01&hasta=2099-10-31');

    // Si esto apuntara a la API, el navegador tendria que mandar el token, y
    // todo el diseño de cookies httpOnly no serviria de nada.
    expect(fetchFalso.mock.calls[0]![0]).toBe(
      '/api/bx/mi-calendario?desde=2099-10-01&hasta=2099-10-31',
    );
  });

  it('nunca manda cabecera de autorizacion', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa([]));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/mi-calendario');

    const cabeceras = new Headers(fetchFalso.mock.calls[0]![1]?.headers);
    expect(cabeceras.get('authorization')).toBeNull();
  });

  it('devuelve el JSON parseado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respuestaFalsa([{ id: 'turno-1' }])));

    const datos = await pedir<{ id: string }[]>('/mi-calendario');

    expect(datos).toEqual([{ id: 'turno-1' }]);
  });

  it('manda el cuerpo como JSON en un POST', async () => {
    const fetchFalso = vi.fn().mockResolvedValue(respuestaFalsa({ id: 'r1' }, { status: 201 }));
    vi.stubGlobal('fetch', fetchFalso);

    await pedir('/comprobantes', { metodo: 'POST', cuerpo: { tipoMime: 'application/pdf' } });

    const opciones = fetchFalso.mock.calls[0]![1];
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(opciones.body)).toEqual({ tipoMime: 'application/pdf' });
  });

  it('un error de la API llega como ErrorDeApi con su mensaje y su estado', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          respuestaFalsa(
            { message: 'Este turno esta completo (1/1).', statusCode: 409 },
            { status: 409 },
          ),
        ),
    );

    // El mensaje de la API es el que ve el alumno: se escribio para el, y
    // sustituirlo por uno generico seria tirar informacion util.
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 409,
      message: 'Este turno esta completo (1/1).',
    });
  });

  it('un 204 no intenta parsear cuerpo', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(pedir('/lista-espera/le-1', { metodo: 'DELETE' })).resolves.toBeNull();
  });

  it('sin red, el error dice que no hay conexion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    // Es lo que ve el alumno offline al intentar reservar: un mensaje claro,
    // no un fallo silencioso.
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toMatchObject({
      name: 'ErrorDeApi',
      estado: 0,
    });
    await expect(pedir('/turnos/t1/mi-reserva', { metodo: 'POST' })).rejects.toThrow(/conexion/i);
  });

  it('un 401 se distingue, para poder mandar al login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuestaFalsa({ message: 'Sin sesion' }, { status: 401 })),
    );

    await expect(pedir('/mi-calendario')).rejects.toMatchObject({ estado: 401 });
  });

  it('un error sin cuerpo util no deja al alumno sin mensaje', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));

    await expect(pedir('/mi-calendario')).rejects.toThrow(/500/);
  });
});
