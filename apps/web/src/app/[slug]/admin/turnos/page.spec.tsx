import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
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
 * LA BARRA DE DIRECCIONES, POR DETRAS DEL ROUTER: YA NO SE VIGILA AQUI.
 *
 * Desde la Fase 9 este archivo doblaba a mano los cinco metodos de la History
 * API —`pushState`, `replaceState`, `go`, `back` y `forward`— y afirmaba que
 * la pantalla no llamaba a ninguno. Esa regla no se perdio: SE SUBIO A
 * INFRAESTRUCTURA. El decimotercer canal de `src/test/espia-de-consola.ts`
 * vigila las mismas cinco puertas —y ademas la URL que QUEDA, donde caen un
 * `location.hash = …`, un `assign` y un `replace`, que no pasan por ninguna
 * funcion doblable— en los 67 specs del paquete en vez de en este.
 *
 * Y HUBO QUE QUITARLO, no solo se pudo. El doble de aqui instalaba los cinco
 * metodos como propiedades PROPIAS de `window.history`, que TAPAN el espia
 * global de `History.prototype`, y ademas se tragaba la llamada en vez de
 * reenviarla, asi que `location` tampoco llegaba a moverse. Medido: con un
 * `history.replaceState(null, '', '#dijo=' + unSecreto)` sembrado en
 * `page.tsx`, de los 25 tests de este archivo fallaba UNO —el de aqui— y los
 * otros 24 pasaban en verde con la fuga delante. El guardian local dejaba
 * ciego al global en su propio archivo.
 */

