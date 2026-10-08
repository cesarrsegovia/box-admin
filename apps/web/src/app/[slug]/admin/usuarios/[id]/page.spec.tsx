import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PackPublico,
  RolUsuario,
  RutinaPublica,
  SalaPublica,
  UsuarioDetalle,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeRutinas } from '@/hooks/use-rutinas';
import { SECRETOS_DEL_PANEL } from '@/test/espia-de-consola';
import { ProveedorDeRol } from '../../rol-del-panel';
import PaginaDeFicha from './page';

/**
 * El centinela de esta pantalla: la contraseña temporal que devuelve el reset.
 *
 * Sale de `SECRETOS_DEL_PANEL` y no de una cadena escrita aqui porque el tapon
 * del titulo —global, en `vitest.setup.ts`— vigila esa misma constante: con dos
 * copias, cambiar esta dejaria al tapon buscando algo que ya no se siembra.
 */
const CLAVE_DEL_RESET = SECRETOS_DEL_PANEL.claveDelReset;

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym', id: 'u1' }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin/usuarios/u1',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fijan `use-usuarios.spec` y el proxy. Lo
 * que se audita aqui es un escalon mas arriba: QUE pide la ficha y QUE cuerpo
 * manda. `ErrorDeApi` se deja REAL porque la pantalla ramifica con `instanceof`
 * y con `.estado`.
 */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

/**
 * Un alumno SIN `fichaMedica`.
 *
 * La ausencia de la clave no es un descuido del doble: `GET /usuarios/:id`
 * OMITE `fichaMedica` cuando el actor no alcanza `ADMIN_SALON`. El doble tiene
 * que poder reproducir ese caso, que es el peligroso.
 */
function unAlumno(cambios: Partial<UsuarioDetalle> = {}): UsuarioDetalle {
  return {
    id: 'u1',
    tenantId: 'tnt-centinela',
    nombreCompleto: 'Ana Perez',
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: 'p1',
    telefono: '11 4444-4444',
    packId: null,
    pagoAlDia: true,
    salaIds: ['sala-a'],
    clasesExtra: 0,
    cancelacionesUsadas: 0,
    vigenciaDesde: null,
    vigenciaHasta: null,
    pack: null,
    salas: [unaSala('sala-a', 'Pilates')],
    ...cambios,
  };
}

function unProfesor(cambios: Partial<UsuarioDetalle> = {}): UsuarioDetalle {
  return unAlumno({ rol: 'PROFESOR', nombreCompleto: 'Beto Diaz', ...cambios });
}

function unaSala(id: string, nombre: string): SalaPublica {
  return {
    id,
    tenantId: 'tnt-centinela',
    nombre,
    activa: true,
    visibleAlumnos: true,
    soloCuposLiberados: false,
    exclusiva: false,
    cupoBase: null,
    minMinutosCancelar: null,
    minMinutosAnotarse: null,
    listaEsperaHabilitada: null,
  };
}

function unPack(id: string, nombre: string): PackPublico {
  return {
    id,
    tenantId: 'tnt-centinela',
    nombre,
    salaId: null,
    tipo: 'MENSUAL',
    precio: '12500.00',
    clasesPorMes: 8,
    clasesTotales: null,
    cancelacionesPermitidas: 2,
    activo: true,
  };
}

function unaRutina(cambios: Partial<RutinaPublica> = {}): RutinaPublica {
  return {
    id: 'r1',
    tenantId: 'tnt-centinela',
    perfilId: 'p1',
    salaId: 'sala-a',
    nombre: 'Pilates',
    diaSemana: 2,
    horaInicio: '18:00',
    horaFin: '19:00',
    activa: true,
    desde: '2026-10-01',
    hasta: null,
    ...cambios,
  };
}

const SALAS = [unaSala('sala-a', 'Pilates'), unaSala('sala-b', 'Funcional')];
const PACKS = [unPack('pack-8', '8 clases'), unPack('pack-12', '12 clases')];

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface Respuestas {
  usuario: UsuarioDetalle;
  salas: SalaPublica[];
  packs: PackPublico[];
  rutinas: RutinaPublica[];
}

let respuestas: Respuestas;
let rolDeQuienMira: RolUsuario = 'ADMIN_OPERATIVO';
let falloDeEscritura: unknown = null;

/** La proxima ESCRITURA falla asi. Las lecturas siguen funcionando. */
function laApiFalla(error: unknown): void {
  falloDeEscritura = error;
}

function esEscritura(opciones: { metodo?: string } | undefined): boolean {
  return opciones?.metodo !== undefined && opciones.metodo !== 'GET';
}

/** Solo las peticiones que ESCRIBEN, que son las que auditan casi todos los tests. */
function escrituras(): [string, { metodo?: string; cuerpo?: unknown }][] {
  return pedirEspia.mock.calls.filter((llamada) =>
    esEscritura(llamada[1] as { metodo?: string } | undefined),
  ) as [string, { metodo?: string; cuerpo?: unknown }][];
}

