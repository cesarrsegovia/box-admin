import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  Conflicto,
  EstadoPublicacion,
  Exclusion,
  MesCalendarioPublico,
  PlanDeMes,
  ReservaPlanificada,
  RolUsuario,
  SalaPublica,
  TurnoPlanificado,
  UsuarioResumen,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { ESPERA_DEL_SONDEO } from '@/hooks/use-calendario-admin';
import { ProveedorDeRol } from '../rol-del-panel';
import PaginaDeCalendario from './page';

/**
 * LO QUE SE VE UNA VEZ ELEGIDOS SALA Y MES, Y LA ACCION DE PUBLICAR.
 *
 * Va en su propio archivo y no al final de `page.spec` por el reloj: alli se
 * falsea `Date` Y NADA MAS, a proposito, porque `userEvent` y las esperas
 * necesitan temporizadores de verdad. Aqui hace falta justo lo contrario —el
 * sondeo de `useMesDelCalendario` espera tres segundos entre consultas y hay
 * que poder adelantarlos—, asi que se falsean tambien los temporizadores y
 * `userEvent` se monta sabiendolo. Mezclar las dos configuraciones en un mismo
 * archivo deja a la mitad de los tests colgados.
 */

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

const { empujar, reemplazar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  reemplazar: vi.fn(),
  pedirEspia: vi.fn(),
  busqueda: { parametros: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: reemplazar, refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => busqueda.parametros,
  usePathname: () => '/mi-gym/admin/calendario',
  useParams: () => ({ slug: 'mi-gym' }),
}));

vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

const AHORA = new Date(Date.UTC(2026, 9, 15));

/** La ruta del mes elegido en todos los tests de este archivo. */
const RUTA_DEL_MES = '/calendario/s1/2026/11';

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
  });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function unaSala(cambios: Partial<SalaPublica> = {}): SalaPublica {
  return {
    id: 's1',
    tenantId: 't-del-gimnasio',
    nombre: 'Sala Pilates',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: 10,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
    ...cambios,
  };
}

const SALAS: SalaPublica[] = [unaSala()];

/**
 * LOS IDENTIFICADORES DE LOS ALUMNOS, con una forma que se reconoce a simple
 * vista en el marcado.
 *
 * El plan trae las listas completas de turnos y reservas, y cada reserva lleva
 * el `perfilId` de a quien se le va a anotar. La pantalla solo necesita
 * CONTARLAS. Estos centinelas existen para poder afirmar que ninguno de esos
 * identificadores acaba en el DOM: con ids genericos ('p1') el test no podria
 * distinguir el id de un alumno de cualquier otra cosa que diga la pantalla.
 */
const PERFILES = {
  ana: 'perfil-de-ana-7f3c21',
  bruno: 'perfil-de-bruno-9a1d04',
  /**
   * EL QUE LA LISTA NO RESUELVE, y existe por una mutacion que sobrevivio.
   *
   * Con los centinelas probados solo sobre perfiles que SI estan en
   * `/usuarios`, un `nombres.get(id) ?? id` —el "por lo menos que se vea algo"
   * mas razonable del mundo— no pinta nada distinto y pasa en verde. El caso
   * ciego era justo ese: donde todos resuelven, la distincion entre "pinto el
   * nombre" y "pinto el id si no hay nombre" no existe.
   */
  fantasma: 'perfil-que-la-lista-no-trae-4e5f80',
} as const;

function unUsuario(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'u-ana',
    tenantId: 't-del-gimnasio',
    nombreCompleto: 'Ana Perez',
    email: 'ana@ejemplo.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: PERFILES.ana,
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['s1'],
    ...cambios,
  };
}

/**
 * La lista contra la que se resuelven los nombres.
 *
 * Bruno esta DADO DE BAJA a proposito: `GET /usuarios` sin filtros devuelve
 * activos e inactivos, y un conflicto de alguien recien dado de baja sigue
 * siendo un conflicto que hay que resolver.
 */
const USUARIOS: UsuarioResumen[] = [
  unUsuario(),
  unUsuario({
    id: 'u-bruno',
    nombreCompleto: 'Bruno Diaz',
    email: 'bruno@ejemplo.test',
    perfilId: PERFILES.bruno,
    activo: false,
  }),
];

/** `2026-11-01`, `2026-11-02`... Fechas distintas sin cruzar de mes. */
function dia(indice: number): string {
  return `2026-11-${String((indice % 28) + 1).padStart(2, '0')}`;
}

function unConflicto(cambios: Partial<Conflicto> = {}): Conflicto {
  return {
    tipo: 'CUPO_LLENO',
    perfilId: PERFILES.ana,
    fecha: '2026-11-03',
    detalle: 'El turno de las 09:00 esta completo (10/10)',
    ...cambios,
  };
}

function unaExclusion(cambios: Partial<Exclusion> = {}): Exclusion {
  return {
    tipo: 'VACACION_ALUMNO',
    perfilId: PERFILES.bruno,
    fecha: '2026-11-04',
    detalle: 'El alumno esta de vacaciones ese dia',
    ...cambios,
  };
}

