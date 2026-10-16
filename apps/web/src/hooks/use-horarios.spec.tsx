import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  cacheDeConsultas,
  dobleDe204,
  dobleDeFetch,
  dobleQueFalla,
  llamada,
  montar,
} from '@/test/andamiaje-de-hooks';
import {
  queryDeHorarios,
  useActualizarHorario,
  useBorrarHorario,
  useCrearHorario,
  useHorarios,
} from './use-horarios';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Un horario tal como vuelve de la API, con un marcador para rastrearlo. */
const HORARIO = {
  id: 'h1',
  profesorId: 'p1',
  profesorNombre: 'Sofia-Pereyra-Marcador',
  salaId: 's1',
  salaNombre: 'Sala 1',
  diaSemana: 1,
  horaInicio: '09:00',
  horaFin: '10:00',
  activo: true,
  desde: '2026-10-01',
  hasta: null,
  tarifaPorHora: '1500.00',
};

/** El alta tal como la mandaria el formulario. La tarifa, CADENA. */
const ALTA = {
  profesorId: 'p1',
  salaId: 's1',
  diaSemana: 1,
  horaInicio: '09:00',
  horaFin: '10:00',
  desde: '2026-10-01',
  tarifaPorHora: '1500.00',
};

// ---------------------------------------------------------------------------
// La funcion pura
// ---------------------------------------------------------------------------

describe('queryDeHorarios', () => {
  it('sin filtros no manda query', () => {
    expect(queryDeHorarios({})).toBe('');
  });

  it('una cadena vacia NO se manda', () => {
    // `?profesorId=` no es "sin profesor": para el service de la API es un
    // profesor cuyo id es la cadena vacia, y el listado volveria vacio. El
    // admin veria "esta profesora no tiene horarios" sobre una que si tiene.
    expect(queryDeHorarios({ profesorId: '', salaId: '' })).toBe('');
  });

  it('un filtro vacio no arrastra al que SI tiene valor', () => {
    // El caso mixto, que es el de verdad: el formulario eligio profesora y
    // dejo la sala en "todas".
    expect(queryDeHorarios({ profesorId: 'p1', salaId: '' })).toBe('?profesorId=p1');
    expect(queryDeHorarios({ profesorId: '', salaId: 's1' })).toBe('?salaId=s1');
  });

  it('manda los dos juntos, en orden', () => {
    expect(queryDeHorarios({ profesorId: 'p1', salaId: 's1' })).toBe('?profesorId=p1&salaId=s1');
  });

  it('escapa lo que haga falta', () => {
    expect(queryDeHorarios({ profesorId: 'a b&c' })).toBe('?profesorId=a+b%26c');
  });
});

// ---------------------------------------------------------------------------
// Lectura: ruta Y metodo
// ---------------------------------------------------------------------------

