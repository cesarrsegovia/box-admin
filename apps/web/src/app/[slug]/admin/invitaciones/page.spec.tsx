import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ClaveInvitacionPublica, PackPublico, SalaPublica } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { espiarLaConsola, SECRETOS_DEL_PANEL } from '@/test/espia-de-consola';
import { CAMPOS_DE_LA_CLAVE } from './formulario';
import PaginaDeInvitaciones from './page';

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/mi-gym/admin/invitaciones',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Lo que se audita aqui es el CUERPO que la pantalla manda, que es justo donde
 * un campo de mas es un 400 (`forbidNonWhitelisted`), y el conjunto de rutas
 * que pide. `ErrorDeApi` se deja REAL: la pantalla ramifica con `instanceof`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------

/**
 * El centinela: lo que NO puede aparecer en sitios donde no se mira.
 *
 * A diferencia de la contraseña temporal del alta, este codigo SI tiene que
 * estar en el DOM —es la columna "Codigo"— asi que un test de "no aparece en el
 * HTML" aqui no sirve de nada. Lo que se vigila es todo lo demas: los almacenes
 * del navegador, las dos caches, los cuerpos que salen, la consola y el titulo
 * de la pagina.
 *
 * Sale de `SECRETOS_DEL_PANEL` y no de una cadena escrita aqui porque el tapon
 * del titulo —global, en `vitest.setup.ts`— vigila esa misma constante: con dos
 * copias, cambiar esta dejaria al tapon buscando algo que ya no se siembra.
 */
const CODIGO = SECRETOS_DEL_PANEL.codigoDeInvitacion;

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
  {
    id: 'pack-viejo',
    tenantId: 't1',
    nombre: 'Promo que ya no se vende',
    salaId: null,
    tipo: 'MENSUAL',
    precio: '9000.00',
    clasesPorMes: 4,
    clasesTotales: null,
    cancelacionesPermitidas: 1,
    activo: false,
  },
];

function unaClave(cambios: Partial<ClaveInvitacionPublica> = {}): ClaveInvitacionPublica {
  return {
    id: 'clave-1',
    tenantId: 't-del-gimnasio',
    codigo: CODIGO,
    nombre: 'Promo verano',
    activa: true,
    usosMax: null,
    usosActuales: 0,
    expiraEn: null,
    packId: null,
    salaIds: ['sala-1'],
    ...cambios,
  };
}

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

interface OpcionesDeMontaje {
  claves?: ClaveInvitacionPublica[];
  /** Lo que devuelve el GET de la lista cuando falla. */
  error?: unknown;
  /** Lo que devuelve el POST o el PATCH cuando falla. */
  errorAlGuardar?: unknown;
}

function montar(opciones: OpcionesDeMontaje = {}) {
  const { claves = [], error, errorAlGuardar } = opciones;

  pedirEspia.mockImplementation((ruta: string, peticion?: { metodo?: string }) => {
    if (ruta === '/salas') return Promise.resolve(SALAS);
    if (ruta === '/packs') return Promise.resolve(PACKS);

    // Las escrituras llevan `metodo`; la lista no.
    if (peticion?.metodo !== undefined) {
      return errorAlGuardar === undefined
        ? // Lo que la API devuelve de verdad: la clave entera, CON su codigo.
          // Se devuelve a proposito para que el test pueda comprobar que la
          // pantalla no se lo queda guardado en ningun lado.
          Promise.resolve(unaClave({ id: 'clave-nueva' }))
        : Promise.reject(errorAlGuardar);
    }

    return error === undefined ? Promise.resolve(claves) : Promise.reject(error);
  });

  const sesion = userEvent.setup();

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeInvitaciones />
    </QueryClientProvider>,
  );

  return { sesion, cliente };
}

/** Deja que las consultas y las mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function montarYEsperar(opciones: OpcionesDeMontaje = {}) {
  const montaje = montar(opciones);
  await esperar();
  return montaje;
}

/**
 * Los encabezados QUE HAY EN EL MARCADO.
 *
 * `document.querySelectorAll` y no `getAllByRole('columnheader')`: el arbol de
 * accesibilidad excluye por su cuenta lo que lleva `hidden` o `aria-hidden`, y
 * el `<thead>` de esta tabla esta oculto en telefono con una clase de Tailwind.
 */
