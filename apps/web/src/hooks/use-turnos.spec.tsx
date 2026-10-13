import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  queryDeTurnos,
  useActualizarTurno,
  useAnotar,
  useAsignarProfesor,
  useBorrarTurno,
  useCancelar,
  useReasignar,
  useReservasDelTurno,
  useTurno,
  useTurnos,
} from './use-turnos';

// ---------------------------------------------------------------------------
// La funcion pura
// ---------------------------------------------------------------------------

describe('queryDeTurnos', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeTurnos({})).toBe('');
  });

  it('`soloLibres: false` SI se manda', () => {
    // "Mostrame tambien los llenos" es un filtro, no la ausencia de filtro. Un
    // `if (f.soloLibres)` se lo comeria y la grilla volveria a traer de todo
    // sin que el admin lo haya pedido.
    expect(queryDeTurnos({ soloLibres: false })).toBe('?soloLibres=false');
  });

  it('`soloLibres: true` se manda', () => {
    expect(queryDeTurnos({ soloLibres: true })).toBe('?soloLibres=true');
  });

  it('una cadena vacia NO se manda', () => {
    // `?salaId=` no es "sin sala": para el `ParseBoolPipe` y los DTO de la API
    // un parametro vacio es un valor invalido, y la respuesta seria un 400.
    expect(queryDeTurnos({ desde: '', hasta: '', salaId: '', profesorId: '' })).toBe('');
  });

  it('manda los cinco juntos, en orden', () => {
    expect(
      queryDeTurnos({
        desde: '2026-10-01',
        hasta: '2026-10-31',
        salaId: 's1',
        soloLibres: false,
        profesorId: 'p1',
      }),
    ).toBe('?desde=2026-10-01&hasta=2026-10-31&salaId=s1&soloLibres=false&profesorId=p1');
  });
});

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

/**
 * Monta el hook con su propio `QueryClient` y lo devuelve junto al cliente,
 * para poder espiar las invalidaciones y mirar que quedo en la cache.
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
function dobleDeFetch(datos: unknown = { id: 't1' }) {
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

/** El borrado de un turno responde 204 y sin cuerpo. */
function dobleDe204() {
  const doble = vi
    .fn()
    .mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
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

/** Una reserva tal como vuelve del POST, con nombre propio para rastrearla. */
const RESERVA = {
  id: 'r1',
  tenantId: 'g1',
  turnoId: 't1',
  perfilId: 'perf1',
  origen: 'ADMIN',
  esPrueba: false,
  pagoRealizado: false,
  canceladaEn: null,
  cancelacionTipo: null,
  asistio: null,
  advertencias: ['Sofia-Pereyra-Marcador'],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Lecturas: ruta Y metodo
// ---------------------------------------------------------------------------

describe('useTurnos', () => {
  it('pide la ruta exacta con los filtros en la query', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useTurnos({ salaId: 's1', soloLibres: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/turnos?salaId=s1&soloLibres=true');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin filtros pide la ruta pelada, sin interrogante', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useTurnos({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/turnos');
  });
});

describe('useTurno', () => {
  it('pide el turno por id', async () => {
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useTurno('t1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/turnos/t1');
    expect(llamada(doble).metodo).toBe('GET');
  });
});

describe('useReservasDelTurno', () => {
  it('pide las reservas COLGANDO del turno', async () => {
    // Es `/turnos/:turnoId/reservas` y no `/reservas?turnoId=`: el segundo no
    // existe en la API y devolveria un 404 que la pantalla veria como "este
    // turno no tiene a nadie anotado".
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useReservasDelTurno('t1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/turnos/t1/reservas');
    expect(llamada(doble).metodo).toBe('GET');
  });
});

// ---------------------------------------------------------------------------
// Escrituras: ruta Y metodo Y cuerpo, las tres cosas
// ---------------------------------------------------------------------------

describe('useActualizarTurno', () => {
  it('va con PATCH al turno y manda EXACTAMENTE lo que le dieron', async () => {
    // `forbidNonWhitelisted`: un campo de adorno que el hook agregue por su
    // cuenta convierte un guardado valido en un 400.
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useActualizarTurno('t1'));
    result.current.mutate({ cupo: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/turnos/t1',
      metodo: 'PATCH',
      cuerpo: { cupo: 12 },
    });
  });
});

describe('useAsignarProfesor', () => {
  it('va con PATCH a /profesor y envuelve el id en `profesorId`', async () => {
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useAsignarProfesor('t1'));
    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/turnos/t1/profesor',
      metodo: 'PATCH',
      cuerpo: { profesorId: 'p1' },
    });
  });

  it('`null` viaja como null explicito: es quitar la profesora, no omitir la clave', async () => {
    // El DTO distingue las dos cosas a proposito (`@ValidateIf` en vez de
    // `@IsOptional`). Si el hook borrara la clave al mandar null, el turno se
    // quedaria con la suplente puesta y en pantalla figuraria sin nadie.
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useAsignarProfesor('t1'));
    result.current.mutate(null);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual({ profesorId: null });
    expect(Object.keys(llamada(doble).cuerpo as object)).toEqual(['profesorId']);
  });
});