describe('useHorarios', () => {
  it('pide `/horarios-profesor` con los filtros en la query', async () => {
    // La ruta base sale del `@Controller('horarios-profesor')`, no del nombre
    // del modulo. Un `/horarios` a secas es un 404.
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useHorarios({ profesorId: 'p1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/horarios-profesor?profesorId=p1');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin filtros pide la ruta pelada, sin interrogante', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useHorarios({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/horarios-profesor');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('leer la lista es UNA sola peticion', async () => {
    const doble = dobleDeFetch([]);

    const { result } = montar(() => useHorarios({}));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Escrituras: ruta Y metodo Y cuerpo
// ---------------------------------------------------------------------------

describe('useCrearHorario', () => {
  it('va con POST a `/horarios-profesor` y manda EXACTAMENTE lo que le dieron', async () => {
    // `forbidNonWhitelisted`: un campo de adorno que el hook agregue por su
    // cuenta convierte un alta valida en un 400.
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useCrearHorario());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/horarios-profesor',
      metodo: 'POST',
      cuerpo: ALTA,
    });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useCrearHorario());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useActualizarHorario', () => {
  it('va con PATCH al horario y manda EXACTAMENTE lo que le dieron', async () => {
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useActualizarHorario('h1'));
    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble)).toEqual({
      url: '/api/bx/horarios-profesor/h1',
      metodo: 'PATCH',
      cuerpo: { horaFin: '11:00' },
    });
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useActualizarHorario('h1'));
    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('useBorrarHorario', () => {
  it('va con DELETE al horario, sin cuerpo', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarHorario('h1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/horarios-profesor/h1');
    expect(llamada(doble).metodo).toBe('DELETE');
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('un 204 sin cuerpo no rompe la mutacion', async () => {
    // Este borrado —y solo este de los cuatro de la fase— responde 204. Si el
    // hook esperara la fila de vuelta, el admin veria un error despues de una
    // baja que SI ocurrio.
    dobleDe204();

    const { result } = montar(() => useBorrarHorario('h1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toBeNull();
  });

  it('es UNA sola peticion', async () => {
    const doble = dobleDe204();

    const { result } = montar(() => useBorrarHorario('h1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// El dinero: `tarifaPorHora` viaja como CADENA
// ---------------------------------------------------------------------------

describe('la tarifa es dinero, no un numero', () => {
  // Regla del repo desde la Fase 1 y repetida en el contrato
  // `HorarioProfesorPublico`: los decimales de dinero viajan como string. Un
  // float binario no representa 1500.10 exactamente, y el DTO valida contra
  // `/^\d{1,8}(\.\d{1,2})?$/`, que un `1500` numerico no cumple igual.

  it('el cuerpo del alta lleva la CADENA `1500.00`, no el numero 1500', async () => {
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useCrearHorario());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(typeof cuerpo.tarifaPorHora, 'la tarifa salio como number: es dinero').toBe('string');
    expect(cuerpo.tarifaPorHora).toBe('1500.00');
  });

  it('el PATCH conserva los centavos que un float perderia', async () => {
    // `1500.10` es el caso que delata la conversion: `String(Number('1500.10'))`
    // da `'1500.1'`, y esos dos centavos de forma son los que el DECIMAL(10,2)
    // de la liquidacion espera ver.
    const doble = dobleDeFetch(HORARIO);

    const { result } = montar(() => useActualizarHorario('h1'));
    result.current.mutate({ tarifaPorHora: '1500.10' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(typeof cuerpo.tarifaPorHora).toBe('string');
    expect(cuerpo.tarifaPorHora).toBe('1500.10');
  });
});

// ---------------------------------------------------------------------------
// EL CAMINO DE ERROR: una escritura que falla no se reintenta
// ---------------------------------------------------------------------------

/**
 * Los conteos de arriba corren todos sobre un 200, y sobre un 200 no hay
 * reintento que contar. El porque esta entero en `use-ausencias.spec.tsx`: un
 * `retry` puesto "por las dudas" en una mutacion es invisible para todos los
 * tests del camino feliz, y en un POST deja filas duplicadas.
 *
 * Aqui duplicar un horario no es cosmetico: la liquidacion del mes suma las
 * horas de cada patron, asi que tres copias del mismo horario se le pagan tres
 * veces a la profesora.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useCrearHorario());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble, 'el POST se reintento: podrian quedar horarios duplicados').toHaveBeenCalledTimes(
      1,
    );
  });

  it('el PATCH', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(409);

    const { result } = montar(() => useActualizarHorario('h1'));
    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la baja', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(404);

    const { result } = montar(() => useBorrarHorario('h1'));
    result.current.mutate();
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un fallo no invalida nada', async () => {
    dobleQueFalla(409);

    const { result, cliente } = montar(() => useCrearHorario());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Invalidacion: la lista de horarios, y nada mas
// ---------------------------------------------------------------------------

describe('invalidacion tras una escritura', () => {
  it('crear invalida la lista de horarios', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useCrearHorario());
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['horarios'] });
  });

  it('actualizar invalida la lista de horarios', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useActualizarHorario('h1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['horarios'] });
  });

  it('borrar invalida la lista de horarios', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarHorario('h1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledWith({ queryKey: ['horarios'] });
  });

  it('la invalidacion alcanza a la lista CON filtros puestos', async () => {
    // La clave real es `['horarios', { profesorId: 'p1' }]`. Invalidar
    // `['horarios', {}]` —la clave sin filtros, que es la que un spec de hook
    // solo tendria delante— no la alcanzaria y el alta no se veria aparecer.
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useCrearHorario());
    cliente.setQueryData(['horarios', { profesorId: 'p1' }], []);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await Promise.resolve().then().then().then();

    const consulta = cliente.getQueryCache().find({ queryKey: ['horarios', { profesorId: 'p1' }] });
    expect(consulta, 'la consulta sembrada no esta: el test no mide nada').toBeDefined();
    expect(consulta?.state.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// El ALCANCE: no tocar lo que no es suyo
// ---------------------------------------------------------------------------

describe('una escritura no refresca consultas ajenas', () => {
  // Con un unico consumidor del `QueryClient`, una invalidacion dirigida y una
  // global son indistinguibles. Ver `src/test/consulta-ajena.ts`.

  it('crear un horario', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useCrearHorario());
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('actualizar un horario', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useActualizarHorario('h1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('borrar un horario', async () => {
    dobleDe204();

    const { result, cliente } = montar(() => useBorrarHorario('h1'));
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
  // `gcTime: 0` tapa la cache de MUTACIONES. La de CONSULTAS la comparte toda
  // la aplicacion y se lee desde el devtools: un `setQueryData` "por
  // comodidad" dejaria ahi el nombre de la profesora y su tarifa.

  it('crear no deja nada', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useCrearHorario());
    result.current.mutate(ALTA);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sofia-Pereyra-Marcador');
    expect(cache.entradas).toBe(0);
  });

  it('actualizar no deja nada', async () => {
    dobleDeFetch(HORARIO);

    const { result, cliente } = montar(() => useActualizarHorario('h1'));
    result.current.mutate({ horaFin: '11:00' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cache = cacheDeConsultas(cliente);
    expect(cache.texto).not.toContain('Sofia-Pereyra-Marcador');
    expect(cache.entradas).toBe(0);
  });
});
