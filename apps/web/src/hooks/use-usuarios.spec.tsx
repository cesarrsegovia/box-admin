import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
// LAS MUTACIONES, COMO CONJUNTO
// ---------------------------------------------------------------------------

/**
 * TODAS las mutaciones de este archivo llevan `gcTime: 0`, y eso se comprueba
 * de una vez.
 *
 * Por defecto TanStack conserva cada mutacion cinco minutos despues de que su
 * componente se desmonte, con lo que se MANDO (`variables`) y lo que VOLVIO
 * (`data`) dentro. El `QueryClient` es uno solo para toda la aplicacion y dura
 * lo que dura la pestaña. Aqui pasan las DOS contraseñas temporales del sistema
 * —la del alta y la del reseteo—, que se ven una sola vez, y el texto de las
 * fichas medicas editadas.
 *
 * Esto se lee del CODIGO FUENTE, y no es por pereza. Un test por hook da la
 * propiedad equivocada: protege a los seis que hay hoy y deja nacer al septimo
 * desnudo, porque hay que acordarse de sumarlo a la lista. Lo que hace falta
 * garantizar es que el ARCHIVO no tenga ni una mutacion sin tapar, y eso es una
 * propiedad del archivo, no de cada hook. Una mutacion nueva nace cubierta: si
 * se agrega sin `gcTime`, este test cae solo y nombra al hook.
 *
 * Es ademas la clase de proteccion que se "limpia" sin querer: seis lineas
 * iguales repetidas parecen ruido copiado, y sin test que las defienda el
 * proximo que pase las borra y nada avisa. Ya nos paso con el `@Public()` de la
 * fase anterior.
 */
// Desde la raiz de Vitest (`apps/web`), no desde `import.meta.url`: bajo jsdom
// esa URL no es `file:` y `readFileSync` la rechaza.
const FUENTE = readFileSync(resolve(process.cwd(), 'src/hooks/use-usuarios.ts'), 'utf8');

/** Por cada `useMutation` del archivo, el hook que lo contiene y si esta tapado. */
function mutacionesDelArchivo(): Record<string, boolean> {
  const porHook: Record<string, boolean> = {};

  // `useMutation` seguido de `<` o `(`: asi no cuenta la linea del `import`
  // (`useMutation,`) ni las veces que un comentario lo nombre. Las dos formas,
  // con genericos y sin ellos, para que valga para lo que se escriba manana.
  const llamadas = /useMutation\s*[<(]/g;

  for (let hallada = llamadas.exec(FUENTE); hallada !== null; hallada = llamadas.exec(FUENTE)) {
    // El bloque de opciones termina en el `});` a dos espacios de sangria, que
    // es como cierran todos los hooks de este archivo.
    const cierre = FUENTE.indexOf('\n  });', hallada.index);
    const opciones = FUENTE.slice(hallada.index, cierre === -1 ? FUENTE.length : cierre);

    // El nombre sale del `export function` mas cercano hacia atras, para que el
    // fallo diga a QUE hook le falta y no un numero de linea.
    const previos = [...FUENTE.slice(0, hallada.index).matchAll(/export function (\w+)/g)];
    const nombre = previos.at(-1)?.[1] ?? `(sin nombre, posicion ${hallada.index})`;

    porHook[nombre] = opciones.includes('gcTime: 0');
  }

  return porHook;
}

describe('ninguna mutacion sin gcTime', () => {
  it('TODAS las mutaciones del archivo lo llevan, las de hoy y las de manana', () => {
    const porHook = mutacionesDelArchivo();

    // Sin esto, un parseo que no encontrara nada pasaria el test con las manos
    // vacias: un conjunto vacio cumple cualquier cosa que se le pida.
    expect(Object.keys(porHook).length).toBeGreaterThanOrEqual(6);

    expect(Object.entries(porHook).filter(([, tapada]) => !tapada)).toEqual([]);
  });
});