describe('useBorrarTurno', () => {
  it('va con DELETE al turno, sin cuerpo', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarTurno('t1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/turnos/t1');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('un 204 sin cuerpo no rompe la mutacion', async () => {
    // La API responde 204 a proposito (el borrado es fisico, no queda nada que
    // devolver). Si el hook intentara leer un JSON de ahi, el admin veria un
    // error despues de un borrado que SI ocurrio.
    dobleDe204();

    const { result } = montar(() => useBorrarTurno('t1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });
});

describe('useAnotar', () => {
  it('va con POST a las reservas del turno y manda `perfilId`', async () => {
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useAnotar('t1'));
    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/turnos/t1/reservas',
      metodo: 'POST',
      cuerpo: { perfilId: 'perf1' },
    });
  });

  it('el cuerpo tiene EXACTAMENTE la clave `perfilId` y ninguna mas', async () => {
    // Lista blanca, no `toMatchObject`: el ValidationPipe corre con
    // `forbidNonWhitelisted`, asi que un `usuarioId` o un `origen` colado "por
    // las dudas" no se ignora — tira la peticion entera con un 400.
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useAnotar('t1'));
    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Object.keys(llamada(doble).cuerpo as object)).toEqual(['perfilId']);
  });
});

describe('useCancelar', () => {
  it('manda `definitiva` cuando le dieron DEFINITIVA, en minusculas y en el query', async () => {
    const doble = dobleDeFetch({ ...RESERVA, cancelacionTipo: 'DEFINITIVA' });

    const { result } = montar(() => useCancelar('t1'));
    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/reservas/r1?tipo=definitiva');
    expect(llamada(doble).metodo).toBe('DELETE');
  });

  it('manda `recuperable` cuando le dieron RECUPERABLE', async () => {
    // Los DOS valores, y no uno. Elegir "definitiva" y que viaje "recuperable"
    // es invisible en pantalla: la reserva desaparece igual. Lo unico que
    // cambia es si al alumno le devuelven la clase o se la gastan.
    const doble = dobleDeFetch({ ...RESERVA, cancelacionTipo: 'RECUPERABLE' });

    const { result } = montar(() => useCancelar('t1'));
    result.current.mutate({ id: 'r1', tipo: 'RECUPERABLE' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/reservas/r1?tipo=recuperable');
    expect(llamada(doble).metodo).toBe('DELETE');
  });

  it('el tipo va en el QUERY, no en el cuerpo', async () => {
    // El `CancelarReservaDto` se valida sobre `@Query()`. Un tipo mandado en
    // el cuerpo no llegaria, y el DTO lo exige: 400 sin excepcion.
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useCancelar('t1'));
    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toBeUndefined();
  });
});

describe('useReasignar', () => {
  it('manda el turno DESTINO con la clave `turnoId`', async () => {
    // El hook se monta sobre el turno de ORIGEN ('t1') y el destino es otro
    // ('t2'). El DTO lee `turnoId` y entiende "mover a ese": mandar el origen
    // —o mandar el destino bajo otra clave— es un 400 o una reasignacion al
    // mismo sitio.
    const doble = dobleDeFetch({ ...RESERVA, turnoId: 't2' });

    const { result } = montar(() => useReasignar('t1'));
    result.current.mutate({ id: 'r1', destinoId: 't2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/reservas/r1/reasignar',
      metodo: 'PATCH',
      cuerpo: { turnoId: 't2' },
    });
  });
});

// ---------------------------------------------------------------------------
// Las invalidaciones: las TRES claves
// ---------------------------------------------------------------------------

/** Las tres claves que tiene que tocar cualquier escritura sobre un turno. */
function esperarLasTres(espia: MockInstance<QueryClient['invalidateQueries']>) {
  // El cupo ocupado se ve en los tres sitios. Invalidar a medias se nota como
  // "cancele y el cupo sigue igual" o "anote a alguien y la grilla no cambio".
  expect(espia).toHaveBeenCalledWith({ queryKey: ['turno', 't1'] });
  expect(espia).toHaveBeenCalledWith({ queryKey: ['reservas-de-turno', 't1'] });
  expect(espia).toHaveBeenCalledWith({ queryKey: ['turnos'] });
}

describe('invalidacion tras una escritura', () => {
  it('actualizar el turno invalida las tres', async () => {
    dobleDeFetch({ id: 't1' });

    const { result, cliente } = montar(() => useActualizarTurno('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ cupo: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    esperarLasTres(espia);
  });

  it('asignar la profesora invalida las tres', async () => {
    dobleDeFetch({ id: 't1' });

    const { result, cliente } = montar(() => useAsignarProfesor('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    esperarLasTres(espia);
  });

  it('anotar a alguien invalida las tres', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useAnotar('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    esperarLasTres(espia);
  });

  it('cancelar invalida las tres', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useCancelar('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    esperarLasTres(espia);
  });

  it('reasignar invalida las tres', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useReasignar('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ id: 'r1', destinoId: 't2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    esperarLasTres(espia);
  });

  it('borrar el turno invalida la lista y NO la ficha del turno borrado', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarTurno('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['turnos'] });
    // Invalidar la ficha de un turno que ya no existe seria pedirle a la API
    // un 404 y pintarlo como error justo despues de un borrado correcto.
    expect(espia).not.toHaveBeenCalledWith({ queryKey: ['turno', 't1'] });
  });
});

// ---------------------------------------------------------------------------
// Cuantas peticiones, no solo cuales
// ---------------------------------------------------------------------------

describe('ninguna peticion de mas', () => {
  // `toHaveBeenCalledWith` nunca pregunta cuantas veces. Una peticion extra (un
  // refetch "por las dudas", un GET de cortesia para refrescar el cupo) pasa
  // por delante de todos los tests de ruta y de metodo sin que nadie la vea.

  it('actualizar el turno es UNA sola peticion', async () => {
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useActualizarTurno('t1'));
    result.current.mutate({ cupo: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('asignar la profesora es UNA sola peticion', async () => {
    const doble = dobleDeFetch({ id: 't1' });

    const { result } = montar(() => useAsignarProfesor('t1'));
    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('borrar el turno es UNA sola peticion', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarTurno('t1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('anotar es UNA sola peticion', async () => {
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useAnotar('t1'));
    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('cancelar es UNA sola peticion', async () => {
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useCancelar('t1'));
    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('reasignar es UNA sola peticion', async () => {
    const doble = dobleDeFetch(RESERVA);

    const { result } = montar(() => useReasignar('t1'));
    result.current.mutate({ id: 'r1', destinoId: 't2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('leer las reservas del turno es UNA sola peticion', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useReservasDelTurno('t1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Lo que queda guardado: la cache de CONSULTAS es otro almacen
// ---------------------------------------------------------------------------

/** Todo lo que haya en la cache de consultas de ese cliente, como texto. */
function cacheDeConsultas(cliente: QueryClient): { entradas: number; texto: string } {
  const todas = cliente.getQueryCache().getAll();
  return {
    entradas: todas.length,
    texto: JSON.stringify(todas.map((consulta) => [consulta.queryKey, consulta.state.data])),
  };
}

describe('la escritura no deja nada en la cache de consultas', () => {
  // `gcTime: 0` tapa la cache de MUTACIONES. La de CONSULTAS es otro almacen:
  // la comparte toda la aplicacion, sobrevive a la navegacion y se lee desde
  // el devtools. Un `setQueryData` "por comodidad" en el `onSuccess` deja ahi
  // los datos de la reserva —con el nombre del alumno dentro— sin que falle
  // ningun test de ruta, de metodo ni de invalidacion.

  it('anotar no siembra la cache', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useAnotar('t1'));
    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sofia-Pereyra-Marcador');
    // Un hook de mutacion no tiene por que crear entradas de consulta: si
    // aparecio alguna, alguien escribio donde no debia.
    expect(cache.entradas).toBe(0);
  });

  it('cancelar no siembra la cache', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useCancelar('t1'));
    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sofia-Pereyra-Marcador');
    expect(cache.entradas).toBe(0);
  });

  it('reasignar no siembra la cache', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useReasignar('t1'));
    result.current.mutate({ id: 'r1', destinoId: 't2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sofia-Pereyra-Marcador');
    expect(cache.entradas).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE de la invalidacion: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  // Los tests de invalidacion de arriba usan `toHaveBeenCalledWith`, que nunca
  // pregunta con que MAS se llamo, y los de conteo cuentan peticiones en un
  // cliente donde no hay nada mas abierto. Entre los dos queda un hueco: una
  // invalidacion global cumple todo lo anterior. Ver `consulta-ajena.ts`.

  it('actualizar el turno', async () => {
    dobleDeFetch({ id: 't1' });

    const { result, cliente } = montar(() => useActualizarTurno('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ cupo: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('asignar la profesora', async () => {
    dobleDeFetch({ id: 't1' });

    const { result, cliente } = montar(() => useAsignarProfesor('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar el turno', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarTurno('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('anotar a alguien', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useAnotar('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate('perf1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('cancelar', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useCancelar('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ id: 'r1', tipo: 'DEFINITIVA' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('reasignar', async () => {
    dobleDeFetch(RESERVA);

    const { result, cliente } = montar(() => useReasignar('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ id: 'r1', destinoId: 't2' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });
});

// El `gcTime: 0` de las mutaciones de este archivo lo fija
// `mutaciones-sin-gctime.spec.ts`, que barre TODOS los hooks. Aqui vivia un
// analizador copiado que solo miraba este archivo: tres copias, y los cuatro
// archivos de hooks sin spec propio quedaban afuera.