/** Las rutas pedidas, en orden, escrituras incluidas. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

afterEach(() => {
  vi.clearAllMocks();
  falloDeEscritura = null;
  localStorage.clear();
  sessionStorage.clear();
});

interface OpcionesDeMontaje {
  usuario?: UsuarioDetalle;
  salas?: SalaPublica[];
  packs?: PackPublico[];
  rutinas?: RutinaPublica[];
  /** El rol de QUIEN MIRA, no el de la persona de la ficha. */
  rol?: RolUsuario;
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  respuestas = {
    usuario: opciones.usuario ?? unAlumno(),
    salas: opciones.salas ?? SALAS,
    packs: opciones.packs ?? PACKS,
    rutinas: opciones.rutinas ?? [],
  };

  rolDeQuienMira = opciones.rol ?? 'ADMIN_OPERATIVO';

  pedirEspia.mockImplementation((ruta: string, opcionesDePeticion?: { metodo?: string }) => {
    if (esEscritura(opcionesDePeticion) && falloDeEscritura !== null) {
      return Promise.reject(falloDeEscritura);
    }

    if (ruta.startsWith('/rutinas')) return Promise.resolve(respuestas.rutinas);
    if (ruta.startsWith('/salas')) return Promise.resolve(respuestas.salas);
    if (ruta.startsWith('/packs')) return Promise.resolve(respuestas.packs);
    if (ruta.startsWith('/usuarios') && ruta.endsWith('reset-password')) {
      return Promise.resolve({ usuarioId: 'u1', passwordTemporal: CLAVE_DEL_RESET });
    }
    return Promise.resolve(respuestas.usuario);
  });

  // `staleTime: Infinity` para que lo SEMBRADO no se vuelva a pedir. Sin eso,
  // `expect(pedirEspia).not.toHaveBeenCalled()` seria imposible de escribir y
  // cada test de "no llega al servidor" tendria que filtrar las lecturas.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

/**
 * Pinta la ficha DENTRO del proveedor de rol, que es como vive.
 *
 * El armazon del panel envuelve a sus `children` con el; montarla fuera seria
 * montar algo que en produccion no existe, y el rol saldria siempre `null`.
 */
async function pintar(cliente: QueryClient): Promise<void> {
  render(
    <QueryClientProvider client={cliente}>
      <ProveedorDeRol rol={rolDeQuienMira}>
        <PaginaDeFicha />
      </ProveedorDeRol>
    </QueryClientProvider>,
  );
  await Promise.resolve();
}

/**
 * Monta la ficha con TODO sembrado en la cache.
 *
 * Asi el primer pintado ya tiene los datos y `pedirEspia` queda limpio para que
 * los tests de "esto no llega al servidor" puedan mirarlo entero.
 */
async function montar(opciones: OpcionesDeMontaje = {}): Promise<QueryClient> {
  const cliente = prepararServidor(opciones);
  const usuario = respuestas.usuario;

  cliente.setQueryData(clavesDeUsuarios.uno('u1'), usuario);
  cliente.setQueryData(clavesDeCatalogos.salas(), respuestas.salas);
  cliente.setQueryData(clavesDeCatalogos.packs(), respuestas.packs);
  cliente.setQueryData(clavesDeRutinas.dePersona(usuario.perfilId), respuestas.rutinas);

  await pintar(cliente);
  pedirEspia.mockClear();

  return cliente;
}

/** Monta SIN sembrar: la pantalla tiene que pedirlo todo. */
async function montarPidiendo(opciones: OpcionesDeMontaje = {}): Promise<QueryClient> {
  const cliente = prepararServidor(opciones);
  await pintar(cliente);
  return cliente;
}

/** Deja que las consultas y mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

async function clicEn(nombre: string | RegExp): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

function enElDialogo() {
  return within(screen.getByRole('dialog'));
}

async function confirmarEnElDialogo(nombre: string | RegExp): Promise<void> {
  await userEvent.setup().click(enElDialogo().getByRole('button', { name: nombre }));
  await esperar();
}

/** Escribe en un campo reemplazando lo que hubiera. */
async function escribir(etiqueta: string | RegExp, texto: string): Promise<void> {
  const usuario = userEvent.setup();
  const campo = screen.getByLabelText(etiqueta);
  await usuario.clear(campo);
  if (texto !== '') await usuario.type(campo, texto);
}

/**
 * El error QUE EL CAMPO ANUNCIA, leido por donde lo leeria un lector de pantalla.
 *
 * No busca el texto en la pantalla: busca el nodo al que el `<input>` apunta con
 * `aria-describedby`. Un error pintado en un cartel de arriba devuelve `null`
 * aunque el texto este visible, que es justo lo que hay que distinguir.
 */
