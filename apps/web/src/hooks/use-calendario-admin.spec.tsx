import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { EstadoJob, MesCalendarioPublico, PlanDeMes } from '@boxadmin/shared';
import {
  ESPERA_DEL_SONDEO,
  ESTADOS_FINALES,
  clavesDelCalendario,
  useMesDelCalendario,
  usePlanDelMes,
  usePublicarMes,
} from './use-calendario-admin';

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const ELEGIDO = { salaId: 's1', anio: 2026, mes: 11 } as const;

/**
 * Relojes falsos en TODO el archivo, y nada de `waitFor`.
 *
 * El sondeo es lo que hay que probar aqui y vive en un temporizador de tres
 * segundos: con relojes reales, los cuatro tests de "el sondeo PARA" tendrian
 * que esperar de verdad y el de "sigue" se jugaria el resultado al margen de
 * holgura del runner. Con relojes falsos se avanza el tiempo a mano y la
 * respuesta es la misma siempre.
 *
 * Por eso tampoco se usa `waitFor`: espera con temporizadores que aqui no
 * corren solos. Lo que se usa es `asentar()`, que deja correr las microtareas
 * (la peticion que ya resolvio) sin mover el reloj.
 */
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Monta el hook con su propio `QueryClient` y lo devuelve junto al cliente. */
function montar<T>(hook: () => T) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={cliente}>{children}</QueryClientProvider>
  );

  return { ...renderHook(hook, { wrapper: envoltorio }), cliente };
}

