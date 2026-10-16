import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SalaPublica, TurnoPublico, UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { clavesDeTurnos } from '@/hooks/use-turnos';
import { filtrosDeLaBusqueda } from './filtros';
import PaginaDeTurnos from './page';

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso, no lo que habia al cargar el modulo.
  busqueda: { parametros: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => busqueda.parametros,
  usePathname: () => '/mi-gym/admin/turnos',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/**
 * Se dobla `pedir` y no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fija `use-turnos.spec`. Lo que se audita
 * aqui es un escalon mas arriba: que la PANTALLA le pase los filtros que leyo
 * de la URL. Doblando `fetch` habria que mirar `/api/bx/turnos?...` y el
 * prefijo del proxy no es asunto de esta pantalla.
 *
 * `ErrorDeApi` se deja REAL: el codigo de la pagina ramifica con `instanceof`,
 * y un doble de la clase haria pasar el test con la rama equivocada.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

/**
 * LA BARRA DE DIRECCIONES, POR DETRAS DEL ROUTER.
 *
 * Todos los tests de navegacion de este repo —los de esta pantalla, los de
 * personas, los del calendario, los del layout— afirman sobre el `push` del
 * router DOBLADO de `next/navigation`. Ninguno mira la History API de verdad,
 * y una pantalla que llame a `window.history.replaceState` directamente se
 * salta ese doble entero: reescribe la URL sin pasar por el router, sin que el
 * recuento de `push` se mueva y sin que ningun test del repo se entere.
 *
 * No es inocuo. `replaceState` PISA la entrada del historial en la que la
 * persona esta: el boton de atras deja de llevar a donde estaba, y el enlace
 * que acababa de copiar de la barra ya no es el que mando por chat. Y ademas
 * Next no se entera de la URL nueva, asi que a partir de ahi `useSearchParams`
 * y la barra de direcciones dicen cosas distintas, que es exactamente lo que
 * tener los filtros en la URL venia a evitar.
 *
 * Se vigilan los CINCO metodos que mueven el historial, no solo el de la
 * mutacion que lo destapo: con `replaceState` a secas, el mismo agujero vuelve
 * a abrirse el dia que alguien escriba `history.pushState` o `history.back()`.
 */
const HISTORIAL_A_MANO = ['pushState', 'replaceState', 'go', 'back', 'forward'] as const;

const historialDeMas: string[] = [];

function vigilarLaHistoryApi(): () => void {
  const objetivo = window.history as unknown as Record<string, unknown>;
  const originales = new Map<string, unknown>();

  for (const nombre of HISTORIAL_A_MANO) {
    originales.set(nombre, objetivo[nombre]);
    objetivo[nombre] = (...partes: unknown[]) => {
      historialDeMas.push(`${nombre}(${partes.map((parte) => String(parte)).join(', ')})`);
    };
  }

  return () => {
    for (const [nombre, original] of originales) objetivo[nombre] = original;
  };
}

let soltarLaHistoryApi: () => void = () => {};

beforeEach(() => {
  historialDeMas.length = 0;
  soltarLaHistoryApi = vigilarLaHistoryApi();
});

afterEach(() => {
  soltarLaHistoryApi();
  vi.clearAllMocks();
  // Los almacenes del navegador los deja como estaban —y ademas los AUDITA— el
  // tapon global de `vitest.setup.ts`. Limpiarlos aqui, en un `afterEach` del
  // spec que corre ANTES que el suyo, lo dejaria mirando unos almacenes vacios.
});

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

function unTurno(cambios: Partial<TurnoPublico> = {}): TurnoPublico {
  return {
    id: 't1',
    tenantId: 't-del-gimnasio',
    salaId: 's1',
    nombre: 'Funcional',
    fecha: '2026-10-12',
    horaInicio: '08:00',
    horaFin: '09:00',
    cupo: 10,
    reservasActivas: 7,
    lugaresLibres: 3,
    profesor: { id: 'p1', nombreCompleto: 'Ana Gomez' },
    ...cambios,
  };
}

function unaSala(cambios: Partial<SalaPublica> = {}): SalaPublica {
  return {
    id: 's1',
    tenantId: 't-del-gimnasio',
    nombre: 'Sala Principal',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
    ...cambios,
  };
}

function unaProfesora(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'p1',
    tenantId: 't-del-gimnasio',
    nombreCompleto: 'Ana Gomez',
    email: 'ana@gym.test',
    rol: 'PROFESOR',
    activo: true,
    perfilId: 'perfil-de-ana',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['s1'],
    ...cambios,
  };
}

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

