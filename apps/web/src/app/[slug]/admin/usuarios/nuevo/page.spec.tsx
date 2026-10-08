import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AltaUsuarioRespuesta, PackPublico, SalaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import PaginaDeAlta from './page';
import { espiarLaConsola, SECRETOS_DEL_PANEL } from '@/test/espia-de-consola';

/**
 * El centinela de esta pantalla: la contraseña temporal que devuelve el alta.
 *
 * Sale de `SECRETOS_DEL_PANEL` y no de una cadena escrita aqui porque el tapon
 * del titulo —global, en `vitest.setup.ts`— vigila esa misma constante: con dos
 * copias, cambiar esta dejaria al tapon buscando algo que ya no se siembra.
 */
const CLAVE = SECRETOS_DEL_PANEL.claveDelAlta;

/**
 * Prefijo deliberadamente MAS ancho que la clave entera: busca `Temp0ral` y no
 * `Temp0ral!`, para cazar tambien una copia truncada o escapada. Va atado a la
 * constante con el test de abajo, porque si no, el dia que alguien cambie
 * `claveDelAlta` estas aserciones dejan de cubrir nada EN SILENCIO.
 */
const PREFIJO_DE_LA_CLAVE = 'Temp0ral';

describe('los centinelas', () => {
  it('el prefijo ancho sigue siendo parte de la clave sembrada', () => {
    expect(CLAVE).toContain(PREFIJO_DE_LA_CLAVE);
  });
});

const { empujar, pedirEspia, busqueda } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
  // Mutable a proposito: `useSearchParams` se llama en cada render y tiene que
  // devolver lo que el test de turno puso.
  busqueda: { parametros: new URLSearchParams() },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => busqueda.parametros,
  usePathname: () => '/mi-gym/admin/usuarios/nuevo',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Lo que se audita aqui es el CUERPO que la pantalla manda, que es justo donde
 * un campo de mas es un 400 (`forbidNonWhitelisted`). `ErrorDeApi` se deja
 * real: la pantalla ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

const escribirEnPortapapeles = vi.fn<(texto: string) => Promise<void>>();

const SALAS: SalaPublica[] = [
  {
    id: 'sala-1',
    tenantId: 't1',
    nombre: 'Sala grande',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  },
  {
    id: 'sala-2',
    tenantId: 't1',
    nombre: 'Sala chica',
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  },
];

const PACKS: PackPublico[] = [
  {
    id: 'pack-1',
    tenantId: 't1',
    nombre: 'Mensual 8',
    salaId: null,
    tipo: 'MENSUAL',
    precio: '12500.00',
    clasesPorMes: 8,
    clasesTotales: null,
    cancelacionesPermitidas: 2,
    activo: true,
  },
];

function unaRespuesta(cambios: Partial<AltaUsuarioRespuesta> = {}): AltaUsuarioRespuesta {
  return {
    id: 'u-nueva',
    tenantId: 't1',
    nombreCompleto: 'Ana Gomez',
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: 'perfil-de-ana',
    telefono: null,
    packId: null,
    pagoAlDia: false,
    salaIds: [],
    clasesExtra: 0,
    cancelacionesUsadas: 0,
    vigenciaDesde: null,
    vigenciaHasta: null,
    pack: null,
    salas: [],
    advertencias: [],
    passwordTemporal: CLAVE,
    ...cambios,
  };
}

interface OpcionesDeMontaje {
  tipo?: 'alumno' | 'profesor';
  /** Se usa tal cual cuando hace falta algo que `tipo` no dice (el marcador). */
  busqueda?: string;
  respuesta?: Partial<AltaUsuarioRespuesta>;
  errorDelAlta?: unknown;
}

function montar(opciones: OpcionesDeMontaje = {}) {
  const { tipo = 'alumno', errorDelAlta } = opciones;

  busqueda.parametros = new URLSearchParams(
    opciones.busqueda ?? (tipo === 'profesor' ? '?tipo=profesor' : ''),
  );

  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta === '/salas') return Promise.resolve(SALAS);
    if (ruta.startsWith('/packs')) return Promise.resolve(PACKS);
    if (errorDelAlta !== undefined) return Promise.reject(errorDelAlta);
    return Promise.resolve(unaRespuesta(opciones.respuesta));
  });

  // El portapapeles se pisa DESPUES de `setup()`, que instala el suyo.
  const sesion = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: escribirEnPortapapeles },
    configurable: true,
    writable: true,
  });

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeAlta />
    </QueryClientProvider>,
  );

  return { sesion, cliente };
}

