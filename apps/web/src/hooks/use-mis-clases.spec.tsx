import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { vigilarUnaConsultaAjena } from '@/test/consulta-ajena';
import {
  cacheDeConsultas,
  dobleDeFetch,
  dobleQueFalla,
  llamada,
  montar,
} from '@/test/andamiaje-de-hooks';
import {
  clavesDeMisClases,
  queryDeMisClases,
  useAlumnosDeLaClase,
  useMisClases,
  usePasarLista,
} from './use-mis-clases';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Lo que esta fase siembra, y por que se registra
// ---------------------------------------------------------------------------

/**
 * ESTE SPEC SIEMBRA NOMBRES DE PERSONAS Y SI FALTARON A CLASE.
 *
 * No es un `id` ni un importe: es el nombre propio de una alumna y el hecho de
 * que ese martes no vino. La gente de la que habla este archivo no esta en la
 * sala para quejarse si acaba en el titulo de la pestaña, en `localStorage` de
 * la maquina del mostrador o en el registro de CI, que lo guarda mas tiempo y
 * lo lee mas gente que la consola de la profesora.
 *
 * Por eso los centinelas se registran en los trece canales globales. Se
 * registran los nombres Y el `perfilId` del que falto: el id solo es "un
 * identificador opaco" mientras no viaje al lado de la lista de presentes,
 * donde no estar ES el dato.
 *
 * Va en el cuerpo del modulo y no en un `beforeEach`: cada archivo de test
 * corre aislado, asi que lo registrado vale para este y para ninguno mas.
 */
const CENTINELAS = {
  alumnaQueVino: 'Sofia-Pereyra-Vino-Marcador',
  alumnoQueFalto: 'Martin-Quiroga-Falto-Marcador',
  perfilDelQueFalto: 'perfil-martin-que-falto-marcador',
  nombreDeLaClase: 'Funcional-Marcador',
};

vigilarEstosDatos(CENTINELAS);

const PERFIL_PRESENTE = 'perfil-sofia-que-vino-marcador';

/** La lista tal como vuelve de `GET /mis-clases/:turnoId/alumnos`. */
const ALUMNOS = [
  { perfilId: PERFIL_PRESENTE, nombreCompleto: CENTINELAS.alumnaQueVino, asistio: true },
  {
    perfilId: CENTINELAS.perfilDelQueFalto,
    nombreCompleto: CENTINELAS.alumnoQueFalto,
    asistio: false,
  },
];

/** Una clase tal como vuelve de `GET /mis-clases`. */
const CLASE = {
  turnoId: 't1',
  salaId: 's1',
  salaNombre: 'Sala 1',
  nombre: CENTINELAS.nombreDeLaClase,
  fecha: '2026-10-20',
  horaInicio: '09:00',
  horaFin: '10:00',
  cupo: 12,
  reservasActivas: 2,
  listaPasada: false,
};

const RANGO = { desde: '2026-10-01', hasta: '2026-10-31' };

const RUTA_AGENDA = '/api/bx/mis-clases?desde=2026-10-01&hasta=2026-10-31';

/**
 * Un `fetch` que contesta SEGUN LA URL.
 *
 * `dobleDeFetch` devuelve el mismo JSON a todo el mundo, y con eso una cache
 * que guardara las dos clases bajo la misma clave se veria exactamente igual
 * que una que las guarda separadas: las dos respuestas son identicas. Aqui no.
 */