/** Deja correr lo que ya resolvio, sin mover el reloj. */
async function asentar(): Promise<void> {
  for (let vuelta = 0; vuelta < 4; vuelta += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
}

/** Mueve el reloj y deja que se asiente lo que eso dispare. */
async function avanzar(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await asentar();
}

/** Un `fetch` que siempre responde 200 con el JSON que se le pase. */
function dobleDeFetch(datos: unknown) {
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

/** Un plan de mes vacio pero con la forma entera del contrato. */
const PLAN: PlanDeMes = {
  turnosACrear: [],
  reservasACrear: [],
  etiquetasDeProfesor: [],
  conflictos: [],
  exclusiones: [],
  resumen: { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 },
};

/** El mes tal como lo devuelve la API, con la publicacion que se le pida. */
function mesCon(publicacion: MesCalendarioPublico['publicacion']): MesCalendarioPublico {
  return {
    id: 'm1',
    tenantId: 't1',
    salaId: 's1',
    anio: 2026,
    mes: 11,
    estado: 'BORRADOR',
    publicadoEn: null,
    publicadoPor: null,
    publicacion,
  };
}

/** Un trabajo en el estado que se pida. */
function conJob(estado: EstadoJob): MesCalendarioPublico {
  return mesCon({ jobId: 'j1', estado, resumen: null, error: null });
}

// ---------------------------------------------------------------------------
// Las claves
// ---------------------------------------------------------------------------

describe('clavesDelCalendario', () => {
  it('el plan y el mes son claves distintas para el mismo mes', () => {
    // Si compartieran clave, la previsualizacion y el estado del mes se
    // pisarian en la cache y la pantalla mostraria uno donde espera el otro.
    expect(clavesDelCalendario.plan(ELEGIDO)).toEqual(['plan-del-mes', 's1', 2026, 11]);
    expect(clavesDelCalendario.mes(ELEGIDO)).toEqual(['mes-calendario', 's1', 2026, 11]);
  });

  it('la sala, el anio y el mes entran en la clave', () => {
    // Es lo que hace que cambiar de mes en el selector traiga datos nuevos en
    // vez de reusar los del mes anterior.
    expect(clavesDelCalendario.plan({ salaId: 's2', anio: 2027, mes: 1 })).toEqual([
      'plan-del-mes',
      's2',
      2027,
      1,
    ]);
  });
});

// ---------------------------------------------------------------------------
// La previsualizacion
// ---------------------------------------------------------------------------

describe('usePlanDelMes', () => {
  it('va por POST a la ruta exacta', async () => {
    // POST aunque sea una lectura: la ruta es `previsualizar` y el servicio la
    // declaro sincrona a proposito. Con GET la API responde 404 y el admin ve
    // "no se pudo previsualizar" sin entender por que.
    const doble = dobleDeFetch(PLAN);

    const { result } = montar(() => usePlanDelMes(ELEGIDO));
    await asentar();

    expect(result.current.isSuccess).toBe(true);
    expect(llamada(doble).url).toBe('/api/bx/calendario/s1/2026/11/previsualizar');
    expect(llamada(doble).metodo).toBe('POST');
  });

  it('devuelve el plan entero, conflictos incluidos', async () => {
    // Los conflictos VIENEN AQUI. Pedirlos aparte a `GET .../conflictos` seria
    // una segunda peticion para un dato que ya esta, con dos respuestas que
    // pueden discrepar.
    const plan: PlanDeMes = {
      ...PLAN,
      conflictos: [
        { tipo: 'CUPO_LLENO', perfilId: 'p1', fecha: '2026-11-03', detalle: 'no entra' },
      ],
    };
    dobleDeFetch(plan);

    const { result } = montar(() => usePlanDelMes(ELEGIDO));
    await asentar();

    expect(result.current.data?.conflictos).toHaveLength(1);
  });

  it('sin mes elegido no sale ninguna peticion', async () => {
    const doble = dobleDeFetch(PLAN);

    const { result } = montar(() => usePlanDelMes(null));
    await asentar();

    expect(doble).not.toHaveBeenCalled();
    // No basta con contar: `base(null)` revienta al desestructurar, asi que un
    // `enabled` roto tambien dejaria el contador en cero. Lo que distingue
    // "apagada" de "arranco y exploto" es que no haya error y no este buscando.
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isError).toBe(false);
  });

  it('NO sondea: la previsualizacion no cambia sola', async () => {
    const doble = dobleDeFetch(PLAN);

    montar(() => usePlanDelMes(ELEGIDO));
    await asentar();
    await avanzar(ESPERA_DEL_SONDEO * 4);

    // Un `refetchInterval` copiado del otro hook serian POST cada tres
    // segundos a una ruta que recalcula el mes entero.
    expect(doble).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// El estado del mes y el sondeo
// ---------------------------------------------------------------------------

describe('useMesDelCalendario', () => {
  it('pide la ruta del mes por GET', async () => {
    const doble = dobleDeFetch(conJob('terminado'));

    const { result } = montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();

    expect(result.current.isSuccess).toBe(true);
    expect(llamada(doble).url).toBe('/api/bx/calendario/s1/2026/11');
    expect(llamada(doble).metodo).toBe('GET');
  });

  it('sin mes elegido no sale ninguna peticion', async () => {
    const doble = dobleDeFetch(conJob('terminado'));

    const { result } = montar(() => useMesDelCalendario(null));
    await asentar();

    expect(doble).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
    expect(result.current.isError).toBe(false);
  });
});

describe('el sondeo PARA', () => {
  // Los cuatro casos en los que no hay nada mas que esperar. Si alguno no
  // parara, la maquina del mostrador manda una peticion cada tres segundos
  // hasta que alguien cierre la pestaña.

  it('cuando el trabajo termino', async () => {
    const doble = dobleDeFetch(conJob('terminado'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO * 4);
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('cuando el trabajo fallo', async () => {
    // Fallido tambien es final: reintentar solo no arregla nada y el admin
    // tiene que volver a publicar a mano.
    const doble = dobleDeFetch(conJob('fallido'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO * 4);
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('cuando `publicacion` viene null', async () => {
    // Un mes que nunca se publico. La rama es la de `estado === undefined`:
    // sin ella, el encadenado opcional devuelve `undefined`, `includes` dice
    // que no y el hook sondea para siempre un mes sin trabajo.
    const doble = dobleDeFetch(mesCon(null));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO * 4);
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('con el estado `sin_job`', async () => {
    // La OTRA forma de decir "no hay trabajo", y es un estado de verdad, no un
    // nulo. Contemplar solo una de las dos deja la mitad del agujero abierto.
    const doble = dobleDeFetch(conJob('sin_job'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO * 4);
    expect(doble).toHaveBeenCalledTimes(1);
  });
});

describe('el sondeo SIGUE', () => {
  it('con el trabajo en cola', async () => {
    const doble = dobleDeFetch(conJob('en_cola'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO);
    expect(doble).toHaveBeenCalledTimes(2);

    await avanzar(ESPERA_DEL_SONDEO);
    expect(doble).toHaveBeenCalledTimes(3);
  });

  it('con el trabajo procesando', async () => {
    const doble = dobleDeFetch(conJob('procesando'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(ESPERA_DEL_SONDEO);
    expect(doble).toHaveBeenCalledTimes(2);
  });

  it('espera EXACTAMENTE la constante declarada, no un numero suelto', async () => {
    // Clava el intervalo contra `ESPERA_DEL_SONDEO` por los dos lados: justo
    // antes todavia no, justo despues si. Sin el lado de "todavia no", un
    // sondeo cada 100 ms pasaria el test de arriba sin despeinarse.
    const doble = dobleDeFetch(conJob('en_cola'));

    montar(() => useMesDelCalendario(ELEGIDO));
    await asentar();

    await avanzar(ESPERA_DEL_SONDEO - 1);
    expect(doble).toHaveBeenCalledTimes(1);

    await avanzar(1);
    expect(doble).toHaveBeenCalledTimes(2);
  });

  it('los estados finales son los dos que son', () => {
    // La constante es lo que leen los tests de arriba: si alguien le agrega
    // `procesando`, el sondeo se corta a mitad del trabajo y la pantalla se
    // queda diciendo "procesando" para siempre.
    expect([...ESTADOS_FINALES]).toEqual(['terminado', 'fallido']);
  });
});

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

const ENCOLADA = { jobId: 'j1', salaId: 's1', anio: 2026, mes: 11 };

describe('usePublicarMes', () => {
  it('va por POST a /publicar', async () => {
    const doble = dobleDeFetch(ENCOLADA);

    const { result } = montar(() => usePublicarMes(ELEGIDO));
    act(() => result.current.mutate());
    await asentar();

    expect(result.current.isSuccess).toBe(true);
    expect(llamada(doble).url).toBe('/api/bx/calendario/s1/2026/11/publicar');
    expect(llamada(doble).metodo).toBe('POST');
    // Sin cuerpo: el mes ya va en la ruta. Un cuerpo de adorno lo rechaza el
    // `forbidNonWhitelisted` de la API con un 400.
    expect(llamada(doble).cuerpo).toBeUndefined();
  });

  it('devuelve el jobId que encolo', async () => {
    dobleDeFetch(ENCOLADA);

    const { result } = montar(() => usePublicarMes(ELEGIDO));
    act(() => result.current.mutate());
    await asentar();

    // Es un 202: no hay mes publicado todavia, hay un trabajo. Lo que sigue lo
    // cuenta `useMesDelCalendario`.
    expect(result.current.data).toEqual(ENCOLADA);
  });

  it('publicar es UNA sola peticion', async () => {
    // `toHaveBeenCalledWith` nunca pregunta cuantas veces. Un GET "de cortesia"
    // para refrescar el mes, o un reintento, pasarian por delante de todos los
    // tests de ruta y de metodo sin que nadie los vea. Y publicar NO es
    // idempotente: cada llamada encola otro trabajo que escribe el mes.
    const doble = dobleDeFetch(ENCOLADA);

    const { result } = montar(() => usePublicarMes(ELEGIDO));
    act(() => result.current.mutate());
    await asentar();

    expect(result.current.isSuccess).toBe(true);
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('la mutacion de publicar lleva gcTime 0: no queda en la cache de mutaciones', async () => {
    // `reset()` de TanStack no limpia, solo desengancha al observador y
    // programa el recolector con el `gcTime` que haya. Sin `gcTime: 0`, lo que
    // se mando y lo que volvio se quedan cinco minutos en el `QueryClient` de
    // toda la aplicacion, que es uno solo y dura lo que dura la pestaña.
    dobleDeFetch(ENCOLADA);

    const { result, cliente, unmount } = montar(() => usePublicarMes(ELEGIDO));
    act(() => result.current.mutate());
    await asentar();
    expect(result.current.isSuccess).toBe(true);

    unmount();
    await avanzar(1);

    expect(cliente.getMutationCache().getAll()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// LO QUE QUEDA GUARDADO DESPUES DE PUBLICAR
// ---------------------------------------------------------------------------

/**
 * Un `fetch` que responde SEGUN LA RUTA: `/publicar` devuelve el encolado y
 * cualquier otra cosa devuelve el mes. Hace falta para montar los dos hooks
 * sobre el mismo `QueryClient`, que es como viven en la pantalla de verdad.
 */
function dobleSegunRuta(mes: MesCalendarioPublico) {
  const doble = vi.fn().mockImplementation((url: string) => {
    const datos = url.endsWith('/publicar') ? ENCOLADA : mes;
    return Promise.resolve(
      new Response(JSON.stringify(datos), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', doble);
  return doble;
}

/** Cuantas veces se consulto el estado del mes (sin contar el POST de publicar). */
function consultasDelMes(doble: ReturnType<typeof dobleSegunRuta>): number {
  return doble.mock.calls.filter(([url]) => !String(url).endsWith('/publicar')).length;
}

describe('publicar no toca la cache de consultas', () => {
  it('lo que queda guardado bajo la clave del mes sigue siendo un mes', async () => {
    // Sembrar la cache del mes con la respuesta de publicar —"para que la
    // pantalla reaccione sin esperar al primer sondeo"— compila, no agrega
    // ninguna peticion y pasa por delante de todos los tests de ruta, de
    // metodo, de cuenta y de `gcTime`: `gcTime: 0` tapa la cache de MUTACIONES,
    // que es otro almacen. Lo unico que lo ve es mirar que quedo guardado.
    const doble = dobleSegunRuta(conJob('en_cola'));

    const { result, cliente } = montar(() => ({
      mes: useMesDelCalendario(ELEGIDO),
      publicar: usePublicarMes(ELEGIDO),
    }));
    await asentar();
    expect(consultasDelMes(doble)).toBe(1);

    act(() => result.current.publicar.mutate());
    await asentar();
    expect(result.current.publicar.isSuccess).toBe(true);

    // `PublicacionEncolada` no es `MesCalendarioPublico`: el jobId esta, pero
    // no hay `estado`, ni `publicacion`, ni `publicadoEn`.
    expect(cliente.getQueryData(clavesDelCalendario.mes(ELEGIDO))).toEqual(conJob('en_cola'));
  });

  it('despues de publicar el sondeo sigue vivo', async () => {
    // El daño concreto de sembrar: el mes guardado deja de tener
    // `publicacion`, `refetchInterval` lee `undefined`, para el sondeo, y la
    // pantalla se queda diciendo "encolado" hasta que alguien recargue —
    // justo en el momento en que el sondeo es para lo UNICO que sirve.
    const doble = dobleSegunRuta(conJob('en_cola'));

    const { result } = montar(() => ({
      mes: useMesDelCalendario(ELEGIDO),
      publicar: usePublicarMes(ELEGIDO),
    }));
    await asentar();

    act(() => result.current.publicar.mutate());
    await asentar();

    await avanzar(ESPERA_DEL_SONDEO);
    expect(consultasDelMes(doble)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// LAS MUTACIONES, COMO CONJUNTO
// ---------------------------------------------------------------------------

/**
 * Lo mismo que en `use-usuarios.spec`: la propiedad es del ARCHIVO, no de cada
 * hook. Un test por hook protege a los que hay hoy y deja nacer desnudo al de
 * manana, porque hay que acordarse de sumarlo a la lista.
 */
// Desde la raiz de Vitest (`apps/web`), no desde `import.meta.url`: bajo jsdom
// esa URL no es `file:` y `readFileSync` la rechaza.
const FUENTE = readFileSync(resolve(process.cwd(), 'src/hooks/use-calendario-admin.ts'), 'utf8');

/** Por cada `useMutation` del archivo, el hook que lo contiene y si esta tapado. */
function mutacionesDelArchivo(): Record<string, boolean> {
  const porHook: Record<string, boolean> = {};

  const llamadas = /useMutation\s*[<(]/g;

  for (let hallada = llamadas.exec(FUENTE); hallada !== null; hallada = llamadas.exec(FUENTE)) {
    const cierre = FUENTE.indexOf('\n  });', hallada.index);
    const opciones = FUENTE.slice(hallada.index, cierre === -1 ? FUENTE.length : cierre);

    const previos = [...FUENTE.slice(0, hallada.index).matchAll(/export function (\w+)/g)];
    const nombre = previos.at(-1)?.[1] ?? `(sin nombre, posicion ${hallada.index})`;

    porHook[nombre] = opciones.includes('gcTime: 0');
  }

  return porHook;
}

describe('ninguna mutacion sin gcTime', () => {
  it('TODAS las mutaciones del archivo lo llevan, las de hoy y las de manana', () => {
    const porHook = mutacionesDelArchivo();

    // Un conjunto vacio cumple cualquier cosa que se le pida: si el parseo no
    // encuentra nada, el test tiene que caer y no pasar con las manos vacias.
    expect(Object.keys(porHook).length).toBeGreaterThanOrEqual(1);

    expect(Object.entries(porHook).filter(([, tapada]) => !tapada)).toEqual([]);
  });
});