/** Deja que las consultas y la mutacion se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Rellena lo minimo que los dos formularios comparten y envia. */
async function completarYEnviar(
  sesion: ReturnType<typeof userEvent.setup>,
  nombre = 'Ana Gomez',
  email = 'ana@gym.test',
): Promise<void> {
  await sesion.type(screen.getByLabelText('Nombre completo'), nombre);
  await sesion.type(screen.getByLabelText('Email'), email);
  await sesion.click(screen.getByRole('button', { name: /dar de alta/i }));
  await esperar();
}

/** Monta, da de alta y deja la pantalla de la clave delante. */
async function darDeAlta(opciones: OpcionesDeMontaje = {}) {
  const montaje = montar(opciones);
  await esperar();
  await completarYEnviar(montaje.sesion);
  return montaje;
}

/** El cuerpo de la UNICA peticion de escritura, encontrada por su ruta. */
function cuerpoDelAlta(): Record<string, unknown> {
  const llamada = pedirEspia.mock.calls.find(
    (llamada: unknown[]) =>
      llamada[0] === '/usuarios/alumnos' || llamada[0] === '/usuarios/profesores',
  );

  if (llamada === undefined) throw new Error('La pantalla no llamo al alta');

  return (llamada[1] as { cuerpo: Record<string, unknown> }).cuerpo;
}

/** Todas las rutas que la pantalla pidio, ordenadas y SIN quitar repetidas. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map((llamada: unknown[]) => String(llamada[0])).sort();
}

/**
 * Lo que HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * Las consultas `*ByRole` de Testing Library excluyen por su cuenta lo que lleva
 * `hidden`, `aria-hidden` o `display:none`. Con ellas se puede afirmar que algo
 * NO SE VE; no se puede afirmar que NO ESTA. Se midio sobre esta pantalla:
 * dibujar el boton de "Dar de alta" con `hidden` en vez de no dibujarlo dejaba
 * los 52 tests en verde.
 *
 * (`queryByLabelText` SI vale para afirmar ausencia: busca la relacion
 * `label`/control en el DOM y tampoco mira visibilidad. El agujero es
 * especifico de `*ByRole`.)
 */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

function rolesDelDocumento(rol: string): number {
  return document.querySelectorAll(`[role="${rol}"]`).length;
}

/** Todo lo que un almacen del navegador tiene dentro, sin preguntar por claves. */
function contenidoDe(almacen: Storage): Record<string, string> {
  const guardado: Record<string, string> = {};

  for (let indice = 0; indice < almacen.length; indice += 1) {
    const clave = almacen.key(indice);
    if (clave !== null) guardado[clave] = almacen.getItem(clave) ?? '';
  }

  return guardado;
}

/**
 * TODO lo que el `QueryClient` tiene guardado, consultas Y mutaciones.
 *
 * Las dos caches, y enteras: la de consultas es la que miran los specs de las
 * otras pantallas, pero el alta es una MUTACION y la respuesta —con la clave
 * dentro— vive en `getMutationCache()`, que ningun test de esta fase miraba.
 */
function volcadoDelCliente(cliente: QueryClient): string {
  return JSON.stringify({
    consultas: cliente
      .getQueryCache()
      .getAll()
      .map((consulta) => ({ clave: consulta.queryKey, datos: consulta.state.data })),
    mutaciones: cliente
      .getMutationCache()
      .getAll()
      .map((mutacion) => ({
        datos: mutacion.state.data,
        variables: mutacion.state.variables,
      })),
  });
}

/**
 * El tapon de la consola, en CADA test de este archivo.
 *
 * Un `console.info('[alta]', respuesta)` en el manejador del alta sobrevivia a
 * las cincuenta pruebas de esta pantalla: todas miran el DOM, la URL, los
 * `push`, los cuerpos, los almacenes, el portapapeles y las dos caches, y
 * ninguna miraba lo que la pantalla DICE. Va en `afterEach` para que lo herede
 * tambien lo que se escriba despues.
 */
let comprobarLaConsola: (centinela: string) => void = () => {};

beforeEach(() => {
  escribirEnPortapapeles.mockResolvedValue(undefined);
  comprobarLaConsola = espiarLaConsola();
});

