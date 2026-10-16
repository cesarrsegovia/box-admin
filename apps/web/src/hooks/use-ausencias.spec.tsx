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
  queryDeAusencias,
  useAusencias,
  useBorrarAusencia,
  useCrearAusencia,
} from './use-ausencias';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Una ausencia tal como vuelve de la API, con un marcador para rastrearla. */
const AUSENCIA = {
  id: 'a1',
  tenantId: 'g1',
  salaId: 's1',
  desde: '2026-12-24',
  hasta: '2026-12-26',
  todoElDia: true,
  horaInicio: null,
  horaFin: null,
  recuperable: false,
  motivo: 'Feriado-Marcador',
};

const ALTA = { salaId: 's1', desde: '2026-12-24', hasta: '2026-12-26', todoElDia: true };

// ---------------------------------------------------------------------------
// La funcion pura
// ---------------------------------------------------------------------------

describe('queryDeAusencias', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeAusencias({})).toBe('');
  });

  it('una cadena vacia NO se manda', () => {
    // `?salaId=` no es "todo el salon": es una sala cuyo id es la cadena
    // vacia. La lista volveria vacia y el admin leeria "no hay cierres
    // cargados" sobre un salon que cierra en Navidad.
    expect(queryDeAusencias({ salaId: '', desde: '', hasta: '' })).toBe('');
  });

  it('un filtro vacio no arrastra a los que SI tienen valor', () => {
    expect(queryDeAusencias({ salaId: '', desde: '2026-12-01', hasta: '2026-12-31' })).toBe(
      '?desde=2026-12-01&hasta=2026-12-31',
    );
  });

  it('manda los tres juntos, en orden', () => {
    expect(queryDeAusencias({ salaId: 's1', desde: '2026-12-01', hasta: '2026-12-31' })).toBe(
      '?salaId=s1&desde=2026-12-01&hasta=2026-12-31',
    );
  });

  it('escapa lo que haga falta', () => {
    expect(queryDeAusencias({ salaId: 'a b&c' })).toBe('?salaId=a+b%26c');
  });
});

// ---------------------------------------------------------------------------
// Lectura: ruta Y metodo
// ---------------------------------------------------------------------------