function unTurno(cambios: Partial<TurnoPlanificado> = {}): TurnoPlanificado {
  return {
    salaId: 's1',
    nombre: 'Pilates',
    fecha: '2026-11-02',
    horaInicio: '09:00',
    horaFin: '10:00',
    cupo: 10,
    profesorId: null,
    ...cambios,
  };
}

function unaReserva(cambios: Partial<ReservaPlanificada> = {}): ReservaPlanificada {
  return {
    perfilId: PERFILES.ana,
    salaId: 's1',
    fecha: '2026-11-02',
    horaInicio: '09:00',
    ...cambios,
  };
}

function unPlan(cambios: Partial<PlanDeMes> = {}): PlanDeMes {
  return {
    turnosACrear: [],
    reservasACrear: [],
    etiquetasDeProfesor: [],
    conflictos: [],
    exclusiones: [],
    resumen: { turnos: 0, reservas: 0, conflictos: 0, exclusiones: 0 },
    ...cambios,
  };
}

/**
 * Un plan con TANTOS de cada cosa, y el resumen cuadrado con las listas.
 *
 * El resumen sale de contar las listas y no de un numero suelto: un fixture que
 * dijera "2 conflictos" con la lista vacia haria pasar en verde a una pantalla
 * que pinta el numero y se olvida de la lista, o al reves.
 */
function planCon({
  turnos = 0,
  reservas = 0,
  conflictos = 0,
  exclusiones = 0,
}: {
  turnos?: number;
  reservas?: number;
  conflictos?: number;
  exclusiones?: number;
} = {}): PlanDeMes {
  const turnosACrear = Array.from({ length: turnos }, (_, i) => unTurno({ fecha: dia(i) }));
  const reservasACrear = Array.from({ length: reservas }, (_, i) =>
    unaReserva({ fecha: dia(i % 3), perfilId: i % 2 === 0 ? PERFILES.ana : PERFILES.bruno }),
  );
  const losConflictos = Array.from({ length: conflictos }, (_, i) =>
    unConflicto({ fecha: dia(i) }),
  );
  const lasExclusiones = Array.from({ length: exclusiones }, (_, i) =>
    unaExclusion({ fecha: dia(i) }),
  );

  return unPlan({
    turnosACrear,
    reservasACrear,
    conflictos: losConflictos,
    exclusiones: lasExclusiones,
    resumen: {
      turnos: turnosACrear.length,
      reservas: reservasACrear.length,
      conflictos: losConflictos.length,
      exclusiones: lasExclusiones.length,
    },
  });
}

function unTrabajo(cambios: Partial<EstadoPublicacion> = {}): EstadoPublicacion {
  return {
    jobId: 'gen-s1-2026-11-1',
    estado: 'procesando',
    resumen: null,
    error: null,
    ...cambios,
  };
}

function unMes(cambios: Partial<MesCalendarioPublico> = {}): MesCalendarioPublico {
  return {
    id: 'm1',
    tenantId: 't-del-gimnasio',
    salaId: 's1',
    anio: 2026,
    mes: 11,
    estado: 'BORRADOR',
    publicadoEn: null,
    publicadoPor: null,
    publicacion: null,
    ...cambios,
  };
}

const UNA_PUBLICACION = { jobId: 'gen-s1-2026-11-1', salaId: 's1', anio: 2026, mes: 11 };

// ---------------------------------------------------------------------------
// Montaje
// ---------------------------------------------------------------------------

/**
 * Monta la pantalla con la eleccion ya hecha en la URL.
 *
 * `rol` a `null` monta SIN el proveedor —no es "rol desconocido", es que no hay
 * armazon—, que es el caso que tiene que fallar cerrado.
 */
function montar({
  busqueda: textoDeBusqueda = '?salaId=s1&anio=2026&mes=11',
  plan: elPlan = unPlan(),
  mes: elMes = unMes(),
  usuarios = USUARIOS,
  rol = 'ADMIN_SALON' as RolUsuario | null,
  alPublicar,
}: {
  busqueda?: string;
  /** El plan, o una funcion si tiene que cambiar entre una peticion y la que sigue. */
  plan?: PlanDeMes | (() => PlanDeMes);
  /** El mes, o una funcion: el sondeo vuelve a pedirlo y puede traer otra cosa. */
  mes?: MesCalendarioPublico | (() => MesCalendarioPublico);
  usuarios?: UsuarioResumen[];
  rol?: RolUsuario | null;
  /** Que hace el POST de publicar. Es una funcion para poder cambiar de
   *  respuesta entre un intento y el siguiente. */
  alPublicar?: () => Promise<unknown>;
} = {}): QueryClient {
  busqueda.parametros = new URLSearchParams(textoDeBusqueda);

  const plan = typeof elPlan === 'function' ? elPlan : () => elPlan;
  const mes = typeof elMes === 'function' ? elMes : () => elMes;

  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta === '/salas') return Promise.resolve(SALAS);
    if (ruta === '/usuarios') return Promise.resolve(usuarios);
    if (ruta.endsWith('/previsualizar')) return Promise.resolve(plan());
    if (ruta.endsWith('/publicar'))
      return alPublicar === undefined ? Promise.resolve(UNA_PUBLICACION) : alPublicar();
    return Promise.resolve(mes());
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  cliente.setQueryData(clavesDeCatalogos.salas(), SALAS);

  const pantalla = <PaginaDeCalendario />;

  render(
    <QueryClientProvider client={cliente}>
      {rol === null ? pantalla : <ProveedorDeRol rol={rol}>{pantalla}</ProveedorDeRol>}
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas se resuelvan y que React pinte lo que sigue. */
async function esperar(): Promise<void> {
  await act(async () => {
    // Diez vueltas y DE UN MILISEGUNDO, no de cero. Dos motivos:
    //
    //  - Hay cadenas de dos consultas —el plan se pide al montar, y
    //    `/usuarios` recien cuando el plan llego y se pinta la lista—, asi que
    //    hace falta una vuelta por eslabon.
    //  - TanStack agrupa los avisos a los observadores en un temporizador, y
    //    uno programado DURANTE un avance de cero milisegundos no entra en ese
    //    mismo avance: la cache se actualiza y el componente no se repinta. Se
    //    midio: con vueltas de cero, `getQueryData` ya traia los usuarios y el
    //    nombre todavia no estaba en el DOM.
    for (let vuelta = 0; vuelta < 10; vuelta += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }
  });
}

/**
 * Adelanta el reloj y deja que lo que se dispare termine de pintar.
 *
 * El `esperar()` del final no es decoracion: una consulta del sondeo puede
 * provocar un efecto que invalida otra consulta, y esa segunda peticion sale
 * una vuelta despues de que la primera haya pintado.
 */
async function avanzar(milisegundos: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milisegundos);
  });

  await esperar();
}

