import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type {
  CajaDelMes,
  ComposicionAlumnos,
  Operativo,
  PagoPendiente,
  ReporteAsistencia,
  ReporteTurnosLibres,
} from '@boxadmin/shared';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { cacheDeConsultas, llamada, montar } from '@/test/andamiaje-de-hooks';
import {
  clavesDeStats,
  queryDeAsistencia,
  queryDeMes,
  queryDeOperativo,
  queryDeTurnosLibres,
  useAsistencia,
  useCaja,
  useComposicionAlumnos,
  useOperativo,
  usePagosPendientes,
  useTurnosLibres,
} from './use-stats';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Los fijos
// ---------------------------------------------------------------------------

/**
 * LOS FIJOS NO CUADRAN, Y ESO ES EXACTAMENTE LO QUE LOS HACE SERVIR.
 *
 * Estos seis contratos estan llenos de campos DERIVADOS: `Porcentaje` trae
 * `numerador`, `denominador` y `porcentaje`; `Importe` trae `centavos` y
 * `texto`; `CajaDelMes` trae `margen` y ademas sus sumandos. Con un fijo
 * coherente —`{ numerador: 3, denominador: 4, porcentaje: 75 }`— ninguna
 * afirmacion puede decir QUIEN calculo ese 75: sale igual si lo mando el
 * servidor que si lo invento el cliente. Con `porcentaje: 99` sobre 3 de 4, si.
 *
 * Por eso aqui el porcentaje no es la fraccion, el `texto` no son los
 * `centavos` y el `margen` no es la resta. El servidor es quien calcula; este
 * paquete solo transporta, y un fijo incoherente es el unico que lo demuestra.
 *
 * Y por el mismo motivo los dos campos RECORTADOS vuelven distintos de lo que
 * se pidio: `turnosLibres` se pide con 24 meses y la respuesta dice 12
 * —`MAX_MESES_ADELANTE`—, y la asistencia se pide hasta el 2028-12-31 y la
 * respuesta dice 2027-03-01 —`MAX_DIAS_DE_RANGO`, 366 dias contando el
 * primero—. Los dos recortes son los que el service aplica de verdad: un
 * recorte inventado seria un fijo que la API no puede devolver, y entonces el
 * fijo volveria a hablar un idioma que no es el del contrato. Un
 * fijo que repitiera el argumento no distinguiria entre pintar la respuesta y
 * pintar lo que uno mismo mando — la quinta forma de que un test no pueda
 * fallar: que el fijo hable el idioma del codigo en vez del contrato.
 *
 * SI LAS TASKS 2 A 6 REUSAN ESTAS FORMAS, QUE REUSEN TAMBIEN ESTA PROPIEDAD.
 * Un fijo "limpio" en la pantalla del operativo convierte en decorativa
 * cualquier afirmacion sobre los cinco porcentajes.
 */

const MES = { anio: 2026, mes: 3 };

/** El rango PEDIDO. Ojo: la respuesta trae otro `hasta`, ya recortado. */
const RANGO = { desde: '2026-03-01', hasta: '2028-12-31' };

const CAJA: CajaDelMes = {
  anio: 2026,
  mes: 3,
  // `texto` y `centavos` no concuerdan a proposito: el que se pinte delata
  // cual de los dos leyo la pantalla.
  cobrado: { centavos: 500000, texto: '1111.11' },
  porMetodo: [
    { metodo: 'EFECTIVO', importe: { centavos: 300000, texto: '2222.22' } },
    { metodo: 'CORTESIA', importe: { centavos: 0, texto: '3333.33' } },
  ],
  bonificado: { centavos: 12345, texto: '4444.44' },
  costoProfesoras: { centavos: 200000, texto: '5555.55' },
  // NO es `cobrado - costoProfesoras`: si alguna pantalla hace la resta, se ve.
  margen: { centavos: 777777, texto: '6666.66' },
  pendienteEstimado: { centavos: 99999, texto: '7777.77' },
};