describe('useAusencias', () => {
  it('pide `/ausencias` con los filtros en la query', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useAusencias({ desde: '2026-12-01', hasta: '2026-12-31' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/ausencias?desde=2026-12-01&hasta=2026-12-31');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin filtros pide la ruta pelada, sin interrogante', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useAusencias({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/ausencias');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('leer la lista es UNA sola peticion', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useAusencias({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Escrituras: ruta Y metodo Y cuerpo
// ---------------------------------------------------------------------------

describe('useCrearAusencia', () => {
  it('va con POST a `/ausencias` y manda EXACTAMENTE lo que le dieron', async () => {
    const doble = dobleDeFetch(AUSENCIA);

    const { result } = montar(() => useCrearAusencia());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({ url: '/api/bx/ausencias', metodo: 'POST', cuerpo: ALTA });
  });

  it('sin `salaId` el cuerpo NO lo inventa: ausente = todo el salon', async () => {
    // El DTO lee la ausencia de la clave como "cierra el salon entero". Un
    // `salaId: null` o un `salaId: ''` agregados por el hook serian un 400
    // (`@IsString` + `@IsNotEmpty`), y cerrar el salon entero dejaria de poder
    // cargarse.
    const doble = dobleDeFetch(AUSENCIA);
    const sinSala = { desde: '2026-12-24', hasta: '2026-12-26', todoElDia: true };

    const { result } = montar(() => useCrearAusencia());
    result.current.mutate(sinSala);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(Object.keys(llamada(doble).cuerpo as object)).toEqual(['desde', 'hasta', 'todoElDia']);
  });

  /**
   * ESTE CUERPO LA PANTALLA DE AUSENCIAS YA NO LO MANDA NUNCA. NO ES UN OLVIDO.
   *
   * La franja horaria —`todoElDia: false` con `horaInicio`/`horaFin`— se saco
   * de la pantalla porque NINGUN consumidor de la API la honra: un cierre de
   * 18 a 20 excluye el dia entero igual. Dejarla era un control que promete
   * cerrar dos horas y cierra ocho.
   *
   * Lo que este test fija sigue siendo verdad y por eso sigue aqui, pero es
   * una propiedad DEL HOOK y no de la pantalla: el hook es transporte generico
   * —manda el cuerpo que le den, tal cual— y no puede comerse un `false` con
   * un `if (datos.todoElDia)` por el camino. El dia que la API honre las
   * franjas y la pantalla vuelva a mandarlas, el transporte ya esta probado.
   *
   * O sea: esto NO documenta que la pantalla mande franjas. No las manda.
   */
  it('`todoElDia: false` SI viaja: es un valor, no la ausencia de valor', async () => {
    const doble = dobleDeFetch({ ...AUSENCIA, todoElDia: false });
    const porHoras = {
      salaId: 's1',
      desde: '2026-12-24',
      hasta: '2026-12-24',
      todoElDia: false,
      horaInicio: '18:00',
      horaFin: '20:00',
    };

    const { result } = montar(() => useCrearAusencia());
    result.current.mutate(porHoras);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).cuerpo).toEqual(porHoras);
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(AUSENCIA);

    const { result } = montar(() => useCrearAusencia());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useBorrarAusencia', () => {
  it('va con DELETE a la ausencia, sin cuerpo', async () => {
    const doble = dobleDeFetch(AUSENCIA);

    const { result } = montar(() => useBorrarAusencia('a1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/ausencias/a1');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('devuelve la fila, no un 204', async () => {
    // Al reves que el borrado de un horario. La pantalla la necesita para
    // ofrecer deshacer sin volver a pedir la lista.
    dobleDeFetch(AUSENCIA);

    const { result } = montar(() => useBorrarAusencia('a1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toMatchObject({ id: 'a1' });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(AUSENCIA);

    const { result } = montar(() => useBorrarAusencia('a1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// EL CAMINO DE ERROR: una escritura que falla no se reintenta
// ---------------------------------------------------------------------------

/**
 * TODOS LOS CONTEOS DE PETICIONES DE ARRIBA CORREN SOBRE UN 200.
 *
 * Y sobre un 200 no hay reintento que contar: `retry` solo actua cuando la
 * peticion falla. O sea que un `retry: 2` puesto "por las dudas" en una
 * mutacion pasa por delante de los tests de ruta, de metodo, de cuerpo, de
 * invalidacion, del centinela de la consulta ajena, del barrido de `gcTime` y
 * de los seis `toHaveBeenCalledTimes(1)` sin que ninguno lo note. Se comprobo:
 * con `retry: 2` en `useCrearAusencia`, los 100 tests de la fase seguian en
 * verde y `tsc` tambien.
 *
 * Y el daño es real y silencioso. Un POST no es idempotente: un 500 o un
 * timeout del lado de la API despues de que la fila SI se escribio —el caso
 * clasico— se reintenta dos veces mas y deja tres cierres duplicados. El admin
 * ve un error en pantalla y tres ausencias en la lista.
 *
 * Lo que fija esto es «una escritura que falla sale UNA vez», no «el hook no
 * declara `retry`»: da igual como se reintente —`retry`, un `onError` que
 * vuelva a mutar, un reintento a mano dentro del `mutationFn`—, lo que se mide
 * es cuantas veces salio la peticion.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useCrearAusencia());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(
      doble,
      'el POST se reintento: podrian quedar ausencias duplicadas',
    ).toHaveBeenCalledTimes(1);
  });

  it('la baja', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(404);

    const { result } = montar(() => useBorrarAusencia('a1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un fallo no invalida nada: la lista en pantalla sigue siendo la buena', async () => {
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useCrearAusencia());
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
  it('crear invalida la lista de ausencias', async () => {
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useCrearAusencia());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ queryKey: ['ausencias'] });
  });

  it('borrar invalida la lista de ausencias', async () => {
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useBorrarAusencia('a1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(1);
    expect(espia).toHaveBeenCalledWith({ queryKey: ['ausencias'] });
  });

  it('la invalidacion alcanza a la lista CON filtros puestos', async () => {
    // La clave real lleva los filtros dentro. Invalidar `['ausencias', {}]`
    // —la unica clave que un spec de hook solo tendria delante— no alcanzaria
    // a la lista de diciembre que esta en pantalla.
    const filtrada = ['ausencias', { desde: '2026-12-01', hasta: '2026-12-31' }];
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useCrearAusencia());
    cliente.setQueryData(filtrada, []);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await Promise.resolve().then().then().then();

    const consulta = cliente.getQueryCache().find({ queryKey: filtrada });
    expect(consulta, 'la consulta sembrada no esta: el test no mide nada').toBeDefined();
    expect(consulta?.state.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  it('crear una ausencia', async () => {
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useCrearAusencia());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar una ausencia', async () => {
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useBorrarAusencia('a1'));
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
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useCrearAusencia());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Feriado-Marcador');
    expect(cache.entradas).toBe(0);
  });

  it('borrar no deja nada', async () => {
    dobleDeFetch(AUSENCIA);

    const { result, cliente } = montar(() => useBorrarAusencia('a1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Feriado-Marcador');
    expect(cache.entradas).toBe(0);
  });
});