function errorDelCampo(etiqueta: string | RegExp): string | null {
  const campo = screen.getByLabelText(etiqueta);
  const id = campo.getAttribute('aria-describedby');
  if (id === null) return null;

  return document.getElementById(id)?.textContent ?? null;
}

/** Las etiquetas de todos los controles del bloque de datos. */
function camposDelFormularioDeDatos(): string[] {
  const formulario = document.querySelector('form[aria-label="Datos"]');
  if (formulario === null) throw new Error('No hay formulario de datos');

  return [...formulario.querySelectorAll('label')].map((label) => label.textContent?.trim() ?? '');
}

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `getAllByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`, asi que con el no se puede afirmar que algo NO
 * ESTA: se puede afirmar que no se ve, que es otra cosa. `querySelectorAll` no
 * sabe nada de accesibilidad y devuelve lo que el navegador recibio.
 *
 * `queryByLabelText` SI sirve para afirmar ausencia —se comprobo— porque busca
 * la relacion `label`/control en el DOM y tampoco mira visibilidad. El agujero
 * es especifico de las consultas `*ByRole`.
 */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

function diasFijosDelDocumento(): string[] {
  return [...document.querySelectorAll('ul[aria-label="Dias fijos"] > li')].map(
    (li) => li.querySelector('p')?.textContent?.trim() ?? '',
  );
}

// ---------------------------------------------------------------------------
// La carga
// ---------------------------------------------------------------------------

describe('la ficha de una persona', () => {
  it('pide la ficha de ESA persona', async () => {
    await montarPidiendo();
    await esperar();

    expect(pedirEspia).toHaveBeenCalledWith('/usuarios/u1');
  });

  it('muestra el nombre de la persona', async () => {
    await montar({ usuario: unAlumno({ nombreCompleto: 'Ana Perez' }) });

    expect(screen.getByRole('heading', { name: 'Ana Perez' })).toBeInTheDocument();
  });

  /**
   * LISTA BLANCA DE PETICIONES, el conjunto entero.
   *
   * Una peticion de mas al abrir una ficha no la ve ningun test de presencia, y
   * aqui lo que se traeria de mas son datos de salud y de contacto. Precargar
   * "la ficha siguiente" o el listado entero seria una linea invisible.
   */
  it('abrir la ficha pide ESTO y nada mas', async () => {
    await montarPidiendo({ usuario: unAlumno({ perfilId: 'p1' }) });
    await esperar();

    expect([...rutasPedidas()].sort()).toEqual(
      ['/packs', '/rutinas?perfilId=p1', '/salas', '/usuarios/u1'].sort(),
    );
  });

  it('un 401 manda al login de SU gimnasio conservando la vuelta', async () => {
    const cliente = prepararServidor({});
    pedirEspia.mockRejectedValue(new ErrorDeApi('Sin sesion', 401));
    await pintar(cliente);
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/usuarios/u1')}`,
    );
  });

  it('un error de red se distingue del rechazo y se puede reintentar', async () => {
    const cliente = prepararServidor({});
    pedirEspia.mockRejectedValue(new ErrorDeApi('Sin conexion', 0));
    await pintar(cliente);
    await esperar();

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });

  /**
   * LO QUE NO TIENE QUE LLEGAR AL NAVEGADOR.
   *
   * El `tenantId` es el dato que la Fase 0 se ocupo de que no cruzara entre
   * gimnasios. Que la ficha lo reciba no lo convierte en algo que pintar.
   */
  it('el tenantId no aparece en ninguna parte del DOM', async () => {
    await montar({ usuario: unAlumno({ tenantId: 'tenant-secreto' }) });

    expect(document.body.innerHTML).not.toContain('tenant-secreto');
  });

  it('no queda nada en el almacenamiento del navegador', async () => {
    await montar({ usuario: unAlumno({ fichaMedica: 'Asma' }), rol: 'ADMIN_SALON' });
    await esperar();

    expect({ local: { ...localStorage }, sesion: { ...sessionStorage } }).toEqual({
      local: {},
      sesion: {},
    });
  });
});

// ---------------------------------------------------------------------------
// Los datos
// ---------------------------------------------------------------------------