/**
 * Pulsa un boton con `fireEvent` y NO con `userEvent`.
 *
 * Es la unica concesion que pide el reloj falseado de este archivo: `userEvent`
 * intercala esperas propias entre sus eventos y, con los temporizadores
 * falsos, se queda colgado esperando un `setTimeout` que nadie adelanta —el
 * test muere por timeout sin decir por que—. Aqui no se audita nada del
 * recorrido del puntero: lo que se cuenta son las peticiones que salen al
 * pulsar.
 */
async function pulsar(nombre: RegExp): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

/** Cuantas veces se pidio el estado del mes. Se CUENTA, no se mira si se llamo. */
function cuantasVecesSePidioElMes(): number {
  return pedirEspia.mock.calls.filter(([ruta]) => ruta === RUTA_DEL_MES).length;
}

/** Cuantas previsualizaciones salieron. */
function cuantasPrevisualizaciones(): number {
  return pedirEspia.mock.calls.filter(([ruta]) => ruta === `${RUTA_DEL_MES}/previsualizar`).length;
}

/** Las rutas pedidas, ordenadas y SIN deduplicar: pedir dos veces tambien falla. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string).sort();
}

/** Cuantos POST de publicar salieron. */
function cuantasPublicaciones(): number {
  return pedirEspia.mock.calls.filter(([ruta]) => ruta === `${RUTA_DEL_MES}/publicar`).length;
}

/** Los pares etiqueta/valor del resumen, tal como se leen. */
function resumenEnPantalla(): Record<string, string> {
  const salida: Record<string, string> = {};

  for (const termino of document.querySelectorAll('dl dt')) {
    const valor = termino.nextElementSibling;
    salida[termino.textContent?.trim() ?? ''] = valor?.textContent?.trim() ?? '';
  }

  return salida;
}

/** Todo lo plegable del documento, con su titulo y si arranca abierto. */
function plegables(): { titulo: string; abierto: boolean }[] {
  return [...document.querySelectorAll('details')].map((detalle) => ({
    titulo: detalle.querySelector('summary')?.textContent?.trim() ?? '',
    abierto: detalle.hasAttribute('open'),
  }));
}

/** Los botones del documento, por su texto. */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

// ---------------------------------------------------------------------------
// El estado del mes
// ---------------------------------------------------------------------------

