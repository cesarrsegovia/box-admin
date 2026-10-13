import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  queryDeFiltros,
  useActualizarSalas,
  useActualizarUsuario,
  useCrearPersona,
  useDarDeBaja,
  useFijarEstadoDePago,
  useResetearPassword,
  useUsuario,
  useUsuarios,
} from './use-usuarios';

// ---------------------------------------------------------------------------
// La funcion pura
// ---------------------------------------------------------------------------

describe('queryDeFiltros', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeFiltros({})).toBe('');
  });

  it('un booleano en false SI se manda', () => {
    // `activo: false` es un filtro ("damelos de baja"), no la ausencia de
    // filtro. Un `if (filtros.activo)` se lo comeria.
    expect(queryDeFiltros({ activo: false })).toBe('?activo=false');
  });

  it('un booleano en true se manda', () => {
    expect(queryDeFiltros({ activo: true })).toBe('?activo=true');
  });

  it('una sala vacia NO se manda', () => {
    expect(queryDeFiltros({ salaId: '' })).toBe('');
  });

  it('manda los cuatro juntos', () => {
    expect(
      queryDeFiltros({ tipo: 'alumno', salaId: 's1', activo: true, autoRegistrado: false }),
    ).toBe('?tipo=alumno&salaId=s1&activo=true&autoRegistrado=false');
  });
});

// ---------------------------------------------------------------------------
// Andamiaje de los hooks
// ---------------------------------------------------------------------------

/**
 * Monta el hook con su propio `QueryClient` y lo devuelve junto al cliente,
 * para poder espiar las invalidaciones.
 */
function montar<T>(hook: () => T) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return { ...renderHook(hook, { wrapper: envoltorio }), cliente };
}

/** Un `fetch` que siempre responde 200 con el JSON que se le pase. */
function dobleDeFetch(datos: unknown = { id: 'u1' }) {
  const doble = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(datos), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', doble);
  return doble;
}

interface LlamadaVista {
  url: string;
  metodo: string;
  cuerpo: unknown;
}

/** Lo que `pedir` acabo mandando al navegador, ya desmenuzado. */
function llamada(doble: ReturnType<typeof dobleDeFetch>, indice = 0): LlamadaVista {
  const argumentos = doble.mock.calls[indice] as [string, RequestInit] | undefined;
  if (argumentos === undefined) throw new Error(`No hubo llamada numero ${indice}`);

  const [url, opciones] = argumentos;
  return {
    url,
    metodo: String(opciones.method),
    cuerpo: typeof opciones.body === 'string' ? JSON.parse(opciones.body) : undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

describe('useUsuarios', () => {
  it('pide la ruta exacta con los filtros en la query', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useUsuarios({ tipo: 'alumno' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios?tipo=alumno');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin filtros pide la ruta pelada, sin interrogante', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useUsuarios({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios');
  });
});

describe('useUsuario', () => {
  it('pide la ficha por id', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useUsuario('u1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios/u1');
    expect(llamada(doble).metodo).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// Escrituras: metodo Y ruta, las dos cosas
// ---------------------------------------------------------------------------

describe('useActualizarUsuario', () => {
  it('va con PATCH a la ficha', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useActualizarUsuario('u1'));
    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toMatchObject({
      url: '/api/bx/usuarios/u1',
      metodo: 'PATCH',
      cuerpo: { nombreCompleto: 'Ana' },
    });
  });

  it('manda EXACTAMENTE lo que le dieron, ni un campo mas', async () => {
    // La API valida con `forbidNonWhitelisted`: un campo de adorno que el hook
    // agregue por su cuenta convierte un guardado valido en un 400.
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useActualizarUsuario('u1'));
    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual({ nombreCompleto: 'Ana' });
  });
});

describe('useActualizarSalas', () => {
  it('va con PATCH a /salas y envuelve los ids en `salaIds`', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useActualizarSalas('u1'));
    result.current.mutate(['s1', 's2']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/usuarios/u1/salas',
      metodo: 'PATCH',
      cuerpo: { salaIds: ['s1', 's2'] },
    });
  });
});

describe('useFijarEstadoDePago', () => {
  it('va con PATCH a /estado-pago', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useFijarEstadoDePago('u1'));
    result.current.mutate({ alDia: true, cubreHasta: '2026-12-31' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/usuarios/u1/estado-pago',
      metodo: 'PATCH',
      cuerpo: { alDia: true, cubreHasta: '2026-12-31' },
    });
  });
});

