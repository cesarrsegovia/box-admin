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
import {
  queryDeVacaciones,
  useBorrarVacacion,
  useCrearVacacion,
  useVacaciones,
} from './use-vacaciones';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Unas vacaciones tal como vuelven de la API, con un marcador para rastrearlas. */
const VACACION = {
  id: 'v1',
  tenantId: 'g1',
  perfilId: 'perf1',
  desde: '2027-01-02',
  hasta: '2027-01-20',
  motivo: 'Viaje-Marcador',
};

const ALTA = { perfilId: 'perf1', desde: '2027-01-02', hasta: '2027-01-20' };

// ---------------------------------------------------------------------------
// La funcion pura
// ---------------------------------------------------------------------------

describe('queryDeVacaciones', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeVacaciones({})).toBe('');
  });

  it('una cadena vacia NO se manda', () => {
    // `?perfilId=` no es "todos los alumnos": es un alumno cuyo id es la
    // cadena vacia, y el listado volveria vacio.
    expect(queryDeVacaciones({ perfilId: '' })).toBe('');
  });

  it('el filtro con valor SI se manda', () => {
    expect(queryDeVacaciones({ perfilId: 'perf1' })).toBe('?perfilId=perf1');
  });

  it('escapa lo que haga falta', () => {
    expect(queryDeVacaciones({ perfilId: 'a b&c' })).toBe('?perfilId=a+b%26c');
  });
});

// ---------------------------------------------------------------------------
// Lectura: ruta Y metodo
// ---------------------------------------------------------------------------

describe('useVacaciones', () => {
  it('pide `/vacaciones-alumnos`, NO `/vacaciones`', async () => {
    // El `@Controller` se llama `vacaciones-alumnos` aunque el modulo, el
    // service y el contrato se llamen solo "vacaciones". Deducir la ruta del
    // nombre del modulo da un 404, y un 404 aqui se ve en pantalla como "este
    // alumno no tiene vacaciones cargadas".
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useVacaciones({ perfilId: 'perf1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/vacaciones-alumnos?perfilId=perf1');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin filtros pide la ruta pelada, sin interrogante', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useVacaciones({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/vacaciones-alumnos');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('leer la lista es UNA sola peticion', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useVacaciones({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Escrituras: ruta Y metodo Y cuerpo
// ---------------------------------------------------------------------------

describe('useCrearVacacion', () => {
  it('va con POST a `/vacaciones-alumnos` y manda EXACTAMENTE lo que le dieron', async () => {
    const doble = dobleDeFetch(VACACION);

    const { result } = montar(() => useCrearVacacion());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/vacaciones-alumnos',
      metodo: 'POST',
      cuerpo: ALTA,
    });
  });

  it('no agrega `devuelveClase`: ese campo se borro del contrato en la Fase 6B', async () => {
    // El `ValidationPipe` corre con `forbidNonWhitelisted`, asi que mandarlo
    // ahora no es un campo ignorado en silencio: es un 400 y las vacaciones no
    // se cargan.
    const doble = dobleDeFetch(VACACION);

    const { result } = montar(() => useCrearVacacion());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Object.keys(llamada(doble).cuerpo as object)).toEqual(['perfilId', 'desde', 'hasta']);
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(VACACION);

    const { result } = montar(() => useCrearVacacion());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useBorrarVacacion', () => {
  it('va con DELETE a `/vacaciones-alumnos/:id`, sin cuerpo', async () => {
    const doble = dobleDeFetch(VACACION);

    const { result } = montar(() => useBorrarVacacion('v1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/vacaciones-alumnos/v1');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('devuelve la fila borrada, no un 204', async () => {
    // El borrado es REAL y la API devuelve la fila justamente para poder
    // deshacer. Si el hook la tirara, el "deshacer" no tendria con que.
    dobleDeFetch(VACACION);

    const { result } = montar(() => useBorrarVacacion('v1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ id: 'v1', perfilId: 'perf1' });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(VACACION);

    const { result } = montar(() => useBorrarVacacion('v1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// EL CAMINO DE ERROR: una escritura que falla no se reintenta
// ---------------------------------------------------------------------------

/**
 * El porque esta entero en `use-ausencias.spec.tsx`. Aqui, tres copias de las
 * mismas vacaciones son tres exclusiones solapadas en el plan del mes: el
 * alumno no pierde clases, pero el panel de conflictos las lista por
 * triplicado y nadie entiende de donde salieron.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useCrearVacacion());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(
      doble,
      'el POST se reintento: podrian quedar vacaciones duplicadas',
    ).toHaveBeenCalledTimes(1);
  });

  it('la baja', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(404);

    const { result } = montar(() => useBorrarVacacion('v1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un fallo no invalida nada', async () => {
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useCrearVacacion());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Invalidacion
// ---------------------------------------------------------------------------

describe('invalidacion tras una escritura', () => {
  it('crear invalida la lista de vacaciones', async () => {
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useCrearVacacion());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ queryKey: ['vacaciones'] });
  });

  it('borrar invalida la lista de vacaciones', async () => {
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useBorrarVacacion('v1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ queryKey: ['vacaciones'] });
  });

  it('la invalidacion alcanza a la lista DE ESE ALUMNO', async () => {
    // La clave real lleva el `perfilId` dentro. Invalidar `['vacaciones', {}]`
    // —la clave sin filtros— no alcanzaria a la ficha del alumno abierta, que
    // es la unica pantalla desde la que se cargan.
    const delAlumno = ['vacaciones', { perfilId: 'perf1' }];
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useCrearVacacion());
    cliente.setQueryData(delAlumno, []);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await Promise.resolve().then().then().then();

    const consulta = cliente.getQueryCache().find({ queryKey: delAlumno });
    expect(consulta, 'la consulta sembrada no esta: el test no mide nada').toBeDefined();
    expect(consulta?.state.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  it('crear unas vacaciones', async () => {
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useCrearVacacion());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar unas vacaciones', async () => {
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useBorrarVacacion('v1'));
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
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useCrearVacacion());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Viaje-Marcador');
    expect(cache.entradas).toBe(0);
  });

  it('borrar no deja nada', async () => {
    dobleDeFetch(VACACION);

    const { result, cliente } = montar(() => useBorrarVacacion('v1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Viaje-Marcador');
    expect(cache.entradas).toBe(0);
  });
});
