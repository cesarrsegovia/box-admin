import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  cacheDeConsultas,
  dobleDeFetch,
  dobleQueFalla,
  llamada,
  montar,
} from '@/test/andamiaje-de-hooks';
import { useSalas } from './use-catalogos';
import {
  useActualizarSala,
  useBorrarSala,
  useCrearSala,
  useSala,
  clavesDeSalas,
} from './use-salas-admin';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Una sala tal como vuelve de la API, con un marcador para rastrearla. */
const SALA = {
  id: 's1',
  tenantId: 'g1',
  nombre: 'Sala-Pilates-Marcador',
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: false,
  exclusiva: false,
  cupoBase: 8,
  minMinutosCancelar: null,
  minMinutosAnotarse: null,
  listaEsperaHabilitada: null,
};

const ALTA = { nombre: 'Sala 2', cupoBase: 8, visibleAlumnos: true };

// ---------------------------------------------------------------------------
// Lectura: ruta Y metodo
// ---------------------------------------------------------------------------

describe('useSala', () => {
  it('pide la sala por id', async () => {
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useSala('s1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/salas/s1');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('leer la ficha es UNA sola peticion', async () => {
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useSala('s1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la clave de la ficha NO es un prefijo del catalogo', () => {
    // Si la ficha se llamara `['salas', id]`, invalidar el catalogo
    // —`['salas']`— la arrastraria por prefijo, y entonces "invalida el
    // catalogo" y "invalida la ficha" serian el mismo hecho: los dos tests de
    // abajo se volverian uno solo sin que se note.
    expect(clavesDeSalas.una('s1')[0]).not.toBe('salas');
  });
});

// ---------------------------------------------------------------------------
// Escrituras: ruta Y metodo Y cuerpo
// ---------------------------------------------------------------------------

describe('useCrearSala', () => {
  it('va con POST a `/salas` y manda EXACTAMENTE lo que le dieron', async () => {
    // `forbidNonWhitelisted`: un `activa: true` agregado "por las dudas" en el
    // alta es un 400, porque `CrearSalaDto` no tiene ese campo.
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useCrearSala());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({ url: '/api/bx/salas', metodo: 'POST', cuerpo: ALTA });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useCrearSala());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useActualizarSala', () => {
  it('va con PATCH a la sala y manda EXACTAMENTE lo que le dieron', async () => {
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useActualizarSala('s1'));
    result.current.mutate({ cupoBase: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/salas/s1',
      metodo: 'PATCH',
      cuerpo: { cupoBase: 12 },
    });
  });

  it('un `null` explicito viaja como null: es "hereda del tenant"', async () => {
    // `cupoBase: null` y "no mandar cupoBase" son cosas distintas en el
    // contrato: el primero vuelve a heredar del gimnasio, el segundo deja el
    // valor que hubiera. Borrar la clave al serializar seria no poder deshacer
    // un cupo propio nunca mas.
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useActualizarSala('s1'));
    result.current.mutate({ cupoBase: null });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual({ cupoBase: null });
    expect(Object.keys(llamada(doble).cuerpo as object)).toEqual(['cupoBase']);
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(SALA);

    const { result } = montar(() => useActualizarSala('s1'));
    result.current.mutate({ cupoBase: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useBorrarSala', () => {
  it('va con DELETE a la sala, sin cuerpo', async () => {
    const doble = dobleDeFetch({ ...SALA, activa: false });

    const { result } = montar(() => useBorrarSala('s1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/salas/s1');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('la baja es LOGICA: devuelve la sala, no un 204', async () => {
    // `SalasService.darDeBaja` hace un update a `activa: false` y devuelve la
    // fila. La pantalla la necesita para pintar el estado nuevo sin pedirla
    // otra vez.
    dobleDeFetch({ ...SALA, activa: false });

    const { result } = montar(() => useBorrarSala('s1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ id: 's1', activa: false });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch({ ...SALA, activa: false });

    const { result } = montar(() => useBorrarSala('s1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// EL CAMINO DE ERROR: una escritura que falla no se reintenta
// ---------------------------------------------------------------------------

/**
 * El porque esta entero en `use-ausencias.spec.tsx`. Aqui, tres copias de la
 * misma sala quedan en el catalogo que consumen media docena de pantallas: el
 * selector de sala del alta de usuario mostraria "Pilates" tres veces.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useCrearSala());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble, 'el POST se reintento: podrian quedar salas duplicadas').toHaveBeenCalledTimes(1);
  });

  it('el PATCH', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useActualizarSala('s1'));
    result.current.mutate({ cupoBase: 12 });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la baja', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(404);

    const { result } = montar(() => useBorrarSala('s1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un fallo no invalida el catalogo', async () => {
    // Invalidar tras un error seria volver a pedir la lista entera de salas
    // para redibujar exactamente lo mismo, en todas las pantallas que la
    // observan.
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useCrearSala());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// EL CATALOGO: lo que mas importa de este archivo
// ---------------------------------------------------------------------------

/**
 * La lista de `useSalas()` la consumen media docena de pantallas: el alta de
 * usuario, los dias fijos, el filtro de la grilla. Una sala nueva o dada de
 * baja las cambia todas, asi que toda escritura de aqui tiene que alcanzarla.
 *
 * Los tests de abajo NO espian `invalidateQueries` para esto: montan el hook
 * del catalogo DE VERDAD y miran si se volvio a pedir. Con el espia, el test
 * comprobaria que se invalido una clave igual a la que el propio hook usa —y
 * seguiria verde si las dos se desviaran juntas hacia una clave paralela que
 * ninguna pantalla observa.
 */
describe('toda escritura hace que el catalogo se vuelva a pedir', () => {
  it('el alta', async () => {
    const doble = dobleDeFetch([SALA]);

    const { result } = montar(() => ({ catalogo: useSalas(), crear: useCrearSala() }));
    await waitFor(() => expect(result.current.catalogo.isSuccess).toBe(true));
    expect(doble).toHaveBeenCalledTimes(1);

    result.current.crear.mutate(ALTA);
    await waitFor(() => expect(result.current.crear.isSuccess).toBe(true));

    await waitFor(() => expect(doble).toHaveBeenCalledTimes(3));
    expect(llamada(doble, 1).metodo).toBe('POST');
    expect(llamada(doble, 2)).toMatchObject({ url: '/api/bx/salas', metodo: 'GET' });
  });

  it('el PATCH', async () => {
    const doble = dobleDeFetch([SALA]);

    const { result } = montar(() => ({
      catalogo: useSalas(),
      actualizar: useActualizarSala('s1'),
    }));
    await waitFor(() => expect(result.current.catalogo.isSuccess).toBe(true));

    result.current.actualizar.mutate({ nombre: 'Otro nombre' });
    await waitFor(() => expect(result.current.actualizar.isSuccess).toBe(true));

    await waitFor(() => expect(doble).toHaveBeenCalledTimes(3));
    expect(llamada(doble, 2)).toMatchObject({ url: '/api/bx/salas', metodo: 'GET' });
  });

  it('la baja', async () => {
    const doble = dobleDeFetch([SALA]);

    const { result } = montar(() => ({ catalogo: useSalas(), borrar: useBorrarSala('s1') }));
    await waitFor(() => expect(result.current.catalogo.isSuccess).toBe(true));

    result.current.borrar.mutate();
    await waitFor(() => expect(result.current.borrar.isSuccess).toBe(true));

    await waitFor(() => expect(doble).toHaveBeenCalledTimes(3));
    expect(llamada(doble, 1).metodo).toBe('DELETE');
    expect(llamada(doble, 2)).toMatchObject({ url: '/api/bx/salas', metodo: 'GET' });
  });
});

// ---------------------------------------------------------------------------
// La ficha: quien SI y quien NO
// ---------------------------------------------------------------------------

describe('invalidacion de la ficha', () => {
  it('el PATCH invalida la ficha de esa sala', async () => {
    dobleDeFetch(SALA);

    const { result, cliente } = montar(() => useActualizarSala('s1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ cupoBase: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['sala', 's1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['salas'] });
  });

  it('la baja TAMBIEN invalida la ficha: la sala sigue existiendo', async () => {
    // Al reves que `useBorrarTurno`, donde el borrado es fisico y volver a
    // pedir la ficha seria un 404 pintado como error. Aca la fila se conserva
    // con `activa: false` y la ficha tiene que mostrar el estado nuevo.
    dobleDeFetch({ ...SALA, activa: false });

    const { result, cliente } = montar(() => useBorrarSala('s1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['sala', 's1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['salas'] });
  });

  it('el alta NO invalida ninguna ficha', async () => {
    // No hay ficha que refrescar: la sala no existia. Invalidar `['sala']` a
    // secas arrastraria por prefijo la ficha de CUALQUIER sala abierta.
    dobleDeFetch(SALA);

    const { result, cliente } = montar(() => useCrearSala());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ queryKey: ['salas'] });
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  it('crear una sala', async () => {
    dobleDeFetch(SALA);

    const { result, cliente } = montar(() => useCrearSala());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('actualizar una sala', async () => {
    dobleDeFetch(SALA);

    const { result, cliente } = montar(() => useActualizarSala('s1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ cupoBase: 12 });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('dar de baja una sala', async () => {
    dobleDeFetch({ ...SALA, activa: false });

    const { result, cliente } = montar(() => useBorrarSala('s1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });
});

// ---------------------------------------------------------------------------
// La cache de CONSULTAS es otro almacen
// ---------------------------------------------------------------------------

describe('la escritura no siembra la cache de consultas', () => {
  it('crear no deja nada', async () => {
    dobleDeFetch(SALA);

    const { result, cliente } = montar(() => useCrearSala());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sala-Pilates-Marcador');
    expect(cache.entradas).toBe(0);
  });

  it('dar de baja no deja nada', async () => {
    dobleDeFetch({ ...SALA, activa: false });

    const { result, cliente } = montar(() => useBorrarSala('s1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sala-Pilates-Marcador');
    expect(cache.entradas).toBe(0);
  });
});