describe('el estado del mes', () => {
  it('dice si esta en BORRADOR o HABILITADO, con quien y cuando', async () => {
    montar({
      mes: unMes({
        estado: 'HABILITADO',
        publicadoEn: '2026-10-20T14:30:00.000Z',
        publicadoPor: 'u-de-la-encargada',
      }),
    });

    await esperar();

    const texto = screen.getByText(/mes publicado/i).textContent ?? '';

    expect(texto).toContain('2026-10-20');
    expect(texto).toContain('u-de-la-encargada');
  });

  it('un mes en BORRADOR lo dice con esa palabra', async () => {
    montar({ mes: unMes({ estado: 'BORRADOR' }) });

    await esperar();

    expect(screen.getByText(/borrador/i)).toBeInTheDocument();
  });

  /**
   * `id: null` NO ES "BORRADOR".
   *
   * Es que la fila del mes no existe: nadie publico nunca ese mes en esa sala.
   * El contrato lo distingue a proposito y la pantalla tambien tiene que
   * hacerlo: pintar "en borrador" ahi inventa un estado que no esta en ningun
   * sitio, y el admin entiende que alguien empezo y lo dejo a medias.
   */
  it('un mes sin fila (id null) lo dice y NO finge un estado', async () => {
    montar({ mes: unMes({ id: null, estado: 'BORRADOR' }) });

    await esperar();

    expect(screen.getByText(/nunca se publico/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/borrador/i);
  });
});

// ---------------------------------------------------------------------------
// El resumen y los conflictos
// ---------------------------------------------------------------------------

describe('lo que la pantalla pide', () => {
  /**
   * CUATRO PETICIONES, y la cuarta es nueva a proposito.
   *
   * `/usuarios` entra para poder NOMBRAR a quien afecta cada conflicto. Lo que
   * esta lista blanca impide es lo de siempre: que se cuele
   * `GET .../conflictos` —que devuelve exactamente `plan.conflictos`, un dato
   * que la previsualizacion ya trae— y que alguien resuelva los nombres
   * pidiendo `/usuarios/:id` uno por uno, que serian N peticiones mas por mes.
   *
   * Sin deduplicar: pedir dos veces lo mismo tambien es un fallo.
   */
  it('salen ESTAS cuatro peticiones y ninguna mas', async () => {
    montar({ plan: planCon({ turnos: 3, conflictos: 2, exclusiones: 2 }) });

    await esperar();

    expect(rutasPedidas()).toEqual([
      RUTA_DEL_MES,
      `${RUTA_DEL_MES}/previsualizar`,
      '/salas',
      '/usuarios',
    ]);
  });
});

describe('el resumen del plan', () => {
  /**
   * LOS CUATRO, Y CADA UNO CON SU NUMERO.
   *
   * Se afirma el diccionario entero y no cuatro `getByText`: con numeros
   * sueltos, intercambiar el de conflictos por el de exclusiones —que es
   * exactamente la confusion que el contrato se ocupo de evitar— pasaria en
   * verde.
   */
  it('muestra los cuatro numeros del resumen', async () => {
    montar({ plan: planCon({ turnos: 12, reservas: 40, conflictos: 2, exclusiones: 7 }) });

    await esperar();

    expect(resumenEnPantalla()).toEqual({
      Turnos: '12',
      Reservas: '40',
      Conflictos: '2',
      Exclusiones: '7',
    });
  });
});

describe('los conflictos', () => {
  /**
   * SIN DESPLEGAR NADA.
   *
   * Un conflicto EXIGE una decision humana antes de publicar. Guardarlo detras
   * de un "ver detalles" lo convierte en algo que nadie ve: el admin publica,
   * dos alumnos se quedan sin su turno y nadie se entera hasta que preguntan.
   */
  it('LOS CONFLICTOS SE VEN SIN DESPLEGAR NADA', async () => {
    montar({ plan: planCon({ conflictos: 2, exclusiones: 40 }) });

    await esperar();

    expect(screen.getByText(/cupo lleno/i)).toBeVisible();
  });

  it('agrupa los conflictos por tipo, y estan los tres tipos', async () => {
    montar({
      plan: unPlan({
        conflictos: [
          unConflicto({ tipo: 'CUPO_LLENO' }),
          unConflicto({ tipo: 'CUPO_LLENO', fecha: '2026-11-05' }),
          unConflicto({ tipo: 'FUERA_DE_PACK', detalle: 'El pack no cubre ese dia' }),
          unConflicto({
            tipo: 'SALA_SIN_CUPO_BASE',
            perfilId: null,
            detalle: 'La sala Pilates no tiene cupoBase',
          }),
        ],
        resumen: { turnos: 0, reservas: 0, conflictos: 4, exclusiones: 0 },
      }),
    });

    await esperar();

    const zona = screen.getByRole('region', { name: /conflictos/i });

    // El titulo del grupo lleva CUANTOS hay: dos conflictos de cupo lleno son
    // dos decisiones, no una.
    expect(within(zona).getByText(/cupo lleno \(2\)/i)).toBeInTheDocument();
    expect(within(zona).getByText(/fuera del pack \(1\)/i)).toBeInTheDocument();
    expect(within(zona).getByText(/cupo base \(1\)/i)).toBeInTheDocument();
  });

  it('sin conflictos LO DICE, no deja el hueco', async () => {
    // Un hueco en blanco se lee igual que "todavia no cargo".
    montar({ plan: planCon({ turnos: 3, reservas: 9 }) });

    await esperar();

    expect(screen.getByText(/sin conflictos/i)).toBeInTheDocument();
  });

  /**
   * LOS CONFLICTOS NO SE MEZCLAN CON LAS EXCLUSIONES.
   *
   * El contrato las separa a proposito: «un mes con tres alumnos de vacaciones
   * produciria decenas de "conflictos" que nadie tiene que resolver y que
   * esconderian los dos que si». Un conflicto exige una decision; una exclusion
   * es una fecha que no genera reserva porque alguien cargo un dato a proposito.
   *
   * Las dos mitades del test van juntas: la primera impide que las exclusiones
   * entren en la zona de conflictos, y la SEGUNDA impide que la forma barata de
   * pasar la primera —no pintar las exclusiones en ningun lado— cuele.
   */
  it('los conflictos NO se mezclan con las exclusiones', async () => {
    montar({ plan: planCon({ conflictos: 2, exclusiones: 40 }) });

    await esperar();

    const zonaDeConflictos = screen.getByRole('region', { name: /conflictos/i });
    const zonaDeExclusiones = screen.getByRole('region', { name: /exclusiones/i });

    expect(within(zonaDeConflictos).queryByText(/vacaciones/i)).toBeNull();
    expect(within(zonaDeExclusiones).getAllByText(/vacaciones/i).length).toBeGreaterThan(0);
  });

  /**
   * UN CONFLICTO QUE NO NOMBRA A NADIE NO SE PUEDE RESOLVER.
   *
   * El contrato dice que los conflictos son las unicas situaciones que EXIGEN
   * una decision humana. Sin saber de quien es, el humano no puede decidir: el
   * nombre no es un adorno, es lo que hace accionable la lista.
   */
  it('un conflicto de un alumno lo NOMBRA', async () => {
    montar({
      plan: unPlan({
        conflictos: [unConflicto({ perfilId: PERFILES.ana })],
        resumen: { turnos: 0, reservas: 0, conflictos: 1, exclusiones: 0 },
      }),
    });

    await esperar();

    const zona = screen.getByRole('region', { name: /conflictos/i });

    expect(within(zona).getByText(/Ana Perez/)).toBeInTheDocument();
  });

  /**
   * `SALA_SIN_CUPO_BASE` TRAE `perfilId: null` porque es de la sala y no de
   * nadie. Ahi no hay nombre que poner, y no se inventa uno: pegarle el nombre
   * del alumno de al lado seria peor que no poner ninguno.
   */
  it('un conflicto de la sala no inventa un nombre', async () => {
    montar({
      plan: unPlan({
        conflictos: [
          unConflicto({
            tipo: 'SALA_SIN_CUPO_BASE',
            perfilId: null,
            fecha: '2026-11-03',
            detalle: 'La sala Pilates no tiene cupoBase',
          }),
        ],
        resumen: { turnos: 0, reservas: 0, conflictos: 1, exclusiones: 0 },
      }),
    });

    await esperar();

    const zona = screen.getByRole('region', { name: /conflictos/i });
    const renglon = within(zona).getByRole('listitem');

    // El renglon entero, no un `queryByText`: asi tampoco se cuela un nombre
    // en un atributo ni en un trozo que nadie buscaba.
    expect(renglon.textContent?.trim()).toBe('2026-11-03 La sala Pilates no tiene cupoBase');
  });

  /**
   * UN ID QUE NO ESTA EN LA LISTA NO BORRA EL CONFLICTO.
   *
   * La forma facil de resolver nombres es filtrar la lista por los que se
   * pudieron resolver, y entonces alguien a quien dieron de baja —o un perfil
   * que la lista no devuelve— hace DESAPARECER de la pantalla una decision que
   * sigue pendiente. El conflicto se pinta igual, sin nombre.
   */
  it('un perfilId que no esta en la lista no hace desaparecer el conflicto', async () => {
    montar({
      plan: unPlan({
        conflictos: [unConflicto({ perfilId: PERFILES.fantasma, detalle: 'Sigue haciendo falta' })],
        resumen: { turnos: 0, reservas: 0, conflictos: 1, exclusiones: 0 },
      }),
    });

    await esperar();

    const zona = screen.getByRole('region', { name: /conflictos/i });

    expect(within(zona).getByText(/Sigue haciendo falta/)).toBeInTheDocument();
    expect(within(zona).queryByText(/Ana Perez/)).toBeNull();
  });

  it('las exclusiones se cuentan y se explican como informativas', async () => {
    montar({ plan: planCon({ conflictos: 0, exclusiones: 40 }) });

    await esperar();

    const zona = screen.getByRole('region', { name: /exclusiones/i });

    expect(within(zona).getByText(/no hay nada que decidir/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Las listas
// ---------------------------------------------------------------------------

describe('las listas del plan', () => {
  /**
   * PLEGADAS.
   *
   * Un mes de una sala son decenas de turnos y cientos de reservas. Abiertas,
   * empujan los conflictos —lo unico que exige una decision— fuera de la
   * pantalla.
   *
   * Se fija el conjunto ENTERO de plegables y no solo dos: asi tampoco puede
   * aparecer un tercero abierto sin que nadie se entere.
   */
  it('las listas de turnos y reservas arrancan PLEGADAS', async () => {
    montar({ plan: planCon({ turnos: 3, reservas: 5, exclusiones: 2 }) });

    await esperar();

    expect(plegables()).toEqual([
      { titulo: 'Ver las 2 fechas excluidas', abierto: false },
      { titulo: 'Turnos a crear (3)', abierto: false },
      { titulo: 'Reservas a crear (5)', abierto: false },
    ]);
  });

  /**
   * LOS IDENTIFICADORES DE LOS ALUMNOS NO ENTRAN EN EL MARCADO.
   *
   * Este test existe por una mutacion que paso los veintiseis anteriores en
   * verde: un `data-perfiles` en el plegable de reservas, con los `perfilId` de
   * todos los alumnos del mes, puesto "para poder buscarlos con Ctrl+F". No
   * quitaba nada y no se veia: las listas siguen plegadas, los recuentos
   * siguen siendo los mismos y ningun test miraba los atributos.
   *
   * Es el mismo agujero que la Fase 0 cerro con el `tenantId` en el `<option>`
   * de las salas, y aqui es mas grande: el plan trae LAS LISTAS COMPLETAS, asi
   * que son todos los alumnos de la sala en el codigo fuente de la pagina
   * —legible con "ver codigo fuente" aunque nadie lo dibuje, en cualquier
   * captura y para el SDK de errores que se enchufe mañana—. La pantalla solo
   * necesita CONTARLOS.
   *
   * Dos cuidados en como esta escrito:
   *
   *  - Los centinelas salen del FIXTURE, que es la entrada, y no de la funcion
   *    que pinta: una lista blanca derivada del sitio que audita no es una
   *    lista blanca.
   *  - Se afirma antes la PREMISA —que hay nueve reservas y la pantalla las
   *    cuenta—: sin eso, el dia que alguien deje de pintar las listas el test
   *    seguiria verde diciendo algo que ya no comprueba nada.
   */
  it('los identificadores de los alumnos no entran en el marcado', async () => {
    montar({
      plan: unPlan({
        turnosACrear: [unTurno(), unTurno({ fecha: '2026-11-03' })],
        reservasACrear: [
          unaReserva({ perfilId: PERFILES.ana }),
          unaReserva({ perfilId: PERFILES.bruno, fecha: '2026-11-03' }),
          unaReserva({ perfilId: PERFILES.fantasma, fecha: '2026-11-04' }),
        ],
        conflictos: [
          unConflicto({ perfilId: PERFILES.ana }),
          // Y UNO QUE LA LISTA NO RESUELVE: es el unico escenario donde se nota
          // la diferencia entre "pinto el nombre" y "pinto el id cuando no hay
          // nombre". Montado solo con perfiles resolubles, este test no podria
          // ver esa segunda cosa.
          unConflicto({ perfilId: PERFILES.fantasma, fecha: '2026-11-05' }),
        ],
        exclusiones: [unaExclusion({ perfilId: PERFILES.bruno })],
        resumen: { turnos: 2, reservas: 3, conflictos: 2, exclusiones: 1 },
      }),
    });

    await esperar();

    expect(screen.getByText('Reservas a crear (3)')).toBeInTheDocument();
    expect(screen.getByText('Turnos a crear (2)')).toBeInTheDocument();

    // Y LA DISTINCION QUE IMPORTA: el nombre de Ana SI esta —el conflicto es
    // suyo y hay que resolverlo—, y su `perfilId` NO. El id es la clave de
    // busqueda; lo que se pinta es el nombre.
    expect(screen.getAllByText(/Ana Perez/).length).toBeGreaterThan(0);

    const marcado = document.body.innerHTML;

    for (const [quien, perfilId] of Object.entries(PERFILES)) {
      // Sobre el MARCADO, no sobre lo que se ve: el dato viaja igual en un
      // atributo, en un comentario o dentro de un plegable cerrado.
      expect(marcado, `el marcado lleva el perfilId de ${quien}`).not.toContain(perfilId);
      // Y tampoco por el canal de salida que no esta en el documento.
      expect(document.title, `el titulo lleva el perfilId de ${quien}`).not.toContain(perfilId);
    }
  });
});

// ---------------------------------------------------------------------------
// Quien puede publicar
// ---------------------------------------------------------------------------

describe('quien ve el boton de publicar', () => {
  /**
   * SOBRE LOS `<button>` DEL MARCADO, NO con `queryByRole` ni barriendo el
   * `innerHTML` en busca de una palabra.
   *
   * Ni lo uno ni lo otro: `*ByRole` consulta el arbol de accesibilidad, que YA
   * excluye lo que lleva `hidden` o `display:none` —un boton escondido con CSS
   * pasa ese test en verde y sigue en el DOM, pulsable desde las herramientas
   * del navegador—, y eso es la leccion que costo la fase anterior. Pero buscar
   * /publicar/i en el documento entero tampoco sirve: pasaba por una
   * COINCIDENCIA ORTOGRAFICA —"Publicando…" no contiene "publicar"— y ataba el
   * resto de la pantalla a no usar nunca esa palabra. Una defensa que necesita
   * un comentario pidiendo que nadie cambie un texto ya fallo.
   *
   * Lo que se afirma es el conjunto ENTERO de botones del marcado, que para un
   * ADMIN_OPERATIVO es vacio. Asi el estado del trabajo puede decir lo que
   * quiera, y cualquier boton nuevo —se llame como se llame— obliga a volver
   * aqui a decidirlo.
   */
  it('el boton de publicar NO EXISTE EN EL MARCADO para un ADMIN_OPERATIVO', async () => {
    montar({ rol: 'ADMIN_OPERATIVO', plan: planCon({ turnos: 2, conflictos: 1 }) });

    await esperar();

    // LA PREMISA: la pantalla se pinto entera. Sin esto, una pantalla en blanco
    // —o un fallo de montaje— pasaria este test sin defender nada.
    expect(screen.getByText('Turnos a crear (2)')).toBeInTheDocument();

    expect(botonesDelDocumento()).toEqual([]);
  });

  it('un ADMIN_SALON si lo ve', async () => {
    montar({ rol: 'ADMIN_SALON' });

    await esperar();

    expect(screen.getByRole('button', { name: /publicar/i })).toBeInTheDocument();
  });

  it('un SUPERADMIN tambien, porque los roles son jerarquicos', async () => {
    montar({ rol: 'SUPERADMIN' });

    await esperar();

    expect(screen.getByRole('button', { name: /publicar/i })).toBeInTheDocument();
  });

  /**
   * FALLA CERRADA.
   *
   * El rol llega por el proveedor que pone el armazon del panel. Un
   * reordenamiento del layout que deje esta pantalla fuera del armazon devuelve
   * `null`, y eso tiene que significar "no alcanza para nada", no "no se sabe,
   * dibujalo igual": seria abrir la accion mas consecuente del sistema —crear
   * reservas para todo el salon de golpe— por un cambio de maquetado.
   */
  it('sin proveedor de rol tampoco se dibuja', async () => {
    montar({ rol: null, plan: planCon({ turnos: 2 }) });

    await esperar();

    expect(screen.getByText('Turnos a crear (2)')).toBeInTheDocument();
    expect(botonesDelDocumento()).toEqual([]);
  });

  it('un ADMIN_OPERATIVO SI ve el plan: lo que se le quita es la accion', async () => {
    // El resto del modulo pide ADMIN_OPERATIVO; solo publicar pide ADMIN_SALON.
    montar({ rol: 'ADMIN_OPERATIVO', plan: planCon({ turnos: 3, conflictos: 1 }) });

    await esperar();

    expect(screen.getByText(/cupo lleno/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Publicar
// ---------------------------------------------------------------------------

describe('publicar el mes', () => {
  it('publicar manda UNA sola peticion', async () => {
    montar();

    await esperar();
    await pulsar(/publicar/i);

    expect(cuantasPublicaciones()).toBe(1);
    expect(pedirEspia).toHaveBeenCalledWith(`${RUTA_DEL_MES}/publicar`, { metodo: 'POST' });
  });

  /**
   * UN MES HABILITADO NO SE ADVIERTE: SE EXPLICA.
   *
   * El planificador es incremental —lee lo que ya existe y completa lo que
   * falta— y el worker deja claro que «los que YA tienen profesora no se tocan».
   * Republicar es seguro y aditivo. Un "¿estas seguro? esto puede romper el
   * mes" seria mentir, y el admin que lo cree deja de republicar cuando tiene
   * que hacerlo.
   */
  it('un mes HABILITADO explica que republicar no deshace nada', async () => {
    montar({ mes: unMes({ estado: 'HABILITADO', publicadoEn: '2026-10-20T14:30:00.000Z' }) });

    await esperar();

    expect(screen.getByText(/no deshace nada/i)).toBeInTheDocument();
  });

  // La otra mitad: si la explicacion estuviera siempre, el test de arriba
  // pasaria sin que la pantalla distinga nada.
  it('un mes que nunca se publico no habla de deshacer', async () => {
    montar({ mes: unMes({ id: null }) });

    await esperar();

    expect(screen.queryByText(/no deshace nada/i)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// El trabajo en segundo plano
// ---------------------------------------------------------------------------

describe('el trabajo de publicacion', () => {
  it('mientras el trabajo corre se dice, y se sigue consultando', async () => {
    montar({ mes: unMes({ publicacion: unTrabajo({ estado: 'procesando' }) }) });

    await esperar();

    expect(screen.getByText(/publicando el mes/i)).toBeInTheDocument();

    const antes = cuantasVecesSePidioElMes();
    expect(antes).toBeGreaterThan(0);

    await avanzar(ESPERA_DEL_SONDEO);

    expect(cuantasVecesSePidioElMes()).toBe(antes + 1);
  });

  /**
   * CUANDO EL TRABAJO TERMINA, EL PLAN QUE SE VE YA NO ES EL QUE ES.
   *
   * `previsualizar` es incremental: en cuanto el worker escribe, "quedan 42
   * turnos por crear" pasa a ser "quedan 0". Sin esto, la pantalla se queda
   * enseñando un plan que ya se aplico y nada avisa de que caduco.
   *
   * Las dos mitades: que SALGA al terminar, y que NO SALGA antes. Sin la
   * segunda, invalidar el plan en cada sondeo pasaria igual de verde y serian
   * dos recalculos del mes entero por segundo.
   */
  it('cuando el trabajo termina se vuelve a pedir el plan, y no antes', async () => {
    let estado: EstadoPublicacion = unTrabajo({ estado: 'procesando' });

    montar({ mes: () => unMes({ publicacion: estado }) });

    await esperar();

    const alEmpezar = cuantasPrevisualizaciones();
    expect(alEmpezar).toBe(1);

    // Un sondeo mas, con el trabajo todavia corriendo: el plan NO se repide.
    await avanzar(ESPERA_DEL_SONDEO);
    expect(cuantasPrevisualizaciones()).toBe(alEmpezar);

    estado = unTrabajo({ estado: 'terminado' });
    await avanzar(ESPERA_DEL_SONDEO);

    expect(cuantasPrevisualizaciones()).toBe(alEmpezar + 1);
  });

  /**
   * Y abrir un mes YA publicado no recalcula nada.
   *
   * Lo que caduca el plan es la TRANSICION de "corriendo" a "termino", no el
   * estado `terminado` a secas: con la condicion escrita sin memoria, cada
   * carga de un mes publicado hace meses dispara una previsualizacion de mas, y
   * `previsualizar` es un POST que recalcula el mes entero.
   */
  it('abrir un mes que ya estaba terminado no repide el plan', async () => {
    montar({
      mes: unMes({ estado: 'HABILITADO', publicacion: unTrabajo({ estado: 'terminado' }) }),
    });

    await esperar();
    await avanzar(ESPERA_DEL_SONDEO * 4);

    expect(cuantasPrevisualizaciones()).toBe(1);
  });

  /**
   * SE CUENTAN LAS PETICIONES, no se mira si se llamo.
   *
   * `toHaveBeenCalled` sigue siendo cierto con un sondeo que no para nunca:
   * una peticion cada tres segundos para siempre en la maquina del mostrador,
   * que ademas no se apaga porque nadie cierra esa pestaña.
   */
  it('cuando termina se deja de consultar', async () => {
    montar({
      mes: unMes({ estado: 'HABILITADO', publicacion: unTrabajo({ estado: 'terminado' }) }),
    });

    await esperar();

    const antes = cuantasVecesSePidioElMes();
    expect(antes).toBe(1);

    await avanzar(ESPERA_DEL_SONDEO * 4);

    expect(cuantasVecesSePidioElMes()).toBe(antes);
  });

  /**
   * EL ERROR QUE VINO, no "algo salio mal".
   *
   * El worker escribe por que fallo. Sustituirlo por un generico deja al admin
   * sin saber si vuelve a intentarlo o si tiene que arreglar un dato antes.
   */
  it('FALLIDO muestra el error de la API, no "algo salio mal"', async () => {
    montar({
      mes: unMes({
        publicacion: unTrabajo({ estado: 'fallido', error: 'La sala no tiene cupoBase cargado' }),
      }),
    });

    await esperar();

    expect(screen.getByText(/la sala no tiene cupoBase cargado/i)).toBeInTheDocument();
  });

  it('fallido deja volver a publicar', async () => {
    montar({
      mes: unMes({ publicacion: unTrabajo({ estado: 'fallido', error: 'Se cayo el worker' }) }),
    });

    await esperar();

    const boton = screen.getByRole('button', { name: /publicar/i });
    expect(boton).toBeEnabled();

    await pulsar(/publicar/i);

    expect(cuantasPublicaciones()).toBe(1);
  });

  it('mientras el trabajo corre, publicar no se puede volver a pulsar', async () => {
    montar({ mes: unMes({ publicacion: unTrabajo({ estado: 'en_cola' }) }) });

    await esperar();

    expect(screen.getByRole('button', { name: /publicar/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Los fallos de la peticion de publicar
// ---------------------------------------------------------------------------

describe('cuando publicar falla', () => {
  /**
   * EL 403 DICE QUE ROL HACE FALTA.
   *
   * Puede pasar aunque el boton solo se dibuje para un ADMIN_SALON: el rol sale
   * del contexto que la puerta resolvio AL ENTRAR, y a alguien se le puede
   * bajar el rol con la pantalla abierta. El mensaje de la API ahi es
   * «Forbidden resource», que delante del mostrador no explica nada.
   */
  it('un 403 al publicar dice QUE ROL hace falta', async () => {
    montar({
      alPublicar: () => Promise.reject(new ErrorDeApi('Forbidden resource', 403)),
    });

    await esperar();
    await pulsar(/publicar/i);

    expect(screen.getByText(/ADMIN_SALON/)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Forbidden resource');
  });

  it('un 400 muestra el mensaje de la API', async () => {
    montar({
      alPublicar: () =>
        Promise.reject(new ErrorDeApi('No se puede generar un mes que ya paso', 400)),
    });

    await esperar();
    await pulsar(/publicar/i);

    expect(screen.getByText('No se puede generar un mes que ya paso')).toBeInTheDocument();
    // Y NO se confunde con la caida de red: ahi el mes podria haberse encolado.
    expect(document.body.innerHTML).not.toMatch(/no se encolo nada/i);
  });

  /**
   * LA RED CAIDA NO ES UN RECHAZO.
   *
   * Con un 400 el servidor contesto y no hizo nada. Sin red la peticion no
   * salio del navegador, asi que tampoco se encolo nada —y eso hay que decirlo,
   * porque es justo la duda del admin: «¿se mando o no?»—. Y reintentar tiene
   * que seguir siendo posible: el boton no desaparece.
   */
  it('una caida de red se distingue del rechazo y se puede reintentar', async () => {
    let intentos = 0;

    montar({
      alPublicar: () => {
        intentos += 1;
        return intentos === 1
          ? Promise.reject(new ErrorDeApi('Sin conexion. Comproba tu red y volve a intentarlo.', 0))
          : Promise.resolve(UNA_PUBLICACION);
      },
    });

    await esperar();
    await pulsar(/publicar/i);

    expect(screen.getByText(/no se encolo nada/i)).toBeInTheDocument();

    await pulsar(/publicar/i);

    expect(cuantasPublicaciones()).toBe(2);
    expect(screen.queryByText(/no se encolo nada/i)).toBeNull();
  });
});