afterEach(() => {
  comprobarLaConsola(CLAVE);

  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// La contraseña temporal
// ---------------------------------------------------------------------------

describe('la contraseña temporal del alta', () => {
  it('la clave NO viaja en la URL', async () => {
    await darDeAlta();

    expect(window.location.search).not.toContain(PREFIJO_DE_LA_CLAVE);
    expect(empujar).not.toHaveBeenCalledWith(expect.stringContaining(PREFIJO_DE_LA_CLAVE));
  });

  it('no se puede seguir sin confirmar que se anoto', async () => {
    const { sesion } = await darDeAlta();

    expect(screen.getByRole('button', { name: /listo/i })).toBeDisabled();

    await sesion.click(screen.getByLabelText(/ya la anote/i));

    expect(screen.getByRole('button', { name: /listo/i })).toBeEnabled();
  });

  it('la pantalla NO se cierra haciendo clic afuera', async () => {
    const { sesion } = await darDeAlta();

    await sesion.click(document.body);

    expect(screen.getByText(CLAVE)).toBeInTheDocument();
  });

  it('dice que no se va a poder verla de nuevo', async () => {
    await darDeAlta();

    expect(screen.getByText(/no vas a poder verla de nuevo/i)).toBeInTheDocument();
  });

  it('las advertencias del alta se muestran JUNTO a la clave', async () => {
    await darDeAlta({
      respuesta: { advertencias: [{ codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' }] },
    });

    expect(screen.getByText(/no tiene salas asignadas/i)).toBeInTheDocument();
    expect(screen.getByText(CLAVE)).toBeInTheDocument();
  });

  it('sin advertencias no se dibuja el hueco', async () => {
    await darDeAlta({ respuesta: { advertencias: [] } });

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('el formulario desaparece: no se da de alta dos veces sin querer', async () => {
    await darDeAlta();

    // Por el MARCADO, no por el rol: un formulario escondido con `hidden` sigue
    // llevando dentro el nombre y el email que se acaban de escribir, y
    // `queryByRole` no lo ve. Se comprobo que esa mutacion sobrevivia.
    expect(botonesDelDocumento()).not.toContain('Dar de alta');
  });

  it('«Listo» lleva a la ficha de la persona recien creada', async () => {
    const { sesion } = await darDeAlta();

    await sesion.click(screen.getByLabelText(/ya la anote/i));
    await sesion.click(screen.getByRole('button', { name: /listo/i }));

    expect(empujar).toHaveBeenLastCalledWith('/mi-gym/admin/usuarios/u-nueva');
  });

  /**
   * LA RUTA PROPIA.
   *
   * Un cartel sobre el formulario desaparece con un F5 y el admin no se entera
   * de que el alumno quedo creado. Lo que viaja en la URL es un MARCADOR, no la
   * clave: `alta=hecha` y nada mas.
   */
  it('al dar de alta la URL cambia, pero solo con un marcador', async () => {
    await darDeAlta();

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/usuarios/nuevo?alta=hecha');
  });

  it('recargar sobre el marcador dice la verdad en vez de callarse', async () => {
    // El estado se perdio con la recarga; la clave no se puede recuperar.
    montar({ busqueda: '?alta=hecha' });
    await esperar();

    expect(screen.getByText(/ya no se puede ver/i)).toBeInTheDocument();
    expect(screen.getByText(/admin del salon/i)).toBeInTheDocument();
    expect(botonesDelDocumento()).not.toContain('Dar de alta');
  });
});

// ---------------------------------------------------------------------------
// Donde NO queda copia de la clave
// ---------------------------------------------------------------------------

describe('la clave no deja copias', () => {
  it('no queda nada en el almacenamiento del navegador', async () => {
    await darDeAlta();

    expect({ local: contenidoDe(localStorage), sesion: contenidoDe(sessionStorage) }).toEqual({
      local: {},
      sesion: {},
    });
  });

  it('no se copia sola al portapapeles', async () => {
    await darDeAlta();

    expect(escribirEnPortapapeles).not.toHaveBeenCalled();
  });

  /**
   * LISTA BLANCA DE PETICIONES: el conjunto ENTERO de rutas que salen.
   *
   * Lo que se audita es CUANTAS peticiones salen y a donde, no solo que lleva
   * la del alta. Sin esto, una linea que mande la clave a otro endpoint —"se la
   * mandamos por email al alumno", que el plan deja explicitamente fuera de la
   * fase— pasa todos los demas tests de este archivo sin despeinarse.
   *
   * Se ordena pero NO se quitan repetidas: pedir dos veces el mismo catalogo
   * tambien es un fallo, y una lista deduplicada lo taparia.
   */
  it('salen ESTAS peticiones y ninguna mas', async () => {
    await darDeAlta();

    expect(rutasPedidas()).toEqual(['/packs', '/salas', '/usuarios/alumnos']);
  });

  it('la clave no entra nunca en la cache de CONSULTAS', async () => {
    const { cliente } = await darDeAlta();

    const consultas = JSON.stringify(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.state.data),
    );

    expect(consultas).not.toContain(PREFIJO_DE_LA_CLAVE);
  });

  /**
   * TRAS «LISTO», NI EN LA DE MUTACIONES.
   *
   * `useMutation` deja la respuesta entera en `getMutationCache()`, y ese cache
   * es el del `QueryClient` de TODA la aplicacion: sin limpiarlo, la clave sigue
   * ahi cinco minutos (el `gcTime` por defecto) despues de que el admin cerro la
   * pantalla y se fue del mostrador, legible desde la consola.
   */
  it('tras «Listo» no queda ni en la cache de mutaciones', async () => {
    const { sesion, cliente } = await darDeAlta();

    await sesion.click(screen.getByLabelText(/ya la anote/i));
    await sesion.click(screen.getByRole('button', { name: /listo/i }));
    await esperar();

    expect(volcadoDelCliente(cliente)).not.toContain(PREFIJO_DE_LA_CLAVE);
  });
});

// ---------------------------------------------------------------------------
// Los dos formularios NO son el mismo
// ---------------------------------------------------------------------------

describe('el formulario de profesor', () => {
  it('no tiene campos de alumno', async () => {
    montar({ tipo: 'profesor' });
    await esperar();

    expect(screen.queryByLabelText(/pack/i)).toBeNull();
    expect(screen.queryByLabelText(/vigencia/i)).toBeNull();
    expect(screen.queryByLabelText(/clases extra/i)).toBeNull();
    expect(screen.queryByLabelText(/ficha medica/i)).toBeNull();
  });

  /**
   * LISTA BLANCA DEL CUERPO: el conjunto ENTERO de claves.
   *
   * Con `forbidNonWhitelisted: true` en el ValidationPipe global, un campo de
   * mas no se ignora: es un 400 y el alta no se hace. Comprobar la ausencia de
   * uno concreto va siempre un campo por detras.
   */
  it('no manda campos de alumno en el cuerpo', async () => {
    const { sesion } = montar({ tipo: 'profesor' });
    await esperar();
    await completarYEnviar(sesion);

    expect(Object.keys(cuerpoDelAlta()).sort()).toEqual(['email', 'nombreCompleto', 'salaIds']);
  });

  it('pega contra el endpoint de profesores', async () => {
    const { sesion } = montar({ tipo: 'profesor' });
    await esperar();
    await completarYEnviar(sesion);

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios/profesores', expect.anything());
  });

  it('no pide el catalogo de packs: no tiene donde pintarlo', async () => {
    const { sesion } = montar({ tipo: 'profesor' });
    await esperar();
    await completarYEnviar(sesion);

    expect(rutasPedidas()).toEqual(['/salas', '/usuarios/profesores']);
  });

  it('el telefono, cuando lo hay, SI va: es el unico opcional que acepta', async () => {
    const { sesion } = montar({ tipo: 'profesor' });
    await esperar();

    await sesion.type(screen.getByLabelText('Telefono'), '+54 11 5555-5555');
    await completarYEnviar(sesion);

    expect(Object.keys(cuerpoDelAlta()).sort()).toEqual([
      'email',
      'nombreCompleto',
      'salaIds',
      'telefono',
    ]);
  });
});

describe('el formulario de alumno', () => {
  it('pega contra el endpoint de alumnos', async () => {
    const { sesion } = montar();
    await esperar();
    await completarYEnviar(sesion);

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios/alumnos', expect.anything());
  });

  it('los opcionales vacios NO se mandan vacios: se omiten', async () => {
    // `telefono: ''` pasa el `@IsOptional()` y guarda una cadena vacia en la
    // base. `vigenciaDesde: ''` no pasa el `@Matches` y es un 400.
    const { sesion } = montar();
    await esperar();
    await completarYEnviar(sesion);

    expect(Object.keys(cuerpoDelAlta()).sort()).toEqual(['email', 'nombreCompleto', 'salaIds']);
  });

  it('manda los campos de alumno que se completaron, y con su tipo', async () => {
    const { sesion } = montar();
    await esperar();

    await sesion.selectOptions(screen.getByLabelText('Pack'), 'pack-1');
    await sesion.type(screen.getByLabelText('Clases extra'), '3');
    await sesion.type(screen.getByLabelText('Vigencia desde'), '2026-01-01');
    await sesion.type(screen.getByLabelText('Ficha medica'), 'Asma');
    await completarYEnviar(sesion);

    expect(cuerpoDelAlta()).toEqual({
      nombreCompleto: 'Ana Gomez',
      email: 'ana@gym.test',
      salaIds: [],
      packId: 'pack-1',
      // NUMERO, no texto: `@IsInt()` rechaza `"3"`.
      clasesExtra: 3,
      vigenciaDesde: '2026-01-01',
      fichaMedica: 'Asma',
    });
  });

  it('`salaIds` viaja SIEMPRE, aunque este vacio', async () => {
    // El DTO lo exige como campo. Sin salas el alta sale igual, con la
    // advertencia SIN_SALAS, y esa es la decision consciente que se busca.
    const { sesion } = montar();
    await esperar();
    await completarYEnviar(sesion);

    expect(cuerpoDelAlta().salaIds).toEqual([]);
  });

  it('las salas marcadas viajan por id', async () => {
    const { sesion } = montar();
    await esperar();

    await sesion.click(screen.getByLabelText('Sala chica'));
    await completarYEnviar(sesion);

    expect(cuerpoDelAlta().salaIds).toEqual(['sala-2']);
  });
});

// ---------------------------------------------------------------------------
// El tipo sale de la URL
// ---------------------------------------------------------------------------

describe('que se da de alta', () => {
  it('sin `tipo` en la URL es un alumno', async () => {
    const { sesion } = montar({ busqueda: '' });
    await esperar();
    await completarYEnviar(sesion);

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios/alumnos', expect.anything());
  });

  it('un `tipo` que la API no conoce cae en alumno, no revienta', async () => {
    // La URL la escribe cualquiera. `?tipo=SUPERADMIN` no puede inventar un
    // endpoint ni pintar un formulario a medias.
    const { sesion } = montar({ busqueda: '?tipo=SUPERADMIN' });
    await esperar();
    await completarYEnviar(sesion);

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios/alumnos', expect.anything());
  });

  it('el encabezado dice a quien se esta dando de alta', async () => {
    montar({ tipo: 'profesor' });
    await esperar();

    expect(screen.getByRole('heading', { name: /profesor/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Lo que no llega a salir, y lo que falla
// ---------------------------------------------------------------------------

describe('validacion y fallos', () => {
  it('sin nombre ni email no se molesta al servidor', async () => {
    const { sesion } = montar();
    await esperar();

    await sesion.click(screen.getByRole('button', { name: /dar de alta/i }));
    await esperar();

    expect(pedirEspia.mock.calls.map((llamada: unknown[]) => llamada[0])).not.toContain(
      '/usuarios/alumnos',
    );
    expect(screen.getByText(/hace falta el nombre/i)).toBeInTheDocument();
  });

  it('un email invalido no llega al servidor', async () => {
    const { sesion } = montar();
    await esperar();

    await sesion.type(screen.getByLabelText('Nombre completo'), 'Ana Gomez');
    await sesion.type(screen.getByLabelText('Email'), 'ana-arroba-nada');
    await sesion.click(screen.getByRole('button', { name: /dar de alta/i }));
    await esperar();

    expect(pedirEspia.mock.calls.map((llamada: unknown[]) => llamada[0])).not.toContain(
      '/usuarios/alumnos',
    );
  });

  it('el error de la API se muestra tal cual', async () => {
    const { sesion } = montar({ errorDelAlta: new ErrorDeApi('Ese email ya existe', 409) });
    await esperar();
    await completarYEnviar(sesion);

    expect(screen.getByText(/ese email ya existe/i)).toBeInTheDocument();
  });

  it('tras un fallo el formulario sigue ahi, con lo que ya se habia escrito', async () => {
    // Volver a escribir un alta entera porque el email estaba repetido es lo
    // que hace que el admin la cargue en un papel y la pase "despues".
    const { sesion } = montar({ errorDelAlta: new ErrorDeApi('Ese email ya existe', 409) });
    await esperar();
    await completarYEnviar(sesion);

    expect(screen.getByLabelText('Nombre completo')).toHaveValue('Ana Gomez');
    expect(screen.getByRole('button', { name: /dar de alta/i })).toBeInTheDocument();
  });

  it('un fallo no deja la pantalla de la clave a medias', async () => {
    const { sesion } = montar({ errorDelAlta: new ErrorDeApi('Ese email ya existe', 409) });
    await esperar();
    await completarYEnviar(sesion);

    // Por el marcado: la pantalla de la clave ES el `role="dialog"`, y si
    // quedara dibujada escondida seria ahi donde viviria la contrasena.
    expect(rolesDelDocumento('dialog')).toBe(0);
    expect(empujar).not.toHaveBeenCalled();
  });
});