function dobleQueDistingue(porUrl: Record<string, unknown>) {
  const doble = vi.fn().mockImplementation((url: string) =>
    Promise.resolve(
      new Response(JSON.stringify(porUrl[url] ?? []), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', doble);
  return doble;
}

// ---------------------------------------------------------------------------
// La funcion pura: el rango
// ---------------------------------------------------------------------------

describe('queryDeMisClases', () => {
  it('manda los dos extremos, en orden', () => {
    expect(queryDeMisClases(RANGO)).toBe('?desde=2026-10-01&hasta=2026-10-31');
  });

  it('el rango viaja siempre: desde y hasta son obligatorios', () => {
    // ESTE ES EL CASO QUE DISTINGUE ESTA FASE DE LAS 9 Y 10. Alli una cadena
    // vacia era "sin filtro" y se QUITABA del query. Aqui `exigirRango` del
    // controller los valida A MANO y los exige: omitir un extremo no pide
    // "todas las fechas", convierte un 400 que explica que falta en otra cosa.
    expect(queryDeMisClases({ desde: '', hasta: '' })).toBe('?desde=&hasta=');

    // Y el caso mixto, que es el de verdad: el formulario tiene un extremo
    // puesto y el otro todavia no. El que SI tiene valor no arrastra al otro
    // fuera del query.
    expect(queryDeMisClases({ desde: '2026-10-01', hasta: '' })).toBe('?desde=2026-10-01&hasta=');
    expect(queryDeMisClases({ desde: '', hasta: '2026-10-31' })).toBe('?desde=&hasta=2026-10-31');
  });

  it('un rango al reves SE MANDA, para que la API conteste', () => {
    // `desde > hasta` tiene su propio mensaje en el controller. Una rama que
    // lo "arreglara" aqui —dandolos vuelta, o no mandando nada— le daria a la
    // profesora un listado de un rango que no pidio, sin un solo error por
    // delante.
    expect(queryDeMisClases({ desde: '2026-10-31', hasta: '2026-10-01' })).toBe(
      '?desde=2026-10-31&hasta=2026-10-01',
    );
  });

  it('escapa lo que haga falta', () => {
    expect(queryDeMisClases({ desde: 'a b&c', hasta: 'x' })).toBe('?desde=a+b%26c&hasta=x');
  });
});

// ---------------------------------------------------------------------------
// Los dos mensajes del controller, palabra por palabra
// ---------------------------------------------------------------------------

/**
 * `exigirRango` NO es un DTO: son dos `BadRequestException` escritas a mano en
 * `apps/api/src/mis-clases/mis-clases.controller.ts`. Y el service tiene otras
 * dos propias. Los cuatro textos estan copiados de la fuente, no de memoria, y
 * se fijan aqui porque son lo UNICO que la pantalla puede pintar: `pedir`
 * conserva el `message` de la API en vez de sustituirlo por uno generico.
 */
describe('lo que dice la API llega tal cual', () => {
  const MENSAJES = [
    'desde y hasta son obligatorios, con formato YYYY-MM-DD',
    'desde no puede ser posterior a hasta',
    'Esa clase todavia no empezo',
    `No tienen reserva activa en esta clase: ${CENTINELAS.perfilDelQueFalto}`,
  ];

  for (const mensaje of MENSAJES) {
    it(`«${mensaje}»`, async () => {
      dobleQueFalla(400, mensaje);

      const { result } = montar(() => usePasarLista('t1'));
      result.current.mutate([]);
      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe(mensaje);
    });
  }
});

// ---------------------------------------------------------------------------
// Ruta Y metodo, los tres endpoints
// ---------------------------------------------------------------------------

describe('los tres endpoints', () => {
  it('cada endpoint pide SU ruta, con SU metodo', async () => {
    // Las tres rutas salen del `@Controller('mis-clases')`, leidas una por
    // una. Ruta Y metodo: un `GET` a la ruta de la asistencia es un 404, y un
    // `POST` a la de los alumnos tambien.
    const doble = dobleDeFetch(ALUMNOS);

    const agenda = montar(() => useMisClases(RANGO));
    await waitFor(() => expect(agenda.result.current.isSuccess).toBe(true));

    const lista = montar(() => useAlumnosDeLaClase('t1'));
    await waitFor(() => expect(lista.result.current.isSuccess).toBe(true));

    const paso = montar(() => usePasarLista('t1'));
    paso.result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(paso.result.current.isSuccess).toBe(true));

    expect(llamada(doble, 0)).toEqual({ url: RUTA_AGENDA, metodo: 'GET', cuerpo: undefined });
    expect(llamada(doble, 1)).toEqual({
      url: '/api/bx/mis-clases/t1/alumnos',
      metodo: 'GET',
      cuerpo: undefined,
    });
    expect(llamada(doble, 2)).toEqual({
      url: '/api/bx/mis-clases/t1/asistencia',
      metodo: 'POST',
      cuerpo: { presentes: [PERFIL_PRESENTE] },
    });

    // `toHaveBeenCalledWith` nunca pregunta cuantas veces. Tres endpoints,
    // tres peticiones: ni un refetch de mas ni una cuarta llamada a nadie.
    expect(doble).toHaveBeenCalledTimes(3);
  });

  it('la agenda es UNA sola peticion', async () => {
    const doble = dobleDeFetch([CLASE]);

    const { result } = montar(() => useMisClases(RANGO));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('los alumnos son UNA sola peticion', async () => {
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => useAlumnosDeLaClase('t1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('pasar lista es UNA sola peticion', async () => {
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('sin clase elegida no se pide nada', async () => {
    // `/mis-clases//alumnos` no empareja con ninguna ruta: la profesora veria
    // un error rojo antes de haber tocado nada.
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => useAlumnosDeLaClase(''));
    await Promise.resolve().then().then().then();

    expect(result.current.fetchStatus).toBe('idle');
    expect(doble).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Las claves: dos clases son dos datos
// ---------------------------------------------------------------------------

describe('las claves de los alumnos', () => {
  it('los alumnos de dos clases distintas tienen claves distintas', async () => {
    // Con una sola clase sembrada no se distingue nada: una cache que guardara
    // TODAS las listas bajo `['mis-clases', 'alumnos']` se veria exactamente
    // igual. Hacen falta dos, en el MISMO `QueryClient`, y con respuestas
    // distintas.
    const OTROS = [{ perfilId: 'perfil-de-otra-clase', nombreCompleto: 'Otra', asistio: null }];
    const doble = dobleQueDistingue({
      '/api/bx/mis-clases/t1/alumnos': ALUMNOS,
      '/api/bx/mis-clases/t2/alumnos': OTROS,
    });

    const { result, cliente } = montar(() => ({
      una: useAlumnosDeLaClase('t1'),
      otra: useAlumnosDeLaClase('t2'),
    }));
    await waitFor(() => {
      expect(result.current.una.isSuccess).toBe(true);
      expect(result.current.otra.isSuccess).toBe(true);
    });

    expect(clavesDeMisClases.alumnos('t1')).not.toEqual(clavesDeMisClases.alumnos('t2'));

    // Las dos salieron a la red: con una clave compartida, la segunda habria
    // leido la respuesta de la primera y no habria segunda peticion.
    expect(doble).toHaveBeenCalledTimes(2);
    expect(cacheDeConsultas(cliente).entradas).toBe(2);

    // Y cada una tiene LO SUYO. Esta es la afirmacion que importa: una clave
    // compartida le mostraria a la profesora los alumnos de la clase anterior
    // sobre la que esta mirando, con sus nombres y sus ausencias.
    expect(result.current.una.data).toEqual(ALUMNOS);
    expect(result.current.otra.data).toEqual(OTROS);
  });

  it('dos rangos de agenda tampoco comparten clave', async () => {
    const OTRA = [{ ...CLASE, turnoId: 't9' }];
    const doble = dobleQueDistingue({
      [RUTA_AGENDA]: [CLASE],
      '/api/bx/mis-clases?desde=2026-11-01&hasta=2026-11-30': OTRA,
    });

    const { result, cliente } = montar(() => ({
      octubre: useMisClases(RANGO),
      noviembre: useMisClases({ desde: '2026-11-01', hasta: '2026-11-30' }),
    }));
    await waitFor(() => {
      expect(result.current.octubre.isSuccess).toBe(true);
      expect(result.current.noviembre.isSuccess).toBe(true);
    });

    expect(doble).toHaveBeenCalledTimes(2);
    expect(cacheDeConsultas(cliente).entradas).toBe(2);
    expect(result.current.octubre.data).toEqual([CLASE]);
    expect(result.current.noviembre.data).toEqual(OTRA);
  });
});

// ---------------------------------------------------------------------------
// El cuerpo de la asistencia
// ---------------------------------------------------------------------------

describe('el cuerpo de la asistencia', () => {
  it('el cuerpo de la asistencia lleva `presentes` y NADA mas', async () => {
    // `PasarListaDto` declara UN campo y la API corre con
    // `forbidNonWhitelisted`: un `turnoId` de adorno —que el hook tiene en la
    // mano, porque lo necesita para la URL— convierte una lista valida en un
    // 400.
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(Object.keys(cuerpo), 'el cuerpo lleva campos de mas').toEqual(['presentes']);
    expect(cuerpo.presentes).toEqual([PERFIL_PRESENTE]);
  });

  it('una lista vacia se manda como lista vacia, no se omite', async () => {
    // Marcar ausente a TODA la clase es un caso legitimo del servicio: tiene
    // una rama propia que evita generar un `notIn: []`. Omitir la clave seria
    // un 400 de `@IsArray()` sobre un `undefined`, y nadie sabria por que:
    // la profesora SI hizo algo, y la pantalla le diria que mando mal el
    // formulario.
    const doble = dobleDeFetch([]);

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cuerpo = llamada(doble).cuerpo as Record<string, unknown>;
    expect(cuerpo).toEqual({ presentes: [] });

    // Y la clave ESTA, que es distinto de valer `undefined`: `JSON.stringify`
    // borra las claves con `undefined` y el cuerpo saldria `{}`.
    expect(Object.keys(cuerpo), 'la lista vacia desaparecio del cuerpo').toContain('presentes');
  });

  it('los presentes viajan tal cual, sin ordenar ni deduplicar', async () => {
    // `@ArrayUnique()` esta en el DTO: un duplicado es un 400 que la pantalla
    // tiene que poder ver. Un `new Set(...)` aqui lo taparia, y con el taparia
    // el bug de la pantalla que marco dos veces al mismo alumno.
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([CENTINELAS.perfilDelQueFalto, PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect((llamada(doble).cuerpo as Record<string, unknown>).presentes).toEqual([
      CENTINELAS.perfilDelQueFalto,
      PERFIL_PRESENTE,
    ]);
  });

  it('el turnoId va en la URL y el cuerpo no lo repite', async () => {
    const doble = dobleDeFetch(ALUMNOS);

    const { result } = montar(() => usePasarLista('t-raro-9'));
    result.current.mutate([]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/mis-clases/t-raro-9/asistencia');
    expect(JSON.stringify(llamada(doble).cuerpo)).not.toContain('t-raro-9');
  });

  it('la lista ya marcada vuelve en la respuesta del POST', async () => {
    // El `POST` NO es un 204: `pasarLista` del service termina con
    // `listaDeAlumnos(...)` y el controller lo declara `AlumnoEnClase[]`. Si
    // el hook esperara `null`, la pantalla tiraria lo unico que le llega al
    // instante.
    dobleDeFetch(ALUMNOS);

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(ALUMNOS);
  });
});

// ---------------------------------------------------------------------------
// Invalidacion: dirigida, y nada mas
// ---------------------------------------------------------------------------

describe('invalidacion tras pasar lista', () => {
  it('pasar lista invalida los alumnos de ESA clase y la agenda, y nada mas', async () => {
    dobleDeFetch(ALUMNOS);

    const { result, cliente } = montar(() => usePasarLista('t1'));

    // Tres consultas sembradas: la lista de ESTA clase, la de OTRA clase
    // abierta, y una agenda de un rango cualquiera.
    cliente.setQueryData(clavesDeMisClases.alumnos('t1'), ALUMNOS);
    cliente.setQueryData(clavesDeMisClases.alumnos('t2'), []);
    cliente.setQueryData(clavesDeMisClases.agenda(RANGO), [CLASE]);

    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await Promise.resolve().then().then().then();

    expect(espia).toHaveBeenCalledWith({ queryKey: ['mis-clases', 'alumnos', 't1'] });
    expect(espia).toHaveBeenCalledWith({ queryKey: ['mis-clases', 'agenda'] });

    // DOS, y por eso «y nada mas»: `toHaveBeenCalledWith` nunca pregunta con
    // que MAS se llamo. Un tercer `invalidateQueries()` pelado pasaria las dos
    // afirmaciones de arriba sin despeinarse.
    expect(
      espia,
      'se invalido algo mas que los alumnos de la clase y la agenda',
    ).toHaveBeenCalledTimes(2);

    const estado = (clave: readonly unknown[]) =>
      cliente.getQueryCache().find({ queryKey: clave })?.state.isInvalidated;

    // EL INSTRUMENTO, ANTES DEL VEREDICTO: si las sembradas no estuvieran, los
    // `toBe(false)` de abajo no podrian fallar nunca.
    for (const clave of [
      clavesDeMisClases.alumnos('t1'),
      clavesDeMisClases.alumnos('t2'),
      clavesDeMisClases.agenda(RANGO),
    ]) {
      expect(
        cliente.getQueryCache().find({ queryKey: clave }),
        `la consulta sembrada ${JSON.stringify(clave)} no esta: el test no mide nada`,
      ).toBeDefined();
    }

    expect(estado(clavesDeMisClases.alumnos('t1'))).toBe(true);

    // LA AGENDA, POR LA RAMA Y NO POR EL RANGO. El hook no sabe que rangos hay
    // cacheados, asi que invalida `['mis-clases', 'agenda']` y el emparejado
    // por prefijo alcanza este.
    expect(estado(clavesDeMisClases.agenda(RANGO))).toBe(true);

    // Y LA OTRA CLASE NO SE MOVIO. Esta es la que cae con la clave compartida
    // y con el `invalidateQueries()` pelado, y la que ningun test de ruta, de
    // metodo ni de cuerpo nota.
    expect(
      estado(clavesDeMisClases.alumnos('t2')),
      'pasar lista en una clase marco rancios los alumnos de OTRA',
    ).toBe(false);
  });

  it('pasar lista no refresca consultas ajenas', async () => {
    // Con un solo consumidor del `QueryClient`, una invalidacion dirigida y
    // una global son indistinguibles. Ver `src/test/consulta-ajena.ts`.
    dobleDeFetch(ALUMNOS);

    const { result, cliente } = montar(() => usePasarLista('t1'));
    const sinTocarLoAjeno = vigilarUnaConsultaAjena(cliente);

    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    await sinTocarLoAjeno();
  });

  it('una lista vacia invalida igual', async () => {
    // El camino de "no vino nadie" es el que mas cambia la pantalla: TODA la
    // clase pasa de `null` a `false`. Si la rama vacia se saltara la
    // invalidacion, la agenda seguiria diciendo que falta pasar lista.
    dobleDeFetch([]);

    const { result, cliente } = montar(() => usePasarLista('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate([]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(espia).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// El camino de error
// ---------------------------------------------------------------------------

/**
 * Los conteos de arriba corren todos sobre un 200, y `retry` SOLO actua al
 * fallar: sobre un 200 no llega a haber reintento que contar. Por eso el unico
 * sitio donde se ve si una escritura se reintenta es este, y hay que esperar a
 * que el error este PINTADO antes de contar: contando antes se veria uno
 * aunque hubiera tres.
 *
 * Aqui un reintento no es cosmetico, pero tampoco duplica filas: pasar lista
 * es idempotente a proposito. Lo que duplica es el `historial_acciones`
 * —`ASISTENCIA_REGISTRADA` dos veces por una sola pulsacion— que es el rastro
 * con el que se audita quien marco ausente a quien.
 */
describe('una escritura que falla sale UNA sola vez', () => {
  it('pasar lista', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(400, 'Esa clase todavia no empezo');

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble, 'el POST se reintento: el historial quedaria duplicado').toHaveBeenCalledTimes(1);
  });

  it('con la lista vacia tampoco se reintenta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(400, 'Esa clase todavia no empezo');

    const { result } = montar(() => usePasarLista('t1'));
    result.current.mutate([]);
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un fallo no invalida nada', async () => {
    dobleQueFalla(400, 'Esa clase todavia no empezo');

    const { result, cliente } = montar(() => usePasarLista('t1'));
    const espia = vi.spyOn(cliente, 'invalidateQueries');

    result.current.mutate([PERFIL_PRESENTE]);
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(espia).not.toHaveBeenCalled();
  });

  it('una lectura que falla tampoco se reintenta', { timeout: 20_000 }, async () => {
    const doble = dobleQueFalla(404, 'Ese turno no es tuyo');

    const { result } = montar(() => useAlumnosDeLaClase('t1'));
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });
});