/**
 * Monta la pantalla con su propio `QueryClient`.
 *
 * Lo que el test da se SIEMBRA en la cache, para que el primer pintado ya lo
 * tenga y los tests que miran el DOM no necesiten esperar. La clave de la lista
 * se calcula con `filtrosDeLaBusqueda`, que es la misma funcion que usa la
 * pagina: si el test la reimplementara, una pantalla que lea mal la URL seguiria
 * encontrando su dato sembrado y el test no se enteraria.
 *
 * Sembrar NO apaga la peticion: la consulta nace rancia y se pide igual, que es
 * lo que mira el test de "lee los filtros DE la URL".
 */
function montar({
  turnos,
  salas = [unaSala()],
  profesoras = [unaProfesora()],
  error,
  busqueda: textoDeBusqueda = '',
}: {
  turnos?: TurnoPublico[];
  salas?: SalaPublica[];
  profesoras?: UsuarioResumen[];
  error?: unknown;
  busqueda?: string;
} = {}): QueryClient {
  busqueda.parametros = new URLSearchParams(textoDeBusqueda);

  pedirEspia.mockImplementation((ruta: string) => {
    if (error !== undefined) return Promise.reject(error);
    if (ruta.startsWith('/salas')) return Promise.resolve(salas);
    if (ruta.startsWith('/usuarios')) return Promise.resolve(profesoras);
    return Promise.resolve(turnos ?? []);
  });

  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Los catalogos van siempre: la columna de sala y los dos selectores los
  // necesitan en el primer pintado, y esperarlos en cada test taparia lo que
  // cada test viene a mirar.
  cliente.setQueryData(clavesDeCatalogos.salas(), salas);
  cliente.setQueryData(clavesDeUsuarios.lista({ tipo: 'profesor' }), profesoras);

  if (turnos !== undefined) {
    cliente.setQueryData(clavesDeTurnos.lista(filtrosDeLaBusqueda(busqueda.parametros)), turnos);
  }

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeTurnos />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Deja que las consultas se resuelvan (o se rompan) y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/**
 * Elige una opcion por su TEXTO, que es lo unico que ve el admin.
 *
 * `selectOptions` con una cadena busca por `value`, y el valor es el de la API
 * (`true`, un id), no el de la pantalla. Pasarle el `value` ataria el test al
 * contrato y no a lo que hay en la pantalla.
 */
async function elegirFiltro(etiqueta: string, opcion: string): Promise<void> {
  const usuario = userEvent.setup();
  const control = screen.getByLabelText(etiqueta);
  const elegida = [...control.querySelectorAll('option')].find(
    (option) => option.textContent?.trim() === opcion,
  );

  if (elegida === undefined) throw new Error(`El filtro "${etiqueta}" no tiene "${opcion}"`);

  await usuario.selectOptions(control, elegida);
}

function columnasDelDocumento(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

/** El contenido de cada fila, celda a celda. */
function filasDelDocumento(): string[][] {
  return [...document.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

function enlacesDelDocumento(): (string | null)[] {
  return [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
}

/** Las rutas pedidas, EN ORDEN y SIN deduplicar. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

// ---------------------------------------------------------------------------
// La tabla
// ---------------------------------------------------------------------------

describe('el listado de turnos', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —el error que ningun
  // test de presencia ve— rompe esto.
  it('muestra ESTAS columnas y solo estas', () => {
    montar({ turnos: [unTurno()] });

    expect(columnasDelDocumento()).toEqual([
      'Fecha',
      'Hora',
      'Clase',
      'Sala',
      'Profesora',
      'Ocupación',
    ]);
  });

  it('cada fila tiene EXACTAMENTE una celda por columna, con este contenido', () => {
    // Una celda de mas no la ve el test de los `<th>`: se puede pintar un `<td>`
    // sin encabezado y la lista blanca de arriba sigue en verde.
    montar({ turnos: [unTurno()] });

    expect(filasDelDocumento()).toEqual([
      ['2026-10-12', '08:00 a 09:00', 'Funcional', 'Sala Principal', 'Ana Gomez', '7/10'],
    ]);
  });

  it('sin resultados lo dice, y no deja una tabla vacia', () => {
    montar({ turnos: [] });

    expect(screen.getByText(/no hay turnos/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('cada fila enlaza a SU ficha', () => {
    // Con DOS turnos sembrados: con uno solo, "enlaza al suyo" y "enlaza al
    // primero" son indistinguibles.
    montar({ turnos: [unTurno({ id: 't1' }), unTurno({ id: 't2' })] });

    expect(enlacesDelDocumento()).toEqual(['/mi-gym/admin/turnos/t1', '/mi-gym/admin/turnos/t2']);
  });

  /**
   * Y SE LLEVA LOS FILTROS PUESTOS, que es lo que permite volver a ESTA lista.
   *
   * El test de arriba monta SIN filtros, que es el unico caso donde llevarlos y
   * tirarlos dan el mismo enlace: ahi la distincion no existe. Hace falta
   * montarlo con filtros para que se vea.
   */
  it('cada fila se lleva los filtros a la ficha', () => {
    montar({ turnos: [unTurno({ id: 't1' })], busqueda: 'desde=2026-10-01&salaId=s1' });

    expect(enlacesDelDocumento()).toEqual(['/mi-gym/admin/turnos/t1?desde=2026-10-01&salaId=s1']);
  });

  it('un turno sin profesora lo dice, no deja la celda vacia', () => {
    // Una celda en blanco se lee como "no cargo la pantalla", no como "falta
    // asignarla", y asignar suplencias es justo lo que recepcion viene a hacer.
    montar({ turnos: [unTurno({ profesor: null })] });

    const [fila] = filasDelDocumento();
    expect(fila?.[4]).toBe('Sin profesora');
    expect(fila?.[4]).not.toBe('');
  });

  it('la sala sale por su NOMBRE, nunca por su id', () => {
    // El `salaId` viene en el turno y el nombre no: la tabla lo cruza contra el
    // catalogo. Pintar el id seria gratis y no le dice nada a nadie del
    // mostrador.
    montar({
      turnos: [unTurno({ salaId: 'identificador-de-la-sala' })],
      salas: [unaSala({ id: 'identificador-de-la-sala', nombre: 'Sala Principal' })],
    });

    const [fila] = filasDelDocumento();
    expect(fila?.[3]).toBe('Sala Principal');
  });

  it('la ocupacion se lee de un vistazo', () => {
    // `reservasActivas` / `cupo`. Y un turno lleno tiene que distinguirse de
    // uno con lugar sin tener que restar de cabeza.
    montar({
      turnos: [
        unTurno({ id: 't1', reservasActivas: 7, cupo: 10, lugaresLibres: 3 }),
        unTurno({ id: 't2', reservasActivas: 10, cupo: 10, lugaresLibres: 0 }),
      ],
    });

    const [conLugar, lleno] = filasDelDocumento();

    expect(conLugar?.[5]).toBe('7/10');
    expect(lleno?.[5]).toContain('10/10');
    expect(lleno?.[5]).not.toBe(conLugar?.[5]);
    expect(lleno?.[5]).toMatch(/lleno/i);
  });
});

// ---------------------------------------------------------------------------
// Los filtros
// ---------------------------------------------------------------------------

describe('los filtros', () => {
  it('los filtros viajan en la URL, no en estado', async () => {
    montar({ turnos: [] });

    await elegirFiltro('Sala', 'Sala Principal');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos?salaId=s1');
    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('lee los filtros DE la URL al cargar', () => {
    montar({ turnos: [], busqueda: '?desde=2026-10-01&hasta=2026-10-31&salaId=s1&profesorId=p1' });

    expect(rutasPedidas()).toContain(
      '/turnos?desde=2026-10-01&hasta=2026-10-31&salaId=s1&profesorId=p1',
    );
  });

  it('soloLibres en false se manda igual', () => {
    // `false` es un filtro ("mostrame tambien los llenos"), no la ausencia de
    // filtro. Un `if (f.soloLibres)` se lo comeria.
    montar({ turnos: [], busqueda: '?soloLibres=false' });

    expect(rutasPedidas()).toContain('/turnos?soloLibres=false');
  });

  it('soloLibres en true tambien se manda', () => {
    montar({ turnos: [], busqueda: '?soloLibres=true' });

    expect(rutasPedidas()).toContain('/turnos?soloLibres=true');
  });

  it('un filtro imposible en la URL no se manda a la API', () => {
    // `?soloLibres=quiza`, `?desde=ayer`. Sin esto es un 400 y una pantalla en
    // blanco. La URL la escribe cualquiera.
    montar({ turnos: [], busqueda: '?soloLibres=quiza&desde=ayer&hasta=2026-02-31&salaId=' });

    expect(rutasPedidas()).toContain('/turnos');
    expect(screen.getByLabelText('Lugar')).toHaveValue('');
    expect(screen.getByLabelText('Desde')).toHaveValue('');
    expect(screen.getByLabelText('Hasta')).toHaveValue('');
    expect(screen.getByLabelText('Sala')).toHaveValue('');
  });

  it('los controles muestran lo que dice la URL', () => {
    montar({ turnos: [], busqueda: '?desde=2026-10-01&salaId=s1&profesorId=p1&soloLibres=false' });

    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Sala')).toHaveValue('s1');
    expect(screen.getByLabelText('Profesora')).toHaveValue('p1');
    expect(screen.getByLabelText('Lugar')).toHaveValue('false');
  });

  it('cambiar un filtro conserva los otros', async () => {
    montar({ turnos: [], busqueda: '?desde=2026-10-01' });

    await elegirFiltro('Lugar', 'Solo los que tienen lugar');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos?desde=2026-10-01&soloLibres=true');
  });

  /**
   * LA URL LA ESCRIBE EL ROUTER, Y NADIE MAS.
   *
   * Se monta con filtros imposibles a proposito: "limpiar la barra para que
   * diga lo mismo que se le pidio a la API" es exactamente la linea que uno
   * escribe aqui, y es la que se salta al router. Ver el comentario de
   * `vigilarLaHistoryApi`.
   *
   * Se mira ANTES y DESPUES de tocar un filtro: al montar y al cambiar son dos
   * momentos distintos, y una pantalla puede estar limpia en uno y no en otro.
   */
  it('la URL la escribe el router, no la History API a mano', async () => {
    montar({ turnos: [unTurno()], busqueda: '?soloLibres=quiza&salaId=s1' });

    await esperar();
    expect(historialDeMas).toEqual([]);

    await elegirFiltro('Lugar', 'Solo los que tienen lugar');

    expect(historialDeMas).toEqual([]);
    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('volver a "Sin filtrar" saca la clave de la URL, no la manda vacia', async () => {
    // `?soloLibres=` vacio no es "sin filtro": el `ParseBoolPipe` de la API lo
    // rechazaria con un 400.
    montar({ turnos: [], busqueda: '?soloLibres=true' });

    await elegirFiltro('Lugar', 'Sin filtrar');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos');
  });
});

// ---------------------------------------------------------------------------
// Lo que la pantalla pide, y lo que deja guardado
// ---------------------------------------------------------------------------

describe('pintar el listado no trae nada mas', () => {
  it('salen ESTAS peticiones y ninguna mas', async () => {
    // Ordenadas y SIN deduplicar: pedir dos veces lo mismo tambien es un fallo.
    // La columna de sala y el selector de salas comparten catalogo; si cada uno
    // pidiera el suyo, aqui habria dos `/salas`.
    montar({ turnos: [unTurno({ id: 't1' }), unTurno({ id: 't2' })] });

    await esperar();

    expect(rutasPedidas()).toEqual(['/salas', '/usuarios?tipo=profesor', '/turnos']);
  });

  /**
   * LOS TRES ALMACENES DEL NAVEGADOR YA NO SE MIRAN AQUI.
   *
   * Este archivo fue el primero en mirar tambien las GALLETAS —el unico
   * almacen que VIAJA— y lo hacia con su propia copia de `contenidoDe` y
   * `galletasDelDocumento`, mas un `toEqual` sobre los VALORES que al caer
   * imprimiria en el informe de CI justamente el dato que se escapo. La
   * dimension entera subio al tapon global de `vitest.setup.ts`, que la vigila
   * en TODOS los tests de este archivo y afirma sobre las CLAVES.
   */

  it('en la cache no queda ni una ficha de turno', async () => {
    // Precargar la ficha de cada fila "para que abra instantanea" es una linea,
    // no se ve en ninguna pantalla y no hace ni una peticion si se siembra a
    // mano: la lista de peticiones de arriba no lo veria.
    const cliente = montar({ turnos: [unTurno({ id: 't1' }), unTurno({ id: 't2' })] });

    await esperar();

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey),
    ).toEqual([['salas'], ['usuarios', { tipo: 'profesor' }], ['turnos', {}]]);
  });
});

// ---------------------------------------------------------------------------
// Los fallos
// ---------------------------------------------------------------------------

describe('cuando la peticion falla', () => {
  /**
   * EL `volverA` SE LLEVA LOS FILTROS.
   *
   * Se monta CON filtros a proposito. Montar sin ellos es el "caso ciego": en
   * el unico escenario donde no hay query que conservar, un destino que se lo
   * lleva y uno que lo tira son indistinguibles. Ya paso en esta fase.
   *
   * No se comprueba COMO se escribio la cadena sino que SOBREVIVE el viaje: el
   * destino se pasa por `rutaDeRetornoSegura`, que es quien decide a donde
   * aterriza de verdad.
   */
  it('un 401 manda al login CONSERVANDO los filtros', async () => {
    montar({
      error: new ErrorDeApi('Sin sesion', 401),
      busqueda: '?salaId=s1&soloLibres=false',
    });

    await esperar();

    const [destino] = empujar.mock.calls[0] as [string];
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA');

    expect(destino).toContain('/mi-gym/login');
    expect(rutaDeRetornoSegura(volverA ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/admin/turnos?salaId=s1&soloLibres=false',
    );
  });

  it('con las tres consultas caidas se va al login UNA sola vez', async () => {
    // Un efecto por consulta mandaria al login tres veces y dejaria dos
    // entradas basura en el historial.
    montar({ error: new ErrorDeApi('Sin sesion', 401), busqueda: '?salaId=s1' });

    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('un 401 NO ofrece reintentar: reintentar sin sesion es volver a fallar', async () => {
    montar({ error: new ErrorDeApi('Sin sesion', 401) });

    await esperar();

    expect(
      [...document.querySelectorAll('button')].map((b) => b.textContent?.trim()),
    ).not.toContain('Reintentar');
  });

  it('un error de red NO manda al login: la sesion no tiene la culpa', async () => {
    montar({ error: new ErrorDeApi('Sin conexion', 0) });

    await esperar();

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Lo que no tiene que llegar al navegador
// ---------------------------------------------------------------------------

describe('al DOM no llega lo que ninguna columna necesita', () => {
  /**
   * Los ids de sala y de profesora SI estan: son el `value` de sus `<option>`,
   * y sin ellos el filtro no podria escribir la URL. Lo que no tiene por que
   * estar es todo lo demas, y lo que se pinta viaja al navegador aunque este
   * escondido en un `data-*`, en un `title` o en una celda tapada por CSS.
   *
   * El `tenantId` es justo el dato que la Fase 0 se ocupo de que no cruzara
   * entre gimnasios; el `perfilId` es la llave con la que se anota a alguien.
   */
  it('ni el tenantId del turno, ni el de la sala, ni el perfilId de la profesora', () => {
    montar({
      turnos: [unTurno({ tenantId: 'tenant-del-turno' })],
      salas: [unaSala({ tenantId: 'tenant-de-la-sala' })],
      profesoras: [unaProfesora({ tenantId: 'tenant-de-la-profe', perfilId: 'perfil-secreto' })],
    });

    const html = document.body.innerHTML;
    for (const valor of [
      'tenant-del-turno',
      'tenant-de-la-sala',
      'tenant-de-la-profe',
      'perfil-secreto',
    ]) {
      expect(html).not.toContain(valor);
    }
  });
});