describe('el bloque de datos', () => {
  it('manda SOLO los campos que cambiaron', async () => {
    await montar({ usuario: unAlumno({ telefono: '11 4444-4444' }) });

    await escribir('Telefono', '11 5555-5555');
    await clicEn('Guardar datos');

    expect(escrituras()).toEqual([
      ['/usuarios/u1', { metodo: 'PATCH', cuerpo: { telefono: '11 5555-5555' } }],
    ]);
  });

  it('sin cambios no hay peticion', async () => {
    await montar();

    await clicEn('Guardar datos');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(screen.getByText(/no cambiaste nada/i)).toBeInTheDocument();
  });

  it('dos campos cambiados viajan los dos, y nada mas', async () => {
    await montar({ usuario: unAlumno({ nombreCompleto: 'Ana Perez', clasesExtra: 0 }) });

    await escribir('Nombre completo', 'Ana Perez Gomez');
    await escribir('Clases extra', '3');
    await clicEn('Guardar datos');

    expect(escrituras()).toEqual([
      [
        '/usuarios/u1',
        { metodo: 'PATCH', cuerpo: { nombreCompleto: 'Ana Perez Gomez', clasesExtra: 3 } },
      ],
    ]);
  });

  /**
   * EL ERROR VA AL CAMPO, no a un cartel.
   *
   * `errorDelCampo` no busca el texto en la pantalla: sigue el
   * `aria-describedby` del `<input>`. Pintarlo arriba lo deja visible pero
   * desconectado, y en un formulario de nueve campos nadie sabe cual fue.
   */
  it('un 422 pinta el error EN EL CAMPO, no en un cartel de arriba', async () => {
    await montar();
    laApiFalla(
      new ErrorDeApi('telefono no vale', 422, { message: ['telefono no vale'], statusCode: 422 }),
    );

    await escribir('Telefono', '11 5555-5555');
    await clicEn('Guardar datos');

    expect(errorDelCampo('Telefono')).toBe('telefono no vale');
    expect(screen.getByLabelText('Telefono')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * Y el que de verdad devuelve la API, que NO es un 422.
   *
   * No hay un solo `UnprocessableEntityException` en `apps/api`: el
   * ValidationPipe contesta 400 con `message` como ARRAY de frases. El reparto
   * por campo tiene que entender esa forma o no sirve para nada real.
   */
  it('el 400 del ValidationPipe tambien va al campo que nombra', async () => {
    await montar();
    laApiFalla(
      new ErrorDeApi('vigenciaDesde debe tener formato YYYY-MM-DD', 400, {
        message: ['vigenciaDesde debe tener formato YYYY-MM-DD'],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    await escribir('Vigencia desde', '2026-13-99');
    await clicEn('Guardar datos');

    expect(errorDelCampo('Vigencia desde')).toMatch(/YYYY-MM-DD/);
  });

  it('un error que no nombra ningun campo SI va al cartel', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('Sin conexion', 0));

    await escribir('Telefono', '11 5555-5555');
    await clicEn('Guardar datos');

    expect(screen.getByRole('alert')).toHaveTextContent('Sin conexion');
    expect(errorDelCampo('Telefono')).toBeNull();
  });

  it('un profesor no ve los campos de alumno', async () => {
    // packId, clasesExtra, cancelaciones y vigencias: el service los rechaza
    // con 400 si el usuario es PROFESOR.
    await montar({ usuario: unProfesor() });

    expect(screen.queryByLabelText(/pack/i)).toBeNull();
    expect(screen.queryByLabelText(/vigencia/i)).toBeNull();
    expect(screen.queryByLabelText(/clases extra/i)).toBeNull();
    expect(screen.queryByLabelText(/cancelaciones/i)).toBeNull();
  });

  it('un alumno SI los ve', async () => {
    await montar({ usuario: unAlumno() });

    expect(screen.getByLabelText('Pack')).toBeInTheDocument();
    expect(screen.getByLabelText('Vigencia desde')).toBeInTheDocument();
  });

  // LISTA BLANCA: el conjunto ENTERO de controles. Un campo de mas —el error
  // que ningun test de presencia ve— rompe esto.
  it('el formulario de un alumno tiene ESTOS campos y solo estos', async () => {
    await montar({ usuario: unAlumno() });

    expect(camposDelFormularioDeDatos()).toEqual([
      'Nombre completo',
      'Telefono',
      'Pack',
      'Clases extra',
      'Cancelaciones usadas',
      'Vigencia desde',
      'Vigencia hasta',
    ]);
  });

  it('el formulario de un profesor tiene ESTOS campos y solo estos', async () => {
    await montar({ usuario: unProfesor() });

    expect(camposDelFormularioDeDatos()).toEqual(['Nombre completo', 'Telefono']);
  });

  /**
   * El email se VE pero no se EDITA.
   *
   * `ActualizarUsuarioDto` no tiene `email`, y el ValidationPipe global lleva
   * `forbidNonWhitelisted`: mandarlo seria un 400 de la peticion ENTERA, asi
   * que un campo editable de email tiraria tambien el cambio de telefono que
   * iba al lado.
   */
  it('el email se muestra pero no se puede editar', async () => {
    await montar({ usuario: unAlumno({ email: 'ana@gym.test' }) });

    expect(screen.getByText('ana@gym.test')).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
  });

  /**
   * LA FICHA MEDICA QUE NO SE VE TAMPOCO SE PISA.
   *
   * `GET /usuarios/:id` omite `fichaMedica` salvo para `ADMIN_SALON` y el
   * dueno, pero `PATCH /usuarios/:id` la ACEPTA de cualquier ADMIN_OPERATIVO.
   * Dibujar el campo igual lo pintaria vacio, y guardar un telefono mandaria
   * `fichaMedica: ''`: el historial clinico borrado por corregir un numero, sin
   * que nadie lo vea nunca. La condicion es la CLAVE del payload, no el rol
   * dibujado aparte: si fueran dos fuentes, se separarian.
   */
  it('quien no recibe la ficha medica no tiene donde pisarla', async () => {
    await montar({ usuario: unAlumno(), rol: 'ADMIN_OPERATIVO' });

    expect(screen.queryByLabelText(/ficha medica/i)).toBeNull();
  });

  it('a quien SI la recibe se le muestra y la puede editar', async () => {
    await montar({ usuario: unAlumno({ fichaMedica: 'Asma leve' }), rol: 'ADMIN_SALON' });

    expect(screen.getByLabelText(/ficha medica/i)).toHaveValue('Asma leve');
  });

  it('guardar sin tocar la ficha medica no la manda', async () => {
    await montar({ usuario: unAlumno({ fichaMedica: 'Asma leve' }), rol: 'ADMIN_SALON' });

    await escribir('Telefono', '11 5555-5555');
    await clicEn('Guardar datos');

    expect(escrituras()).toEqual([
      ['/usuarios/u1', { metodo: 'PATCH', cuerpo: { telefono: '11 5555-5555' } }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Las salas
// ---------------------------------------------------------------------------

describe('el bloque de salas', () => {
  it('ofrece TODAS las salas del gimnasio, no solo las que ya tiene', async () => {
    await montar({ usuario: unAlumno({ salaIds: ['sala-a'] }), salas: SALAS });

    expect(screen.getByRole('checkbox', { name: 'Pilates' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Funcional' })).not.toBeChecked();
  });

  it('guardar manda el conjunto FINAL de salas, no un agregado', async () => {
    await montar({ usuario: unAlumno({ salaIds: ['sala-a'] }) });

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('checkbox', { name: 'Funcional' }));
    await clicEn('Guardar salas');

    expect(escrituras()).toEqual([
      ['/usuarios/u1/salas', { metodo: 'PATCH', cuerpo: { salaIds: ['sala-a', 'sala-b'] } }],
    ]);
  });

  it('guardar salas vacias NO llega al servidor', async () => {
    // El DTO lo rechaza con 400 y un mensaje largo; avisar aca ahorra el viaje.
    await montar({ usuario: unAlumno({ salaIds: ['sala-a'] }) });

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('checkbox', { name: 'Pilates' }));
    await clicEn('Guardar salas');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(screen.getByText(/al menos una sala/i)).toBeInTheDocument();
  });

  it('el aviso de salas vacias dice que la alternativa es dar de baja', async () => {
    // Es lo que dice el DTO de la API, y es la informacion util: quien vacia las
    // salas casi siempre queria dar de baja a la persona.
    await montar({ usuario: unAlumno({ salaIds: ['sala-a'] }) });

    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('checkbox', { name: 'Pilates' }));
    await clicEn('Guardar salas');

    expect(screen.getByText(/dar de baja/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// El estado de pago
// ---------------------------------------------------------------------------

describe('el bloque de estado de pago', () => {
  it('marcar al dia exige una fecha', async () => {
    // `cubreHasta` lo comprueba el SERVICIO, no el DTO: un olvido es un 400 sin
    // campo señalado, y el admin no sabria donde mirar.
    await montar({ usuario: unAlumno({ pagoAlDia: false }) });

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /al dia/i }));
    await clicEn('Guardar estado');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(errorDelCampo('Cubre hasta')).toMatch(/fecha/i);
  });

  it('al dia CON fecha manda alDia y cubreHasta', async () => {
    await montar({ usuario: unAlumno({ pagoAlDia: false }) });

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /al dia/i }));
    await escribir('Cubre hasta', '2026-11-30');
    await clicEn('Guardar estado');

    expect(escrituras()).toEqual([
      [
        '/usuarios/u1/estado-pago',
        { metodo: 'PATCH', cuerpo: { alDia: true, cubreHasta: '2026-11-30' } },
      ],
    ]);
  });

  /**
   * `forbidNonWhitelisted` esta activo, pero no es ese el motivo.
   *
   * `cubreHasta` esta en el DTO, asi que mandarlo con `alDia: false` no seria un
   * 400: el servicio simplemente lo ignora al anular las cortesias. Lo que no
   * puede pasar es que quede en el cuerpo una fecha que el admin escribio y que
   * NO va a tener ningun efecto, porque entonces la pantalla esta prometiendo
   * algo que no hace.
   */
  it('marcar que debe NO manda la fecha, que ahi no hace nada', async () => {
    await montar({ usuario: unAlumno({ pagoAlDia: true }) });

    await escribir('Cubre hasta', '2026-11-30');
    await userEvent.setup().click(screen.getByRole('checkbox', { name: /al dia/i }));
    await clicEn('Guardar estado');

    expect(escrituras()).toEqual([
      ['/usuarios/u1/estado-pago', { metodo: 'PATCH', cuerpo: { alDia: false } }],
    ]);
  });

  it('la nota viaja solo si se escribio', async () => {
    await montar({ usuario: unAlumno({ pagoAlDia: false }) });

    await userEvent.setup().click(screen.getByRole('checkbox', { name: /al dia/i }));
    await escribir('Cubre hasta', '2026-11-30');
    await escribir('Nota', 'Pago en efectivo');
    await clicEn('Guardar estado');

    expect(escrituras()).toEqual([
      [
        '/usuarios/u1/estado-pago',
        {
          metodo: 'PATCH',
          cuerpo: { alDia: true, cubreHasta: '2026-11-30', nota: 'Pago en efectivo' },
        },
      ],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Las acciones
// ---------------------------------------------------------------------------

describe('el bloque de acciones', () => {
  it('el bloque de resetear NO EXISTE en el DOM para un ADMIN_OPERATIVO', async () => {
    // `queryByRole`, no visibilidad: esconderlo con CSS deja el boton para quien
    // abra las herramientas del navegador.
    await montar({ rol: 'ADMIN_OPERATIVO' });

    expect(screen.queryByRole('button', { name: /resetear/i })).toBeNull();
  });

  /**
   * Y NO ESTA ESCONDIDO: NO ESTA EN EL MARCADO.
   *
   * `queryByRole` NO alcanza para esto, al reves de lo que parece. Consulta el
   * ARBOL DE ACCESIBILIDAD, que ya excluye por su cuenta lo que lleva `hidden`,
   * `aria-hidden` o `display:none`. Un boton escondido con `hidden` pasa el test
   * de arriba en verde y sigue estando en el HTML que llego al navegador, a un
   * clic de las herramientas de desarrollo.
   *
   * Se comprobo: la mutacion "esconder el reset con `hidden` en vez de no
   * renderizarlo" SOBREVIVIO al test de `queryByRole`. Este es el que la mata.
   */
  it('el reset no esta escondido: no esta en el marcado', async () => {
    await montar({ rol: 'ADMIN_OPERATIVO' });

    expect(document.body.innerHTML).not.toMatch(/resetear/i);
  });

  it('un ADMIN_SALON si lo ve', async () => {
    await montar({ rol: 'ADMIN_SALON' });

    expect(screen.getByRole('button', { name: /resetear/i })).toBeInTheDocument();
  });

  /**
   * SIN CONTEXTO, NADA.
   *
   * El rol llega por el proveedor que pone el armazon del panel. Si algun dia
   * una pantalla queda fuera de ese armazon —o alguien reordena el layout— el
   * contexto devuelve `null`, y eso tiene que significar "no alcanza para
   * nada", no "no se sabe, dibujalo igual". Fallar hacia el lado que no da
   * permisos de mas es lo unico seguro cuando falta la informacion.
   */
  it('sin el proveedor de rol, el reset tampoco se dibuja', async () => {
    const cliente = prepararServidor({ rol: 'ADMIN_SALON' });
    cliente.setQueryData(clavesDeUsuarios.uno('u1'), respuestas.usuario);
    cliente.setQueryData(clavesDeCatalogos.salas(), respuestas.salas);
    cliente.setQueryData(clavesDeCatalogos.packs(), respuestas.packs);
    cliente.setQueryData(clavesDeRutinas.dePersona('p1'), respuestas.rutinas);

    // A proposito SIN `ProveedorDeRol`, que es lo que `pintar` si envuelve.
    render(
      <QueryClientProvider client={cliente}>
        <PaginaDeFicha />
      </QueryClientProvider>,
    );

    expect(botonesDelDocumento()).not.toContain('Resetear contrasena');
  });

  it('un SUPERADMIN tambien, porque los roles son jerarquicos', async () => {
    await montar({ rol: 'SUPERADMIN' });

    expect(screen.getByRole('button', { name: /resetear/i })).toBeInTheDocument();
  });

  it('dar de baja NOMBRA a quien afecta', async () => {
    await montar({ usuario: unAlumno({ nombreCompleto: 'Ana Perez' }) });

    await clicEn('Dar de baja');

    expect(screen.getByText(/dar de baja a Ana Perez/i)).toBeInTheDocument();
  });

  it('cancelar la confirmacion NO llama a la API', async () => {
    await montar();

    await clicEn('Dar de baja');
    await confirmarEnElDialogo('Cancelar');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirmar la baja si llama al DELETE', async () => {
    await montar();

    await clicEn('Dar de baja');
    await confirmarEnElDialogo('Dar de baja');

    expect(escrituras()).toEqual([['/usuarios/u1', { metodo: 'DELETE' }]]);
  });

  it('a quien ya esta dado de baja no se le ofrece darlo de baja', async () => {
    await montar({ usuario: unAlumno({ activo: false }) });

    // Por el MARCADO y no por el rol: se comprobo que dibujar el boton con
    // `hidden` sobrevive a `queryByRole`, porque esa consulta mira el arbol de
    // accesibilidad y ahi el boton escondido ya no figura.
    expect(botonesDelDocumento()).not.toContain('Dar de baja');
    expect(screen.getByText(/ya esta dado de baja/i)).toBeInTheDocument();
  });

  /**
   * El 403 de la API, distinto del 403 de la puerta.
   *
   * Aqui hay sesion y el rol alcanza para entrar al panel, pero no para ESTA
   * accion. "Algo salio mal" mandaria a quien lo lee a mirar la red o a
   * reintentar, cuando lo que hace falta es llamar al dueño del salon.
   */
  it('un 403 de la API dice QUE ROL hace falta, no "algo salio mal"', async () => {
    await montar({ rol: 'ADMIN_SALON' });
    laApiFalla(new ErrorDeApi('Forbidden resource', 403));

    await clicEn('Resetear contrasena');
    await confirmarEnElDialogo('Resetear');

    expect(screen.getByText(/administrador del salon/i)).toBeInTheDocument();
  });

  it('resetear muestra la clave temporal, que se ve una sola vez', async () => {
    await montar({ rol: 'ADMIN_SALON' });

    await clicEn('Resetear contrasena');
    await confirmarEnElDialogo('Resetear');

    expect(screen.getByText(CLAVE_DEL_RESET)).toBeInTheDocument();
  });

  /**
   * La clave NO entra en el historial del navegador.
   *
   * En la maquina compartida del mostrador, una clave en la barra de direcciones
   * sobrevive a la pantalla: queda en el historial y en el autocompletado.
   */
  it('la clave temporal no viaja por la URL', async () => {
    await montar({ rol: 'ADMIN_SALON' });

    await clicEn('Resetear contrasena');
    await confirmarEnElDialogo('Resetear');

    for (const [destino] of empujar.mock.calls as [string][]) {
      expect(destino).not.toContain(CLAVE_DEL_RESET);
    }
  });
});

/**
 * LO QUE QUEDA GUARDADO CUANDO LA FICHA SE CIERRA.
 *
 * El listado ya audita la cache de CONSULTAS y los dos almacenes del navegador.
 * Nadie habia mirado nunca la CACHE DE MUTACIONES, que es otro almacen, vive en
 * el mismo `QueryClient` —uno solo para toda la aplicacion, que dura lo que dura
 * la pestaña— y guarda dos cosas por cada escritura: lo que se MANDO
 * (`variables`) y lo que VOLVIO (`data`).
 *
 * En esta pantalla eso significa la contrasena temporal de la ultima persona a
 * la que se le reseteo, y el texto de la ficha medica de la ultima a la que se
 * le edito. Por defecto TanStack las conserva cinco minutos despues de que el
 * componente se desmonte: en la maquina del mostrador, el admin cierra la ficha,
 * se levanta, y eso sigue ahi, legible desde la consola por quien se siente.
 *
 * No lo ve ningun test de DOM, ni de peticiones, ni de `localStorage`.
 */
describe('cerrar la ficha no deja nada guardado', () => {
  /** Todo lo que la cache de mutaciones tiene dentro, serializado. */
  function contenidoDeLasMutaciones(cliente: QueryClient): string {
    return JSON.stringify(
      cliente
        .getMutationCache()
        .getAll()
        .map((mutacion) => mutacion.state),
    );
  }

  it('la contrasena temporal no sobrevive a la pantalla', async () => {
    const cliente = await montar({ rol: 'ADMIN_SALON' });

    await clicEn('Resetear contrasena');
    await confirmarEnElDialogo('Resetear');
    expect(screen.getByText(CLAVE_DEL_RESET)).toBeInTheDocument();

    // El admin cierra la ficha y se va.
    cleanup();
    await esperar();

    expect(contenidoDeLasMutaciones(cliente)).not.toContain(CLAVE_DEL_RESET);
  });

  it('la ficha medica editada tampoco', async () => {
    const cliente = await montar({
      usuario: unAlumno({ fichaMedica: 'Asma leve' }),
      rol: 'ADMIN_SALON',
    });

    await escribir('Ficha medica', 'Diabetes tipo 1');
    await clicEn('Guardar datos');

    cleanup();
    await esperar();

    expect(contenidoDeLasMutaciones(cliente)).not.toContain('Diabetes tipo 1');
  });
});

// ---------------------------------------------------------------------------
// Los dias fijos (rutinas)
// ---------------------------------------------------------------------------

describe('el bloque de dias fijos', () => {
  it('se listan SOLO las de esa persona', async () => {
    await montarPidiendo({ usuario: unAlumno({ perfilId: 'p1' }) });
    await esperar();

    expect(pedirEspia).toHaveBeenCalledWith('/rutinas?perfilId=p1');
  });

  it('los dias salen en orden de semana, no en el que vengan', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-dom', diaSemana: 0, horaInicio: '10:00', horaFin: '11:00' }),
        unaRutina({ id: 'r-mar', diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' }),
        unaRutina({ id: 'r-lun', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
      ],
    });

    expect(diasFijosDelDocumento().map((texto) => texto.split(' ')[0])).toEqual([
      'Lunes',
      'Martes',
      'Domingo',
    ]);
  });

  it('dos del mismo dia salen por hora', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-tarde', diaSemana: 1, horaInicio: '18:00', horaFin: '19:00' }),
        unaRutina({ id: 'r-manana', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
      ],
    });

    expect(diasFijosDelDocumento()).toEqual(['Lunes de 09:00 a 10:00', 'Lunes de 18:00 a 19:00']);
  });

  /**
   * `DELETE /rutinas/:id` es una baja LOGICA: la fila sigue viniendo en el
   * listado con `activa: false`. Pintar lo que llega sin mirar ese campo dejaria
   * la rutina en pantalla despues de darla de baja.
   */
  it('las rutinas dadas de baja no se pintan', async () => {
    await montar({
      rutinas: [unaRutina({ id: 'r-viva' }), unaRutina({ id: 'r-muerta', activa: false })],
    });

    expect(diasFijosDelDocumento()).toHaveLength(1);
  });

  it('sin dias fijos lo dice, y no deja una lista vacia', async () => {
    await montar({ rutinas: [] });

    expect(screen.getByText(/no tiene dias fijos/i)).toBeInTheDocument();
  });

  it('dar de baja una rutina confirma nombrando el dia y la hora', async () => {
    await montar({
      rutinas: [unaRutina({ diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' })],
    });

    await clicEn('Dar de baja el martes de 18:00 a 19:00');

    expect(enElDialogo().getByText(/martes de 18:00 a 19:00/i)).toBeInTheDocument();
  });

  it('cancelar esa confirmacion tampoco llama a la API', async () => {
    await montar({ rutinas: [unaRutina()] });

    await clicEn('Dar de baja el martes de 18:00 a 19:00');
    await confirmarEnElDialogo('Cancelar');

    expect(pedirEspia).not.toHaveBeenCalled();
  });

  it('confirmarla la da de baja', async () => {
    await montar({ rutinas: [unaRutina({ id: 'r1' })] });

    await clicEn('Dar de baja el martes de 18:00 a 19:00');
    await confirmarEnElDialogo('Dar de baja');

    expect(escrituras()).toEqual([['/rutinas/r1', { metodo: 'DELETE' }]]);
  });

  /**
   * `desde` ES OBLIGATORIO en `CrearRutinaDto`, aunque el plan de la fase solo
   * hablaba de dia, hora, sala y nombre. Sin el, el POST es un 400.
   */
  it('crear pide sala, nombre, dia, horas y desde, y manda el perfilId de ESTA persona', async () => {
    await montar({ usuario: unAlumno({ perfilId: 'p1' }) });

    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByLabelText('Sala'), 'sala-b');
    await escribir('Nombre del turno', 'Funcional');
    await usuario.selectOptions(screen.getByLabelText('Dia'), '3');
    await escribir('Desde', '2026-11-01');
    await escribir('Hora de inicio', '18:00');
    await escribir('Hora de fin', '19:00');
    await clicEn('Agregar dia fijo');

    expect(escrituras()).toEqual([
      [
        '/rutinas',
        {
          metodo: 'POST',
          cuerpo: {
            perfilId: 'p1',
            salaId: 'sala-b',
            nombre: 'Funcional',
            diaSemana: 3,
            horaInicio: '18:00',
            horaFin: '19:00',
            desde: '2026-11-01',
          },
        },
      ],
    ]);
  });

  it('sin nombre de turno no se manda nada', async () => {
    await montar();

    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByLabelText('Sala'), 'sala-b');
    await escribir('Desde', '2026-11-01');
    await escribir('Hora de inicio', '18:00');
    await escribir('Hora de fin', '19:00');
    await clicEn('Agregar dia fijo');

    expect(pedirEspia).not.toHaveBeenCalled();
  });

  it('una hora de fin anterior a la de inicio no se manda', async () => {
    await montar();

    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByLabelText('Sala'), 'sala-b');
    await escribir('Nombre del turno', 'Funcional');
    await escribir('Desde', '2026-11-01');
    await escribir('Hora de inicio', '19:00');
    await escribir('Hora de fin', '18:00');
    await clicEn('Agregar dia fijo');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(errorDelCampo('Hora de fin')).toMatch(/despues/i);
  });
});