describe('useDarDeBaja', () => {
  it('va con DELETE a la ficha', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useDarDeBaja('u1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // La baja es un DELETE. Con POST la API responderia 404 y el admin veria
    // "no se pudo dar de baja" sin entender por que.
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).url).toBe('/api/bx/usuarios/u1');
  });
});

describe('useResetearPassword', () => {
  it('va con POST a /reset-password y devuelve la contraseña', async () => {
    const doble = dobleDeFetch({ usuarioId: 'u1', passwordTemporal: 'Perro-Azul-71' });

    const { result } = montar(() => useResetearPassword('u1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios/u1/reset-password');
    expect(llamada(doble).metodo).toBe('POST');
    // Se ve UNA vez: si el hook no la devolviera, no habria forma de releerla.
    // Se devuelve la respuesta ENTERA del contrato, no un recorte: el
    // `usuarioId` viaja y la pantalla puede comprobar de quien es la
    // contraseña que esta mostrando.
    expect(result.current.data).toEqual({ usuarioId: 'u1', passwordTemporal: 'Perro-Azul-71' });
  });

  it('la contraseña NO queda guardada en la cache de consultas', async () => {
    dobleDeFetch({ usuarioId: 'u1', passwordTemporal: 'Perro-Azul-71' });

    const { result, cliente } = montar(() => useResetearPassword('u1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // "Se ve UNA vez" solo se cumple si no queda en ningun lado. La cache de
    // consultas la comparte toda la aplicacion y sobrevive a la navegacion:
    // un `setQueryData` "por comodidad" la deja legible para cualquier
    // pantalla y visible en el devtools, sin que falle ningun test de ruta.
    const guardado = cliente
      .getQueryCache()
      .getAll()
      .map((consulta) => consulta.state.data);

    expect(JSON.stringify(guardado)).not.toContain('Perro-Azul-71');
  });
});

describe('useCrearPersona', () => {
  it('un alumno va a /usuarios/alumnos', async () => {
    const doble = dobleDeFetch({ id: 'u1', passwordTemporal: 'x', advertencias: [] });

    const { result } = montar(() => useCrearPersona('alumno'));
    result.current.mutate({ nombreCompleto: 'Ana', email: 'ana@box.test' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios/alumnos');
    expect(llamada(doble).metodo).toBe('POST');
    // Ni un campo de adorno de mas: el DTO del alta valida con
    // `forbidNonWhitelisted` y cualquier extra convierte el alta en un 400.
    expect(llamada(doble).cuerpo).toEqual({ nombreCompleto: 'Ana', email: 'ana@box.test' });
  });

  it('un profesor va a /usuarios/profesores', async () => {
    const doble = dobleDeFetch({ id: 'u2', passwordTemporal: 'x', advertencias: [] });

    const { result } = montar(() => useCrearPersona('profesor'));
    result.current.mutate({ nombreCompleto: 'Beto', email: 'beto@box.test' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/usuarios/profesores');
    expect(llamada(doble).metodo).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// Las invalidaciones: el test que importa
// ---------------------------------------------------------------------------

describe('invalidacion tras una escritura', () => {
  it('actualizar la ficha invalida la ficha Y la lista', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useActualizarUsuario('u1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Invalidar solo la ficha se ve como "guarde y el listado sigue mostrando
    // lo viejo"; invalidar solo la lista, como "guarde y la ficha no cambio".
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuario', 'u1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuarios'] });
  });

  it('cambiar las salas invalida la ficha Y la lista', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useActualizarSalas('u1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(['s1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuario', 'u1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuarios'] });
  });

  it('fijar el estado de pago invalida la ficha Y la lista', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useFijarEstadoDePago('u1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ alDia: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // `pagoAlDia` sale en el listado: sin invalidar la lista, la columna
    // seguiria en verde despues de quitarle la cortesia.
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuario', 'u1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuarios'] });
  });

  it('la baja invalida la ficha Y la lista', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useDarDeBaja('u1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuario', 'u1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuarios'] });
  });

  it('el alta invalida la lista', async () => {
    dobleDeFetch({ id: 'u9', passwordTemporal: 'x', advertencias: [] });

    const { result, cliente } = montar(() => useCrearPersona('alumno'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['usuarios'] });
  });

  it('resetear la contraseña NO invalida nada', async () => {
    dobleDeFetch({ usuarioId: 'u1', passwordTemporal: 'Perro-Azul-71' });

    const { result, cliente } = montar(() => useResetearPassword('u1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // Un refetch de la ficha no traeria nada nuevo, y la contraseña solo vive
    // en el resultado de esta mutacion.
    expect(espia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Cuantas peticiones, no solo cuales
// ---------------------------------------------------------------------------

describe('ninguna peticion de mas', () => {
  it('cada escritura es UNA sola peticion', async () => {
    // `toHaveBeenCalledWith` nunca pregunta cuantas veces. Una peticion
    // extra (un refetch "por las dudas", un log, un GET de cortesia) pasaria
    // por delante de todos los tests de ruta y de metodo sin que nadie la vea.
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useActualizarUsuario('u1'));
    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la baja es UNA sola peticion', async () => {
    const doble = dobleDeFetch({ id: 'u1' });

    const { result } = montar(() => useDarDeBaja('u1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('el alta es UNA sola peticion', async () => {
    const doble = dobleDeFetch({ id: 'u9', passwordTemporal: 'x', advertencias: [] });

    const { result } = montar(() => useCrearPersona('alumno'));
    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la lectura de la lista es UNA sola peticion', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useUsuarios({ tipo: 'alumno' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE de la invalidacion: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  // Los tests de invalidacion de arriba usan `toHaveBeenCalledWith`, que nunca
  // pregunta con que MAS se llamo, y los de conteo cuentan peticiones en un
  // cliente donde no hay nada mas abierto. Entre los dos queda un hueco: una
  // invalidacion global cumple todo lo anterior y en un spec de hook —que
  // monta el hook SOLO— es indistinguible de una dirigida. Ver
  // `consulta-ajena.ts`.

  it('actualizar la ficha', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useActualizarUsuario('u1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('cambiar las salas', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useActualizarSalas('u1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(['s1']);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('fijar el estado de pago', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useFijarEstadoDePago('u1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ alDia: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('la baja', async () => {
    dobleDeFetch({ id: 'u1' });

    const { result, cliente } = montar(() => useDarDeBaja('u1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('el alta', async () => {
    dobleDeFetch({ id: 'u9', passwordTemporal: 'x', advertencias: [] });

    const { result, cliente } = montar(() => useCrearPersona('alumno'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ nombreCompleto: 'Ana' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('resetear la contraseña', async () => {
    dobleDeFetch({ usuarioId: 'u1', passwordTemporal: 'Perro-Azul-71' });

    const { result, cliente } = montar(() => useResetearPassword('u1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });
});

// El `gcTime: 0` de las mutaciones de este archivo lo fija
// `mutaciones-sin-gctime.spec.ts`, que barre TODOS los hooks. Aqui vivia un
// analizador copiado que solo miraba este archivo: tres copias, y los cuatro
// archivos de hooks sin spec propio quedaban afuera.