function columnasDelDocumento(): string[] {
  return [...document.querySelectorAll('th')].map((th) => th.textContent?.trim() ?? '');
}

/** El estado de cada fila, leido del atributo y no del texto. */
function estadosDelDocumento(): (string | null)[] {
  return [...document.querySelectorAll('[data-estado]')].map((nodo) =>
    nodo.getAttribute('data-estado'),
  );
}

/** El contenido de cada fila, celda a celda. */
function filasDelDocumento(): string[][] {
  return [...document.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

/**
 * LOS CAMPOS QUE HAY DENTRO DEL `<form>`, SIN PASAR POR LA ACCESIBILIDAD.
 *
 * `queryByLabelText` consulta el arbol de accesibilidad, que ya excluye lo que
 * lleva `hidden`, `aria-hidden` o `display:none`. Con el se puede afirmar que
 * un campo no SE VE, no que no ESTA — y un campo oculto sigue dentro del
 * formulario y viaja igual en el cuerpo. Con `forbidNonWhitelisted` eso es un
 * 400 que tira la peticion entera.
 *
 * Se devuelve el conjunto ENTERO y ordenado, para compararlo contra la lista
 * blanca: una lista negra ("que no este `codigo`") siempre va un campo por
 * detras.
 */
function camposDelFormulario(): string[] {
  const formulario = document.querySelector('form');
  if (formulario === null) throw new Error('No hay formulario en pantalla');

  const nombres = [...formulario.querySelectorAll('input, select, textarea')].map(
    (control) => control.getAttribute('name') ?? control.getAttribute('id') ?? '(sin nombre)',
  );

  return [...new Set(nombres)].sort();
}

interface Escritura {
  ruta: string;
  metodo: string;
  cuerpo: Record<string, unknown>;
}

/** Las peticiones que CAMBIAN algo: las unicas que llevan `metodo`. */
function escrituras(): Escritura[] {
  return pedirEspia.mock.calls
    .filter((llamada: unknown[]) => {
      const peticion = llamada[1];
      return typeof peticion === 'object' && peticion !== null && 'metodo' in peticion;
    })
    .map((llamada: unknown[]) => {
      const peticion = llamada[1] as { metodo: string; cuerpo?: Record<string, unknown> };
      return { ruta: String(llamada[0]), metodo: peticion.metodo, cuerpo: peticion.cuerpo ?? {} };
    });
}

/** La UNICA escritura que se espera en un test. Revienta si hubo otra. */
function laEscritura(): Escritura {
  const todas = escrituras();
  if (todas.length !== 1) {
    throw new Error(`Se esperaba 1 escritura y hubo ${todas.length}: ${JSON.stringify(todas)}`);
  }
  return todas[0] as Escritura;
}

/** Todas las rutas que la pantalla pidio, sin quitar repetidas. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map((llamada: unknown[]) => String(llamada[0]));
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

/** TODO lo que el `QueryClient` tiene guardado: consultas Y mutaciones. */
function volcadoDelCliente(cliente: QueryClient): string {
  return JSON.stringify({
    consultas: cliente
      .getQueryCache()
      .getAll()
      .map((consulta) => ({ clave: consulta.queryKey, datos: consulta.state.data })),
    mutaciones: cliente
      .getMutationCache()
      .getAll()
      .map((mutacion) => ({ datos: mutacion.state.data, variables: mutacion.state.variables })),
  });
}

// ---------------------------------------------------------------------------
// Acciones de la pantalla
// ---------------------------------------------------------------------------

type Sesion = ReturnType<typeof userEvent.setup>;

async function abrirElAlta(sesion: Sesion): Promise<void> {
  await sesion.click(screen.getByRole('button', { name: 'Nueva clave' }));
  await esperar();
}

interface Relleno {
  nombre?: string;
  salas?: string[];
  pack?: string;
  usosMax?: string;
  vence?: string;
}

async function rellenar(sesion: Sesion, datos: Relleno = {}): Promise<void> {
  const { nombre = 'Promo verano', salas = ['Sala grande'] } = datos;

  if (nombre !== '') await sesion.type(screen.getByLabelText('Nombre'), nombre);
  for (const sala of salas) await sesion.click(screen.getByLabelText(sala));
  if (datos.pack !== undefined)
    await sesion.selectOptions(screen.getByLabelText('Pack'), datos.pack);
  if (datos.usosMax !== undefined)
    await sesion.type(screen.getByLabelText('Usos maximos'), datos.usosMax);
  if (datos.vence !== undefined) await sesion.type(screen.getByLabelText('Vence el'), datos.vence);
}

async function enviar(sesion: Sesion, texto: string): Promise<void> {
  await sesion.click(screen.getByRole('button', { name: texto }));
  await esperar();
}

// ---------------------------------------------------------------------------
// El tapon de la consola, en CADA test de este archivo
// ---------------------------------------------------------------------------

/**
 * Lo que la pantalla DICE fuera del DOM.
 *
 * Un `console.info('[invitaciones]', clave)` sobrevive a todos los tests de
 * abajo —miran el DOM, los cuerpos, las rutas, los almacenes y las dos caches—
 * y deja la credencial en el buffer de la consola de una maquina de mostrador
 * que usan cuatro personas por turno.
 */
let comprobarLaConsola: (centinela: string) => void = () => {};

beforeEach(() => {
  comprobarLaConsola = espiarLaConsola();
});

afterEach(() => {
  comprobarLaConsola(CODIGO);

  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// El listado
// ---------------------------------------------------------------------------

describe('el listado de claves', () => {
  // LISTA BLANCA: el conjunto ENTERO. Una columna de mas —con el `tenantId`
  // dentro, por ejemplo— no la ve ningun test de presencia.
  it('muestra ESTAS columnas y solo estas', async () => {
    await montarYEsperar({ claves: [unaClave()] });

    expect(columnasDelDocumento()).toEqual([
      'Nombre',
      'Codigo',
      'Estado',
      'Usos',
      'Vence',
      'Acciones',
    ]);
  });

  it('sin claves lo dice, y no deja una tabla vacia', async () => {
    await montarYEsperar({ claves: [] });

    expect(screen.getByText(/todavia no hay ninguna clave/i)).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
  });

  it('el codigo se ve entero: es lo que el alumno tiene que escribir', async () => {
    await montarYEsperar({ claves: [unaClave()] });

    expect(screen.getByText(CODIGO)).toBeInTheDocument();
  });

  it('al tenantId no lo pinta ninguna columna', async () => {
    await montarYEsperar({ claves: [unaClave({ tenantId: 'tenant-secreto' })] });

    expect(document.body.innerHTML).not.toContain('tenant-secreto');
  });

  it('pintar el listado es UNA sola peticion: el catalogo no se pide hasta abrir el formulario', async () => {
    await montarYEsperar({ claves: [unaClave()] });

    expect(rutasPedidas()).toEqual(['/invitaciones']);
  });
});

// ---------------------------------------------------------------------------
// Los tres estados
// ---------------------------------------------------------------------------

describe('en que esta cada clave', () => {
  const EN_EL_PASADO = '2020-01-01T00:00:00.000Z';
  const EN_EL_FUTURO = '2999-01-01T00:00:00.000Z';

  function lasCuatro(): ClaveInvitacionPublica[] {
    return [
      unaClave({ id: 'c-activa', nombre: 'Sirve', activa: true }),
      unaClave({ id: 'c-agotada', nombre: 'Gastada', activa: true, usosMax: 5, usosActuales: 5 }),
      unaClave({ id: 'c-vencida', nombre: 'Caducada', activa: true, expiraEn: EN_EL_PASADO }),
      unaClave({ id: 'c-apagada', nombre: 'Apagada', activa: false }),
    ];
  }

  it('una agotada y una vencida NO se leen igual que una desactivada a mano', async () => {
    await montarYEsperar({ claves: lasCuatro() });

    expect(estadosDelDocumento()).toEqual(['activa', 'agotada', 'vencida', 'desactivada']);
  });

  it('y tampoco se VEN igual: tres colores para las tres cosas que puede hacer el admin', async () => {
    await montarYEsperar({ claves: lasCuatro() });

    const clases = [...document.querySelectorAll('[data-estado]')].map((nodo) => ({
      estado: nodo.getAttribute('data-estado'),
      clase: nodo.getAttribute('class'),
    }));

    const porEstado = Object.fromEntries(clases.map(({ estado, clase }) => [estado, clase]));

    // Agotada y vencida comparten color (se arreglan igual) pero ninguna de las
    // dos puede parecerse a la que apago una persona, que es la unica que el
    // boton de la fila puede volver a prender.
    expect(porEstado.agotada).toBe(porEstado.vencida);
    expect(porEstado.agotada).not.toBe(porEstado.desactivada);
    expect(porEstado.activa).not.toBe(porEstado.desactivada);
    expect(porEstado.activa).not.toBe(porEstado.agotada);
  });

  it('una apagada a mano Y agotada se lee como apagada: es lo unico que se puede cambiar', async () => {
    await montarYEsperar({
      claves: [unaClave({ activa: false, usosMax: 3, usosActuales: 3 })],
    });

    expect(estadosDelDocumento()).toEqual(['desactivada']);
  });

  it('una que todavia no vencio sigue activa', async () => {
    await montarYEsperar({ claves: [unaClave({ expiraEn: EN_EL_FUTURO })] });

    expect(estadosDelDocumento()).toEqual(['activa']);
  });

  it('sin tope dice ILIMITADA, que no es lo mismo que cero', async () => {
    await montarYEsperar({
      claves: [
        unaClave({ id: 'c1', nombre: 'Sin tope', usosMax: null, usosActuales: 7 }),
        unaClave({ id: 'c2', nombre: 'Con tope', usosMax: 10, usosActuales: 7 }),
      ],
    });

    const usos = filasDelDocumento().map((celdas) => celdas[3]);
    expect(usos).toEqual(['7 (ilimitada)', '7/10']);
  });

  it('sin fecha dice que no vence, y con fecha dice el dia', async () => {
    await montarYEsperar({
      claves: [
        unaClave({ id: 'c1', expiraEn: null }),
        unaClave({ id: 'c2', expiraEn: '2999-03-04T00:00:00.000Z' }),
      ],
    });

    const vence = filasDelDocumento().map((celdas) => celdas[4]);
    expect(vence).toEqual(['No vence', '2999-03-04']);
  });
});

// ---------------------------------------------------------------------------
// El codigo NO se edita
// ---------------------------------------------------------------------------

describe('el codigo es una credencial ya repartida', () => {
  async function abrirLaEdicion(): Promise<Sesion> {
    const { sesion } = await montarYEsperar({ claves: [unaClave()] });
    await sesion.click(screen.getByRole('button', { name: 'Editar Promo verano' }));
    await esperar();
    return sesion;
  }

  /**
   * SE AFIRMA SOBRE EL MARCADO, NO SOBRE LA ACCESIBILIDAD.
   *
   * `queryByLabelText('Codigo')` devolveria null tambien para un campo con
   * `hidden`, y ese campo seguiria dentro del `<form>` y viajaria en el cuerpo:
   * un 400 por `forbidNonWhitelisted`, y la edicion entera perdida.
   */
  it('el formulario de edicion NO tiene un campo `codigo`', async () => {
    await abrirLaEdicion();

    expect(camposDelFormulario()).toEqual([...CAMPOS_DE_LA_CLAVE].sort());
  });

  it('y la lista blanca del formulario es la que la API acepta, sin `codigo` dentro', () => {
    expect([...CAMPOS_DE_LA_CLAVE]).not.toContain('codigo');
  });

  it('el codigo tampoco se enseña dentro del formulario: ya esta en su columna', async () => {
    await abrirLaEdicion();

    const formulario = document.querySelector('form');
    expect(formulario?.innerHTML).not.toContain(CODIGO);
  });

  it('el cuerpo de la edicion no lleva `codigo`', async () => {
    const sesion = await abrirLaEdicion();

    await enviar(sesion, 'Guardar cambios');

    expect(Object.keys(laEscritura().cuerpo)).not.toContain('codigo');
  });
});

// ---------------------------------------------------------------------------
// Crear
// ---------------------------------------------------------------------------

describe('crear una clave', () => {
  it('exige un nombre, y sin el no llega al servidor', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion, { nombre: '' });
    await enviar(sesion, 'Crear clave');

    expect(escrituras()).toEqual([]);
    expect(screen.getByText(/hace falta un nombre/i)).toBeInTheDocument();
  });

  /**
   * SIN SALA NO SALE LA PETICION.
   *
   * `@ArrayNotEmpty()` la rechazaria con un 400. Avisar antes ahorra el viaje y,
   * sobre todo, explica el motivo real: una clave sin salas produce alumnos que
   * se registran bien y despues no pueden reservar nada.
   */
  it('exige al menos una sala, y sin ella no llega al servidor', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion, { salas: [] });
    await enviar(sesion, 'Crear clave');

    expect(escrituras()).toEqual([]);
    expect(screen.getByText(/al menos una sala/i)).toBeInTheDocument();
  });

  // LISTA BLANCA DEL CUERPO: el conjunto ENTERO de claves. Un campo de mas es un
  // 400 por `forbidNonWhitelisted`, no un campo que la API ignora.
  it('con todo relleno manda EXACTAMENTE estas claves', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion, {
      nombre: 'Promo verano',
      salas: ['Sala grande', 'Sala chica'],
      pack: 'pack-1',
      usosMax: '20',
      vence: '2999-12-31',
    });
    await enviar(sesion, 'Crear clave');

    const escritura = laEscritura();

    expect(escritura.ruta).toBe('/invitaciones');
    expect(escritura.metodo).toBe('POST');
    expect(escritura.cuerpo).toEqual({
      nombre: 'Promo verano',
      salaIds: ['sala-1', 'sala-2'],
      packId: 'pack-1',
      usosMax: 20,
      expiraEn: '2999-12-31',
    });
  });

  it('sin opcionales manda solo lo obligatorio: un vacio NO se manda vacio', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    expect(laEscritura().cuerpo).toEqual({ nombre: 'Promo verano', salaIds: ['sala-1'] });
  });

  /**
   * VACIO ES ILIMITADA, Y NO CERO.
   *
   * `Number('')` es 0, y un `usosMax: 0` es una clave que no sirve para nadie.
   * La API lo rechaza con `@Min(1)`, asi que el fallo seria un 400; pero el daño
   * de verdad seria que pasara: una tanda entera de alumnos sin poder darse de
   * alta y nadie entendiendo por que.
   */
  it('«Usos maximos» vacio significa ILIMITADA: no viaja la clave, y menos un cero', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    const cuerpo = laEscritura().cuerpo;
    expect(Object.keys(cuerpo).sort()).toEqual(['nombre', 'salaIds']);
    expect(cuerpo.usosMax).toBeUndefined();
  });

  it('un cero escrito a mano no llega al servidor: se explica que vacio es lo ilimitado', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion, { usosMax: '0' });
    await enviar(sesion, 'Crear clave');

    expect(escrituras()).toEqual([]);
    expect(screen.getByText(/dejalo vacio para que sea ilimitada/i)).toBeInTheDocument();
  });

  it('el numero viaja como numero, no como el texto del `<input>`', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion, { usosMax: '5' });
    await enviar(sesion, 'Crear clave');

    expect(laEscritura().cuerpo.usosMax).toBe(5);
  });

  it('no ofrece packs dados de baja: invitar con uno es un 400 de la API', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    const opciones = [...screen.getByLabelText('Pack').querySelectorAll('option')].map(
      (option) => option.getAttribute('value') ?? '',
    );

    expect(opciones).toEqual(['', 'pack-1']);
  });

  it('el catalogo se pide al abrir el formulario, y una sola vez cada cosa', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    expect(rutasPedidas().sort()).toEqual(['/invitaciones', '/packs', '/salas']);
  });

  it('al terminar se cierra el formulario y se vuelve a pedir la lista', async () => {
    const { sesion } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    expect(document.querySelector('form')).toBeNull();
    expect(rutasPedidas().filter((ruta) => ruta === '/invitaciones').length).toBeGreaterThan(1);
  });

  it('un fallo de la API deja el formulario donde estaba, con lo que ya se escribio', async () => {
    const { sesion } = await montarYEsperar({
      errorAlGuardar: new ErrorDeApi('No se pudo', 400, { message: ['nombre ya existe'] }),
    });
    await abrirElAlta(sesion);

    await rellenar(sesion, { nombre: 'Promo verano' });
    await enviar(sesion, 'Crear clave');

    expect(screen.getByLabelText('Nombre')).toHaveValue('Promo verano');
    expect(screen.getByText(/nombre ya existe/i)).toBeInTheDocument();
  });

  it('un 403 de la API se explica por el rol, no como «algo salio mal»', async () => {
    const { sesion } = await montarYEsperar({
      errorAlGuardar: new ErrorDeApi('Forbidden', 403),
    });
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    // El reparto por campo manda las frases que nombran un campo a su campo; el
    // 403 no nombra ninguno y queda suelto, en el cartel de arriba.
    expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------

describe('editar una clave', () => {
  const CARGADA = unaClave({
    nombre: 'Promo verano',
    usosMax: 10,
    usosActuales: 2,
    expiraEn: '2999-06-01T00:00:00.000Z',
    packId: 'pack-1',
    salaIds: ['sala-2'],
  });

  async function abrir(): Promise<Sesion> {
    const { sesion } = await montarYEsperar({ claves: [CARGADA] });
    await sesion.click(screen.getByRole('button', { name: 'Editar Promo verano' }));
    await esperar();
    return sesion;
  }

  it('llega con lo que la clave ya tiene', async () => {
    await abrir();

    expect(screen.getByLabelText('Nombre')).toHaveValue('Promo verano');
    expect(screen.getByLabelText('Usos maximos')).toHaveValue(10);
    expect(screen.getByLabelText('Vence el')).toHaveValue('2999-06-01');
    expect(screen.getByLabelText('Pack')).toHaveValue('pack-1');
    expect(screen.getByLabelText('Sala chica')).toBeChecked();
    expect(screen.getByLabelText('Sala grande')).not.toBeChecked();
  });

  it('va por PATCH a SU id y manda EXACTAMENTE estas claves', async () => {
    const sesion = await abrir();

    await enviar(sesion, 'Guardar cambios');

    const escritura = laEscritura();

    expect(escritura.ruta).toBe('/invitaciones/clave-1');
    expect(escritura.metodo).toBe('PATCH');
    expect(escritura.cuerpo).toEqual({
      nombre: 'Promo verano',
      salaIds: ['sala-2'],
      packId: 'pack-1',
      usosMax: 10,
      expiraEn: '2999-06-01',
    });
  });

  it('las salas viajan ENTERAS: el PATCH reemplaza el conjunto, no lo suma', async () => {
    const sesion = await abrir();

    await sesion.click(screen.getByLabelText('Sala grande'));
    await enviar(sesion, 'Guardar cambios');

    expect(laEscritura().cuerpo.salaIds).toEqual(['sala-2', 'sala-1']);
  });

  it('tampoco al editar se puede dejar la clave sin salas', async () => {
    const sesion = await abrir();

    await sesion.click(screen.getByLabelText('Sala chica'));
    await enviar(sesion, 'Guardar cambios');

    expect(escrituras()).toEqual([]);
  });

  it('cancelar cierra el formulario sin mandar nada', async () => {
    const sesion = await abrir();

    await sesion.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(document.querySelector('form')).toBeNull();
    expect(escrituras()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Prender y apagar
// ---------------------------------------------------------------------------

describe('desactivar una clave', () => {
  async function pedirDesactivar(nombre = 'Promo verano'): Promise<Sesion> {
    const { sesion } = await montarYEsperar({ claves: [unaClave({ nombre })] });
    await sesion.click(screen.getByRole('button', { name: `Desactivar ${nombre}` }));
    await esperar();
    return sesion;
  }

  /**
   * EL DIALOGO NOMBRA LA CLAVE.
   *
   * Un "¿estas seguro?" sobre una tabla de diez filas lo confirma cualquiera
   * sobre la fila equivocada, y lo que se apaga es el alta de una tanda entera
   * de alumnos que ya tienen el papel con el codigo.
   */
  it('pregunta NOMBRANDO la clave antes de apagarla', async () => {
    await pedirDesactivar('Promo verano');

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('Promo verano');
  });

  it('y hasta que no se confirma no sale ninguna peticion', async () => {
    await pedirDesactivar();

    expect(escrituras()).toEqual([]);
  });

  it('cancelar no manda nada y cierra el dialogo', async () => {
    const sesion = await pedirDesactivar();

    await sesion.click(screen.getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(escrituras()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirmar manda EXACTAMENTE `{ activa: false }`', async () => {
    const sesion = await pedirDesactivar();

    await sesion.click(screen.getByRole('button', { name: 'Desactivar' }));
    await esperar();

    const escritura = laEscritura();

    expect(escritura.ruta).toBe('/invitaciones/clave-1');
    expect(escritura.metodo).toBe('PATCH');
    expect(escritura.cuerpo).toEqual({ activa: false });
  });

  it('activar NO pregunta: no rompe nada y se deshace con el boton de al lado', async () => {
    const { sesion } = await montarYEsperar({ claves: [unaClave({ activa: false })] });

    await sesion.click(screen.getByRole('button', { name: 'Activar Promo verano' }));
    await esperar();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(laEscritura().cuerpo).toEqual({ activa: true });
  });
});

// ---------------------------------------------------------------------------
// Los fallos del listado
// ---------------------------------------------------------------------------

describe('cuando la lista falla', () => {
  it('un 401 manda al login de SU gimnasio, con la vuelta a esta pantalla, UNA vez', async () => {
    await montarYEsperar({ error: new ErrorDeApi('Sin sesion', 401) });

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/invitaciones')}`,
    );
    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('un 401 NO ofrece reintentar: reintentar sin sesion es volver a fallar', async () => {
    await montarYEsperar({ error: new ErrorDeApi('Sin sesion', 401) });

    const botones = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(botones).not.toContain('Reintentar');
  });

  it('un error de red se puede reintentar y NO manda al login', async () => {
    const { sesion } = await montarYEsperar({ error: new ErrorDeApi('Sin conexion', 0) });

    expect(empujar).not.toHaveBeenCalled();

    await sesion.click(screen.getByRole('button', { name: 'Reintentar' }));
    await esperar();

    expect(rutasPedidas().filter((ruta) => ruta === '/invitaciones').length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// DONDE NO PUEDE QUEDAR COPIA DEL CODIGO
// ---------------------------------------------------------------------------

/**
 * El codigo SI esta en el DOM: es la columna que el admin lee en voz alta por
 * telefono. Por eso aqui no sirve el test de "no aparece en el HTML" que usan
 * las otras pantallas de la fase, y hay que mirar los sitios donde una copia
 * sobrevive a la pantalla.
 */
describe('el codigo no deja copias donde no se mira', () => {
  it('no se copia solo al portapapeles: copiar es una accion que se pide', async () => {
    const escribir = vi.fn<(texto: string) => Promise<void>>().mockResolvedValue(undefined);
    const { sesion } = await montarYEsperar({ claves: [unaClave()] });

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: escribir },
      configurable: true,
      writable: true,
    });

    expect(escribir).not.toHaveBeenCalled();

    await sesion.click(screen.getByRole('button', { name: 'Copiar el codigo de Promo verano' }));
    await esperar();

    expect(escribir).toHaveBeenCalledWith(CODIGO);
    expect(escribir).toHaveBeenCalledTimes(1);
  });

  /**
   * `localStorage` sobrevive al logout, al cierre del navegador y al cambio de
   * turno. Los dos almacenes ENTEROS, no una clave concreta: una lista negra
   * siempre va una clave por detras.
   */
  it('no queda nada en el almacenamiento del navegador', async () => {
    await montarYEsperar({ claves: [unaClave()] });

    expect({
      local: contenidoDe(localStorage),
      sesion: contenidoDe(sessionStorage),
    }).toEqual({ local: {}, sesion: {} });
  });

  /**
   * La respuesta del POST trae la clave recien creada CON SU CODIGO. El cache de
   * MUTACIONES —otro almacen, distinto del de consultas— la guardaria cinco
   * minutos por defecto, y `reset()` no vacia nada: solo programa el recolector.
   */
  it('tras crear una clave, su codigo no queda en la cache de mutaciones', async () => {
    const { sesion, cliente } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    expect(
      cliente
        .getMutationCache()
        .getAll()
        .map((mutacion) => JSON.stringify(mutacion.state)),
    ).not.toContainEqual(expect.stringContaining(CODIGO));
  });

  it('tras desactivar, la respuesta del PATCH tampoco queda guardada', async () => {
    const { sesion, cliente } = await montarYEsperar({ claves: [unaClave()] });

    await sesion.click(screen.getByRole('button', { name: 'Desactivar Promo verano' }));
    await sesion.click(screen.getByRole('button', { name: 'Desactivar' }));
    await esperar();

    const mutaciones = cliente
      .getMutationCache()
      .getAll()
      .map((mutacion) => JSON.stringify(mutacion.state));

    expect(mutaciones).not.toContainEqual(expect.stringContaining(CODIGO));
  });

  it('en la cache de consultas solo esta la lista, y nada mas', async () => {
    const { cliente } = await montarYEsperar({ claves: [unaClave()] });

    expect(
      cliente
        .getQueryCache()
        .getAll()
        .map((consulta) => consulta.queryKey),
    ).toEqual([['invitaciones']]);
  });

  it('ni el codigo ni nada suyo viaja en la URL', async () => {
    const { sesion } = await montarYEsperar({ claves: [unaClave()] });

    await sesion.click(screen.getByRole('button', { name: 'Editar Promo verano' }));
    await esperar();

    expect(window.location.search).not.toContain(CODIGO);
    for (const llamada of empujar.mock.calls) {
      expect(String(llamada[0])).not.toContain(CODIGO);
    }
  });

  it('el volcado entero del cliente no tiene el codigo fuera de la lista', async () => {
    const { sesion, cliente } = await montarYEsperar();
    await abrirElAlta(sesion);

    await rellenar(sesion);
    await enviar(sesion, 'Crear clave');

    // La lista SI puede tenerlo —es de donde sale la columna—, asi que se mira
    // el volcado quitando la consulta de la lista.
    const volcado = JSON.parse(volcadoDelCliente(cliente)) as {
      consultas: { clave: unknown[]; datos: unknown }[];
      mutaciones: unknown[];
    };

    const fueraDeLaLista = JSON.stringify({
      consultas: volcado.consultas.filter(({ clave }) => clave[0] !== 'invitaciones'),
      mutaciones: volcado.mutaciones,
    });

    expect(fueraDeLaLista).not.toContain(CODIGO);
  });

  it('el cuerpo que sale nunca lleva el codigo dentro', async () => {
    const { sesion } = await montarYEsperar({ claves: [unaClave()] });

    await sesion.click(screen.getByRole('button', { name: 'Editar Promo verano' }));
    await esperar();
    await enviar(sesion, 'Guardar cambios');

    expect(JSON.stringify(escrituras())).not.toContain(CODIGO);
  });
});