const OPERATIVO: Operativo = {
  actual: {
    anio: 2026,
    mes: 3,
    // 3 de 4 NO es 99%. El servidor manda el 99 y el 99 es el que vale.
    ocupacion: { numerador: 3, denominador: 4, porcentaje: 99 },
    asistencia: { numerador: 7, denominador: 10, porcentaje: 98 },
    cobranza: { numerador: 1, denominador: 2, porcentaje: 97 },
    cancelacionRecuperable: { numerador: 2, denominador: 8, porcentaje: 96 },
    // El unico coherente de los cinco, y por una razon: `denominador: 0`
    // significa "la pregunta no se puede contestar", y entonces el contrato
    // obliga a `porcentaje: null`. Inventarle un numero aqui seria sembrar un
    // caso que la API no puede devolver.
    cancelacionDefinitiva: { numerador: 0, denominador: 0, porcentaje: null },
  },
  trimestre: [
    {
      anio: 2025,
      mes: 12,
      ocupacion: { numerador: 1, denominador: 3, porcentaje: 95 },
      asistencia: { numerador: 1, denominador: 3, porcentaje: 94 },
      cobranza: { numerador: 1, denominador: 3, porcentaje: 93 },
      cancelacionRecuperable: { numerador: 1, denominador: 3, porcentaje: 92 },
      cancelacionDefinitiva: { numerador: 1, denominador: 3, porcentaje: 91 },
    },
  ],
};

const COMPOSICION: ComposicionAlumnos = {
  anio: 2026,
  mes: 3,
  totalAlumnos: 10,
  // 4 de 10 no es 88%, y los dos packs no suman 100: lo que mande el servidor.
  porPack: [
    { packId: 'pk1', packNombre: 'Pack-Marcador-Composicion', alumnos: 4, porcentaje: 88 },
    { packId: null, packNombre: 'Sin pack', alumnos: 6, porcentaje: 77 },
  ],
  consumo: [{ perfilId: 'pf1', nombreCompleto: 'Mora-Marcador-Composicion', clasesTomadas: 9 }],
};

const ASISTENCIA: ReporteAsistencia = {
  desde: '2026-03-01',
  // RECORTADO: se pidio hasta el 2028-12-31 y el service corta en 366 dias
  // contando el primero (`MAX_DIAS_DE_RANGO`), que desde el 2026-03-01 cae
  // justo en el 2027-03-01.
  hasta: '2027-03-01',
  alumnos: [
    {
      perfilId: 'pf2',
      nombreCompleto: 'Lucia-Marcador-Asistencia',
      presentes: 1,
      ausentes: 1,
      // 1 de 2 no es 66.
      porcentaje: 66,
    },
    {
      perfilId: 'pf3',
      nombreCompleto: 'Nadie-Le-Paso-Lista',
      presentes: 0,
      ausentes: 0,
      /** Sin lista pasada ni una vez: `null`, que no es lo mismo que 0. */
      porcentaje: null,
    },
  ],
};

const PAGOS: PagoPendiente[] = [
  {
    perfilId: 'pf4',
    nombreCompleto: 'Valentina-Marcador-Pagos',
    email: 'valentina.marcador@ejemplo.test',
    packNombre: 'Pack Mensual',
    pendienteEstimado: { centavos: 450000, texto: '8888.88' },
    cancelacionesDelMes: 2,
  },
];

const TURNOS_LIBRES: ReporteTurnosLibres = {
  // RECORTADO: se piden 24 y el service mira 12 (`MAX_MESES_ADELANTE`) y lo
  // dice. Sigue sin ser el argumento, que es lo que la prueba necesita.
  mesesAdelante: 12,
  turnos: [
    {
      turnoId: 't1',
      salaId: 's1',
      salaNombre: 'Sala-Marcador-TurnosLibres',
      fecha: '2026-03-10',
      horaInicio: '09:00',
      horaFin: '10:00',
      cupo: 10,
      reservados: 3,
      // No es `cupo - reservados`: si alguien resta en vez de leer, se ve.
      libres: 5,
    },
  ],
};

/**
 * Lo sensible que siembra este spec, para los cinco canales globales.
 *
 * Esta fase siembra mas datos delicados que ninguna: quien no pago, su correo,
 * cuanto debe, el margen del salon y lo que cuestan las profesoras. Los
 * centinelas no cubren lo que no se les registra.
 */