afterEach(() => {
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

/**
 * DOS IDS, Y NUNCA EL MISMO VALOR.
 *
 * `UsuarioResumen` trae los dos porque son dos espacios de id distintos:
 *
 *  - `id` es el del USUARIO (`Usuario.id`), que es lo que lleva la URL de su
 *    ficha, `/usuarios/:id`, y nada mas.
 *  - `perfilId` es el del PERFIL (`Perfil.id`), la fila por gimnasio. Es lo que
 *    nombra `Turno.profesorId` —`profesor Perfil? @relation(fields: [tenantId,
 *    profesorId], references: [tenantId, id])`—, asi que es lo que la API
 *    compara en `where.profesorId` y lo que tiene que viajar en `?profesorId=`.
 *
 * Se siembran DISTINTOS a proposito y con nombres que dicen cual es cual: si
 * coincidieran, ningun test podria distinguir cual de los dos mando el filtro, y
 * un filtro que devuelve siempre la lista vacia pasaria por bueno.
 *
 * ESTO NO LO PROTEGE NINGUNA ASERCION, Y NO PUEDE PROTEGERLO: una asercion solo
 * compara valores, y dos ids con el mismo valor no se distinguen comparando. La
 * separacion de los dos espacios vive AQUI, en el fixture. Quien los iguale no
 * rompe ningun test; rompe la capacidad de todos ellos de ver el bug.
 */
function unaProfesora(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'usuario-de-ana',
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

/** Los de las FILAS: el enlace «Nuevo turno» del encabezado tiene su propio test. */
function enlacesDelDocumento(): (string | null)[] {
  const tabla = screen.queryByRole('table', { name: 'Turnos' });
  if (tabla === null) return [];

  return within(tabla)
    .queryAllByRole('link')
    .map((a) => a.getAttribute('href'));
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

  it('ofrece «Nuevo turno», que lleva al alta manual', () => {
    montar({ turnos: [unTurno()] });

    const enlace = screen.getByRole('link', { name: 'Nuevo turno' });
    expect(enlace).toHaveAttribute('href', '/mi-gym/admin/turnos/nuevo');
  });

  it('«Nuevo turno» sale tambien con la lista vacia', () => {
    montar({ turnos: [] });

    expect(screen.getByRole('link', { name: 'Nuevo turno' })).toHaveAttribute(
      'href',
      '/mi-gym/admin/turnos/nuevo',
    );
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
    montar({
      turnos: [],
      busqueda: '?desde=2026-10-01&hasta=2026-10-31&salaId=s1&profesorId=perfil-de-ana',
    });

    expect(rutasPedidas()).toContain(
      '/turnos?desde=2026-10-01&hasta=2026-10-31&salaId=s1&profesorId=perfil-de-ana',
    );
  });

  /**
   * EL FILTRO MANDA EL `perfilId`, NO EL `id` DEL USUARIO.
   *
   * La API resuelve `where.profesorId` contra la columna que referencia a
   * `Perfil`, asi que con el id del usuario NO da error: devuelve CERO turnos,
   * que parece un resultado legitimo. Es el peor de los tres sintomas de esta
   * confusion porque es invisible —nadie ve un 404, solo una lista vacia que
   * podria ser cierta—, y por eso hace falta fijarlo con una asercion y no
   * confiar en que un error lo delate.
   *
   * La segunda asercion no es redundante: dice CUAL es el valor equivocado. Con
   * el fixture dando los dos ids distintos, la primera ya alcanza, pero esta
   * deja escrito de que espacio de id se trata cada uno.
   */
  it('el filtro de profesora manda su perfilId en la URL, NO el id de su usuario', async () => {
    montar({ turnos: [] });

    await elegirFiltro('Profesora', 'Ana Gomez');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos?profesorId=perfil-de-ana');
    expect(empujar).not.toHaveBeenCalledWith('/mi-gym/admin/turnos?profesorId=usuario-de-ana');
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
    // El `?profesorId=` lleva el `perfilId`: es el unico valor que casa con
    // alguna `<option>`, y un `<select>` cuyo `value` no casa con ninguna se
    // queda en la primera. O sea que esta asercion tambien fija, de rebote, que
    // el selector y la URL hablan el MISMO espacio de id.
    montar({
      turnos: [],
      busqueda: '?desde=2026-10-01&salaId=s1&profesorId=perfil-de-ana&soloLibres=false',
    });

    expect(screen.getByLabelText('Desde')).toHaveValue('2026-10-01');
    expect(screen.getByLabelText('Sala')).toHaveValue('s1');
    expect(screen.getByLabelText('Profesora')).toHaveValue('perfil-de-ana');
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
   * escribe aqui, y es la que se salta al router.
   *
   * Lo que este test afirmaba ADEMAS —que la pantalla no toca la History API a
   * mano— ya no se mira aqui: lo mira el decimotercer canal del tapon global
   * en los 67 specs. Ver el comentario de arriba. Lo que queda es lo que ese
   * canal NO cubre: que con unos filtros que la API rechazaria, la pantalla
   * siga mandando UNA sola navegacion por el router y ni una de mas.
   */
  it('con filtros imposibles sigue navegando una sola vez, por el router', async () => {
    montar({ turnos: [unTurno()], busqueda: '?soloLibres=quiza&salaId=s1' });

    await esperar();
    expect(empujar).not.toHaveBeenCalled();

    await elegirFiltro('Lugar', 'Solo los que tienen lugar');

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
   * ESTE TEST AFIRMABA QUE EL `perfilId` DE LA PROFESORA NO LLEGA AL DOM, Y ERA
   * AL REVES.
   *
   * La premisa ya estaba escrita aqui —«los ids de sala y de profesora SI
   * estan: son el `value` de sus `<option>`, y sin ellos el filtro no podria
   * escribir la URL»— pero la lista de centinelas metia el `perfilId`, porque el
   * filtro mandaba el id del usuario. El `perfilId` ES el id de la profesora a
   * efectos de este filtro: tiene que estar, y el que no tiene nada que hacer
   * aqui es el `id` del usuario, que solo sirve para `/usuarios/:id`.
   *
   * Lo que se pinta viaja al navegador aunque este escondido en un `data-*`, en
   * un `title` o en una celda tapada por CSS. El `tenantId` sigue siendo el
   * centinela de siempre: es justo el dato que la Fase 0 se ocupo de que no
   * cruzara entre gimnasios.
   */
  it('ni el tenantId del turno, ni el de la sala, ni el id de usuario de la profesora', () => {
    montar({
      turnos: [unTurno({ tenantId: 'tenant-del-turno' })],
      salas: [unaSala({ tenantId: 'tenant-de-la-sala' })],
      profesoras: [
        unaProfesora({
          tenantId: 'tenant-de-la-profe',
          id: 'usuario-centinela',
          perfilId: 'perfil-de-ana',
        }),
      ],
    });

    const html = document.body.innerHTML;
    for (const valor of [
      'tenant-del-turno',
      'tenant-de-la-sala',
      'tenant-de-la-profe',
      'usuario-centinela',
    ]) {
      expect(html).not.toContain(valor);
    }

    // Y la otra mitad: sin el `perfilId` en el marcado el filtro no tendria
    // valor que escribir en la URL. Sin esta asercion, el test pasaria tambien
    // con un `<option>` sin `value`, que es un filtro roto de otra manera.
    expect(html).toContain('perfil-de-ana');
  });
});