vigilarEstosDatos({
  quienNoPago: PAGOS[0]?.nombreCompleto ?? '',
  correoDeQuienNoPago: PAGOS[0]?.email ?? '',
  loQueDebe: PAGOS[0]?.pendienteEstimado.texto ?? '',
  margenDelSalon: CAJA.margen.texto,
  costoDeLasProfesoras: CAJA.costoProfesoras.texto,
  alumnaDeLaAsistencia: ASISTENCIA.alumnos[0]?.nombreCompleto ?? '',
});

/**
 * Un `fetch` que contesta SEGUN LA RUTA, para montar los seis a la vez.
 *
 * El `dobleDeFetch` del andamiaje contesta lo mismo a todo, y con lo mismo en
 * las seis respuestas la prueba de "cada reporte tiene su propia clave" no
 * podria distinguir una colision: seis copias del mismo dato se ven igual
 * esten donde esten. Lo que falta no es otro `montar` ni otra `llamada` —esos
 * se usan tal cual—, es que cada ruta traiga lo suyo.
 */
function doblePorRuta(porRuta: Record<string, unknown>) {
  const doble = vi.fn().mockImplementation((url: string) => {
    const entrada = Object.entries(porRuta).find(([ruta]) => url.startsWith(`/api/bx${ruta}`));
    if (entrada === undefined) throw new Error(`El doble no esperaba esta ruta: ${url}`);

    return Promise.resolve(
      new Response(JSON.stringify(entrada[1]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
  vi.stubGlobal('fetch', doble);
  return doble;
}

/** Las seis rutas con su respuesta, tal como las devuelve la API. */
const LAS_SEIS = {
  '/stats/caja': CAJA,
  '/stats/operativo': OPERATIVO,
  '/stats/composicion-alumnos': COMPOSICION,
  '/stats/asistencia': ASISTENCIA,
  '/stats/pagos-pendientes': PAGOS,
  '/stats/turnos-libres': TURNOS_LIBRES,
};

/** Monta los seis reportes sobre UN solo cliente, que es donde chocarian. */
function montarLosSeis() {
  return montar(() => ({
    caja: useCaja(MES),
    operativo: useOperativo(MES),
    composicion: useComposicionAlumnos(MES),
    asistencia: useAsistencia(RANGO),
    pagos: usePagosPendientes(),
    turnos: useTurnosLibres(undefined, 24),
  }));
}

/** La url de la peticion que pidio esa ruta, buscada entre todas las que hubo. */
function urlDe(doble: ReturnType<typeof doblePorRuta>, ruta: string): string {
  const todas = doble.mock.calls.map((_, indice) => llamada(doble, indice));
  const suyas = todas.filter((una) => una.url.startsWith(`/api/bx${ruta}`));
  if (suyas.length !== 1) {
    throw new Error(`${ruta} se pidio ${suyas.length} veces, no una`);
  }

  return suyas[0]?.url ?? '';
}

// ---------------------------------------------------------------------------
// Las funciones que arman el query
// ---------------------------------------------------------------------------

describe('queryDeMes', () => {
  it('el mes viaja siempre, tambien cuando es enero', () => {
    // El 1 por si mismo no prueba gran cosa; el 0 si. Una rama `if (m.mes)` o
    // un `m.mes || ...` dejan pasar enero y borran el cero, y el query que
    // sale —`?anio=2026`— ya no es el mes que pidieron: es un 400 convertido
    // en silencio, o peor, otro mes.
    expect(queryDeMes({ anio: 2026, mes: 1 })).toBe('?anio=2026&mes=1');
    expect(queryDeMes({ anio: 2026, mes: 10 })).toBe('?anio=2026&mes=10');
    expect(queryDeMes({ anio: 2026, mes: 0 })).toBe('?anio=2026&mes=0');
    expect(queryDeMes({ anio: 0, mes: 3 })).toBe('?anio=0&mes=3');
  });

  it('enero es `mes=1` y no `mes=01`', () => {
    // `@Type(() => Number)` convierte igual, pero la clave del cache del
    // service se arma con el texto: dos escrituras del mismo mes serian dos
    // entradas distintas en Redis.
    expect(queryDeMes({ anio: 2026, mes: 1 })).not.toContain('mes=01');
  });
});

describe('queryDeOperativo', () => {
  it('un salaId vacio NO se manda, uno con valor SI', () => {
    // `?salaId=` no es "todas las salas": para el service es una sala cuyo id
    // es la cadena vacia, y el reporte volveria en cero. La recepcion leeria
    // "no vino nadie" sobre un mes lleno.
    expect(queryDeOperativo(MES, '')).toBe('?anio=2026&mes=3');
    expect(queryDeOperativo(MES)).toBe('?anio=2026&mes=3');
    expect(queryDeOperativo(MES, 's1')).toBe('?anio=2026&mes=3&salaId=s1');
  });

  it('el mes no se pierde cuando hay sala', () => {
    expect(queryDeOperativo({ anio: 2026, mes: 1 }, 's1')).toBe('?anio=2026&mes=1&salaId=s1');
  });

  it('escapa lo que haga falta', () => {
    expect(queryDeOperativo(MES, 'a b&c')).toBe('?anio=2026&mes=3&salaId=a+b%26c');
  });
});

describe('queryDeAsistencia', () => {
  it('desde y hasta viajan siempre; el perfilId solo si esta', () => {
    // Los dos son obligatorios en `ConsultaRangoDto`: omitir uno no pide "todo
    // el historial", es un 400. El `perfilId` es el opcional de verdad.
    expect(queryDeAsistencia({ desde: '2026-03-01', hasta: '2026-03-31' })).toBe(
      '?desde=2026-03-01&hasta=2026-03-31',
    );
    expect(queryDeAsistencia({ desde: '2026-03-01', hasta: '2026-03-31', perfilId: '' })).toBe(
      '?desde=2026-03-01&hasta=2026-03-31',
    );
    expect(queryDeAsistencia({ desde: '2026-03-01', hasta: '2026-03-31', perfilId: 'pf1' })).toBe(
      '?desde=2026-03-01&hasta=2026-03-31&perfilId=pf1',
    );
  });

  it('un rango invertido se manda tal cual', () => {
    // Quien lo rechaza es el service, con su caso propio. Arreglarlo aqui
    // —dando vuelta las fechas— mostraria un rango que nadie pidio.
    expect(queryDeAsistencia({ desde: '2026-03-31', hasta: '2026-03-01' })).toBe(
      '?desde=2026-03-31&hasta=2026-03-01',
    );
  });
});

describe('queryDeTurnosLibres', () => {
  it('sin nada no manda query', () => {
    expect(queryDeTurnosLibres()).toBe('');
    expect(queryDeTurnosLibres('')).toBe('');
  });

  it('un salaId vacio NO se manda, uno con valor SI', () => {
    expect(queryDeTurnosLibres('s1')).toBe('?salaId=s1');
  });

  it('un `mesesAdelante` en CERO viaja igual', () => {
    // `@Min(1)`: el cero es un 400 explicito. Borrarlo por ser falsy devolveria
    // el reporte por defecto —varios meses de turnos— a quien pidio cero, y
    // esa lista llena se lee como si fuera la respuesta a su pedido.
    expect(queryDeTurnosLibres(undefined, 0)).toBe('?mesesAdelante=0');
    expect(queryDeTurnosLibres('s1', 0)).toBe('?salaId=s1&mesesAdelante=0');
  });

  it('los dos juntos, en orden', () => {
    expect(queryDeTurnosLibres('s1', 3)).toBe('?salaId=s1&mesesAdelante=3');
  });
});

// ---------------------------------------------------------------------------
// Ruta Y metodo, los dos
// ---------------------------------------------------------------------------

describe('las seis peticiones', () => {
  it('cada reporte pide SU ruta, con metodo GET', async () => {
    // Las seis rutas salen del `@Controller('stats')`, verificadas una por
    // una. Un `/stats/composicion` a secas es un 404, y `/estadisticas`
    // tambien.
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montarLosSeis();
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(urlDe(doble, '/stats/caja')).toBe('/api/bx/stats/caja?anio=2026&mes=3');
    expect(urlDe(doble, '/stats/operativo')).toBe('/api/bx/stats/operativo?anio=2026&mes=3');
    expect(urlDe(doble, '/stats/composicion-alumnos')).toBe(
      '/api/bx/stats/composicion-alumnos?anio=2026&mes=3',
    );
    expect(urlDe(doble, '/stats/asistencia')).toBe(
      '/api/bx/stats/asistencia?desde=2026-03-01&hasta=2028-12-31',
    );
    expect(urlDe(doble, '/stats/pagos-pendientes')).toBe('/api/bx/stats/pagos-pendientes');
    expect(urlDe(doble, '/stats/turnos-libres')).toBe(
      '/api/bx/stats/turnos-libres?mesesAdelante=24',
    );

    for (let indice = 0; indice < doble.mock.calls.length; indice += 1) {
      expect(llamada(doble, indice).metodo).toBe('GET');
    }
  });

  it('son SEIS peticiones y ni una mas', async () => {
    // `toHaveBeenCalledWith` no pregunta cuantas veces. Una lectura de mas no
    // cambia un nodo ni manda un cuerpo: solo se ve contando.
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montarLosSeis();
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(doble).toHaveBeenCalledTimes(6);
  });

  it('ninguna lleva cuerpo', async () => {
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montarLosSeis();
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    for (let indice = 0; indice < 6; indice += 1) {
      expect(llamada(doble, indice).cuerpo).toBeUndefined();
    }
  });

  it('pagos-pendientes se pide SIN ningun parametro', async () => {
    // Su DTO esta VACIO a proposito, para que el ValidationPipe conteste 400
    // ante un `?salaId=` en vez de ignorarlo en silencio. Un filtro agregado
    // aqui —"por comodidad"— rompe esa decision desde el otro lado del cable:
    // la peticion entera se cae con 400 y la lista de morosos no se ve.
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montar(() => usePagosPendientes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe('/api/bx/stats/pagos-pendientes');
    expect(llamada(doble).url, 'le colgaron una query a un DTO vacio: es un 400').not.toContain(
      '?',
    );
    expect(llamada(doble).metodo).toBe('GET');
    expect(doble).toHaveBeenCalledTimes(1);
  });

  it('un salaId con valor SI llega a la peticion', async () => {
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montar(() => ({
      operativo: useOperativo(MES, 's1'),
      turnos: useTurnosLibres('s1', 3),
    }));
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(urlDe(doble, '/stats/operativo')).toBe(
      '/api/bx/stats/operativo?anio=2026&mes=3&salaId=s1',
    );
    expect(urlDe(doble, '/stats/turnos-libres')).toBe(
      '/api/bx/stats/turnos-libres?salaId=s1&mesesAdelante=3',
    );
  });

  it('un salaId vacio NO llega a la peticion', async () => {
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montar(() => ({
      operativo: useOperativo(MES, ''),
      turnos: useTurnosLibres('', undefined),
    }));
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(urlDe(doble, '/stats/operativo')).toBe('/api/bx/stats/operativo?anio=2026&mes=3');
    expect(urlDe(doble, '/stats/turnos-libres')).toBe('/api/bx/stats/turnos-libres');
  });

  it('el perfilId viaja en la asistencia cuando lo hay', async () => {
    const doble = doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useAsistencia({ ...RANGO, perfilId: 'pf2' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(llamada(doble).url).toBe(
      '/api/bx/stats/asistencia?desde=2026-03-01&hasta=2028-12-31&perfilId=pf2',
    );
  });
});

// ---------------------------------------------------------------------------
// Las claves: seis reportes, seis sitios en la cache
// ---------------------------------------------------------------------------

describe('las claves de cache', () => {
  it('cada reporte tiene su propia clave de cache', () => {
    // Dos reportes bajo la misma clave se pisan, y el segundo en llegar
    // muestra los numeros del primero. Se afirma sobre las SEIS: con una sola
    // comparacion, cinco colisiones pasan.
    const claves = [
      clavesDeStats.caja(MES),
      clavesDeStats.operativo(MES),
      clavesDeStats.composicion(MES),
      clavesDeStats.asistencia(RANGO),
      clavesDeStats.pagosPendientes(),
      clavesDeStats.turnosLibres(),
    ].map((clave) => JSON.stringify(clave));

    expect(new Set(claves).size, `dos reportes comparten clave: ${claves.join(' / ')}`).toBe(6);
  });

  it('las seis claves son las escritas, no las que devuelva la funcion', () => {
    // Literales a mano y no derivadas de `clavesDeStats`: comparar la salida
    // contra la misma funcion que la produce no prueba nada.
    expect(clavesDeStats.caja(MES)).toEqual(['stats', 'caja', { anio: 2026, mes: 3 }]);
    expect(clavesDeStats.operativo(MES)).toEqual([
      'stats',
      'operativo',
      { anio: 2026, mes: 3 },
      null,
    ]);
    expect(clavesDeStats.operativo(MES, 's1')).toEqual([
      'stats',
      'operativo',
      { anio: 2026, mes: 3 },
      's1',
    ]);
    expect(clavesDeStats.composicion(MES)).toEqual([
      'stats',
      'composicion',
      { anio: 2026, mes: 3 },
    ]);
    expect(clavesDeStats.asistencia(RANGO)).toEqual([
      'stats',
      'asistencia',
      '2026-03-01',
      '2028-12-31',
      null,
    ]);
    expect(clavesDeStats.pagosPendientes()).toEqual(['stats', 'pagos-pendientes']);
    expect(clavesDeStats.turnosLibres()).toEqual(['stats', 'turnos-libres', null, null]);
    expect(clavesDeStats.turnosLibres('s1', 3)).toEqual(['stats', 'turnos-libres', 's1', 3]);
  });

  it('cada respuesta queda bajo SU clave y no bajo la del vecino', async () => {
    // La otra mitad del caso anterior: las claves pueden ser distintas y el
    // hook guardar bajo la que no es. Se mira la cache de verdad, con seis
    // respuestas distintas entre si.
    const doble = doblePorRuta(LAS_SEIS);

    const { result, cliente } = montarLosSeis();
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(cacheDeConsultas(cliente).entradas, 'seis reportes no dejaron seis entradas').toBe(6);
    expect(cliente.getQueryData(clavesDeStats.caja(MES))).toEqual(CAJA);
    expect(cliente.getQueryData(clavesDeStats.operativo(MES))).toEqual(OPERATIVO);
    expect(cliente.getQueryData(clavesDeStats.composicion(MES))).toEqual(COMPOSICION);
    expect(cliente.getQueryData(clavesDeStats.asistencia(RANGO))).toEqual(ASISTENCIA);
    expect(cliente.getQueryData(clavesDeStats.pagosPendientes())).toEqual(PAGOS);
    expect(cliente.getQueryData(clavesDeStats.turnosLibres(undefined, 24))).toEqual(TURNOS_LIBRES);

    expect(doble).toHaveBeenCalledTimes(6);
  });

  it('cambiar de mes es otra clave, no la misma consulta', async () => {
    // Si la clave ignorara el mes, el segundo mes se serviria de la cache del
    // primero: una sola peticion, una sola entrada, y marzo pintado como si
    // fuera abril.
    const doble = doblePorRuta(LAS_SEIS);

    const { result, cliente } = montar(() => ({
      marzo: useCaja({ anio: 2026, mes: 3 }),
      abril: useCaja({ anio: 2026, mes: 4 }),
      otroAnio: useCaja({ anio: 2027, mes: 3 }),
    }));
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(cacheDeConsultas(cliente).entradas, 'tres meses cayeron en menos de tres claves').toBe(
      3,
    );
    expect(doble).toHaveBeenCalledTimes(3);

    const urls = doble.mock.calls.map((_, indice) => llamada(doble, indice).url);
    expect(new Set(urls).size).toBe(3);
    expect(urls).toContain('/api/bx/stats/caja?anio=2026&mes=3');
    expect(urls).toContain('/api/bx/stats/caja?anio=2026&mes=4');
    expect(urls).toContain('/api/bx/stats/caja?anio=2027&mes=3');
  });

  it('cambiar de sala es otra clave, y la sala vacia es la de "todas"', async () => {
    // `''` y `undefined` son LA MISMA peticion —el `salaId` no viaja en
    // ninguno de los dos casos—, asi que tienen que ser la misma entrada: dos
    // claves para una sola url guardan la misma respuesta dos veces y hacen
    // que elegir "todas las salas" vuelva a pedir lo que ya estaba.
    const doble = doblePorRuta(LAS_SEIS);

    const { result, cliente } = montar(() => ({
      todas: useOperativo(MES),
      tambienTodas: useOperativo(MES, ''),
      sala: useOperativo(MES, 's1'),
    }));
    await waitFor(() => {
      expect(Object.values(result.current).every((consulta) => consulta.isSuccess)).toBe(true);
    });

    expect(cacheDeConsultas(cliente).entradas).toBe(2);
    expect(doble).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// El transporte no calcula: lo derivado llega tal cual
// ---------------------------------------------------------------------------

describe('la respuesta llega entera y sin retocar', () => {
  it('el porcentaje es el del servidor, aunque no cuadre con la fraccion', async () => {
    // 3 de 4 no es 99%, y el 99 es el que manda la API. Un `select` que
    // "arreglara" el porcentaje aqui pasaria todos los tests de ruta y de
    // clave, y la pantalla mostraria un numero que el servidor nunca dijo.
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useOperativo(MES));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(OPERATIVO);
    expect(result.current.data?.actual.ocupacion.porcentaje).toBe(99);
    expect(result.current.data?.actual.cancelacionDefinitiva.porcentaje).toBeNull();
  });

  it('el importe conserva sus dos caras, incoherentes incluidas', async () => {
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useCaja(MES));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(CAJA);
    expect(result.current.data?.margen.texto).toBe('6666.66');
    expect(result.current.data?.margen.centavos).toBe(777777);
  });

  it('el `mesesAdelante` que vale es el de la RESPUESTA, no el que se pidio', async () => {
    // Se piden 24 y la respuesta dice 12: el service recorta y lo cuenta. Si el
    // hook devolviera el argumento, quien pidio dos anos leeria una lista
    // corta como "no hay mas turnos" en vez de "no miramos mas alla".
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useTurnosLibres(undefined, 24));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.mesesAdelante).toBe(12);
    expect(result.current.data?.mesesAdelante, 'devolvio el argumento').not.toBe(24);
  });

  it('el `hasta` que vale es el de la RESPUESTA, no el que se pidio', async () => {
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useAsistencia(RANGO));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.hasta).toBe('2027-03-01');
    expect(result.current.data?.hasta, 'devolvio el argumento').not.toBe(RANGO.hasta);
    expect(result.current.data?.alumnos[1]?.porcentaje).toBeNull();
  });

  it('la lista de morosos llega tal cual, sin ordenar ni filtrar', async () => {
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => usePagosPendientes());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(PAGOS);
  });

  it('la composicion llega tal cual', async () => {
    doblePorRuta(LAS_SEIS);

    const { result } = montar(() => useComposicionAlumnos(MES));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toEqual(COMPOSICION);
  });
});

// ---------------------------------------------------------------------------
// El camino de error
// ---------------------------------------------------------------------------

describe('un reporte que falla', () => {
  it('se pide UNA sola vez: una consulta no se reintenta sola', { timeout: 20_000 }, async () => {
    // Los conteos de arriba corren todos sobre un 200, y sobre un 200 no hay
    // reintento que contar. Un `retry` puesto "por las dudas" aqui no duplica
    // filas —no hay escrituras en esta fase— pero si multiplica por tres el
    // reporte mas caro del sistema contra un 403 que no se va a arreglar solo.
    const doble = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: 'No tenes permiso' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', doble);

    const { result } = montar(() => useCaja(MES));
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 15_000 });

    expect(doble).toHaveBeenCalledTimes(1);
  });
});
