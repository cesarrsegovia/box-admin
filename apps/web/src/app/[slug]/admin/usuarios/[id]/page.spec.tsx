import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  PackPublico,
  PagoPublico,
  RolUsuario,
  RutinaPublica,
  SalaPublica,
  UsuarioDetalle,
  VacacionPublica,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeDinero } from '@/hooks/use-dinero';
import { clavesDeRutinas } from '@/hooks/use-rutinas';
import { clavesDeVacaciones } from '@/hooks/use-vacaciones';
import { SECRETOS_DEL_PANEL, vigilarEstosDatos } from '@/test/espia-de-consola';
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

/**
 * LO QUE ESTA FICHA SIEMBRA Y NO PUEDE ESCAPARSE POR LOS CANALES QUE NO SON EL
 * DOM: consola, `document.title` y `window.name`.
 *
 * El tapon vive en `vitest.setup.ts` y vigila SIEMPRE los secretos del panel;
 * esto le agrega lo propio de este archivo, para TODOS sus tests.
 *
 * El `tenantId` es el dato que la Fase 0 se ocupo de que no cruzara entre
 * gimnasios y viaja dentro de cada fila que esta pantalla recibe.
 *
 * Y el `motivo` de unas vacaciones, que es lo que la Tarea 5 agrega: texto
 * libre que escribe el mostrador sobre UNA PERSONA —«viaje a Brasil»,
 * «operacion de rodilla»— y que queda al lado de su nombre, su telefono y su
 * correo. De los datos de esta ficha es el mas facil de soltar en un
 * `console.info` mientras se depura el alta.
 */
const CENTINELAS = {
  tenantIdDelGimnasio: 'tnt-centinela',
  motivoDeLasVacaciones: 'Viaje-Marcador-Brasil',
  /**
   * Y LO QUE AGREGA LA TAREA 2 DE LA FASE 14: el dinero de esta persona.
   *
   * El monto termina en `.10` a proposito —es el importe que un float binario
   * no representa, asi que ademas de centinela delata a quien convierta por el
   * camino— y la nota es texto libre que el mostrador escribe al lado de lo que
   * alguien pago. De los datos de esta ficha, el que mas se parece a un
   * `console.info` de depuracion.
   */
  montoDelPago: '25000.10',
  notaDelPago: 'Nota-Marcador-pago-en-mano',
};

vigilarEstosDatos(CENTINELAS);

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

/**
 * Unas vacaciones tal como vuelven de `GET /vacaciones-alumnos`.
 *
 * `perfilId: 'p1'` y no `'u1'`: el alumno de prueba tiene los dos ids
 * distintos a proposito, que es lo unico que hace visible confundirlos.
 */
function unaVacacion(cambios: Partial<VacacionPublica> = {}): VacacionPublica {
  return {
    id: 'v1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    perfilId: 'p1',
    desde: '2026-12-24',
    hasta: '2027-01-05',
    motivo: CENTINELAS.motivoDeLasVacaciones,
    ...cambios,
  };
}

/**
 * Un pago tal como vuelve de `GET /pagos?perfilId=…`.
 *
 * `perfilId: 'p1'` y no `'u1'`, por lo mismo que las vacaciones: el alumno de
 * prueba tiene los dos ids distintos a proposito, que es lo unico que hace
 * visible confundirlos. Y `monto` es una CADENA con dos decimales, que es como
 * `aPagoPublico` lo serializa (`fila.monto.toFixed(2)`).
 */
function unPago(cambios: Partial<PagoPublico> = {}): PagoPublico {
  return {
    id: 'pg-1',
    tenantId: CENTINELAS.tenantIdDelGimnasio,
    perfilId: 'p1',
    monto: CENTINELAS.montoDelPago,
    metodo: 'EFECTIVO',
    esSena: false,
    cubreDesde: '2026-10-01',
    cubreHasta: '2026-10-31',
    comprobanteId: null,
    registradoPor: 'u-admin-operativo',
    nota: CENTINELAS.notaDelPago,
    anuladoEn: null,
    anuladoPor: null,
    createdAt: '2026-10-01T09:15:00.000Z',
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
  vacaciones: VacacionPublica[];
  pagos: PagoPublico[];
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
  // Los dos `Storage` y las galletas —que jsdom comparte entre los tests de un
  // archivo— los deja como estaban el tapon global de `vitest.setup.ts`, que
  // ademas los AUDITA. Limpiarlos aqui, en un `afterEach` del spec que corre
  // ANTES que el suyo, lo dejaria mirando unos almacenes ya vacios.
});

interface OpcionesDeMontaje {
  usuario?: UsuarioDetalle;
  salas?: SalaPublica[];
  packs?: PackPublico[];
  rutinas?: RutinaPublica[];
  vacaciones?: VacacionPublica[];
  pagos?: PagoPublico[];
  /** Lo que falla al LEER la lista de vacaciones. Las demas lecturas siguen. */
  errorDeVacaciones?: unknown;
  /** El rol de QUIEN MIRA, no el de la persona de la ficha. */
  rol?: RolUsuario;
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  respuestas = {
    usuario: opciones.usuario ?? unAlumno(),
    salas: opciones.salas ?? SALAS,
    packs: opciones.packs ?? PACKS,
    rutinas: opciones.rutinas ?? [],
    vacaciones: opciones.vacaciones ?? [],
    pagos: opciones.pagos ?? [],
  };

  rolDeQuienMira = opciones.rol ?? 'ADMIN_OPERATIVO';

  pedirEspia.mockImplementation((ruta: string, opcionesDePeticion?: { metodo?: string }) => {
    if (esEscritura(opcionesDePeticion) && falloDeEscritura !== null) {
      return Promise.reject(falloDeEscritura);
    }

    if (ruta.startsWith('/rutinas')) return Promise.resolve(respuestas.rutinas);
    if (ruta.startsWith('/salas')) return Promise.resolve(respuestas.salas);
    if (ruta.startsWith('/packs')) return Promise.resolve(respuestas.packs);
    // ANTES del `/usuarios`: `/pagos` es su propio controller y una escritura
    // devuelve `PagoPublico`, no un 204. Si este doble no lo reconociera,
    // caeria en el `return` de abajo y contestaria el usuario a un POST de
    // pagos, que es un verde mentiroso.
    if (ruta.startsWith('/pagos')) {
      if (esEscritura(opcionesDePeticion)) return Promise.resolve(unPago());
      return Promise.resolve(respuestas.pagos);
    }
    // ANTES del `/usuarios`, y con su ruta REAL: el `@Controller` se llama
    // `vacaciones-alumnos` aunque el modulo y el contrato se llamen solo
    // «vacaciones». Si la pantalla pidiera `/vacaciones`, este doble no la
    // reconoceria y caeria en el `return` de abajo, que devuelve el usuario:
    // la pantalla reventaria en vez de pasar en verde, que es lo que se quiere.
    if (ruta.startsWith('/vacaciones-alumnos')) {
      if (esEscritura(opcionesDePeticion)) return Promise.resolve(unaVacacion());
      return opciones.errorDeVacaciones === undefined
        ? Promise.resolve(respuestas.vacaciones)
        : Promise.reject(opciones.errorDeVacaciones);
    }
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
  cliente.setQueryData(clavesDeDinero.pagos({ perfilId: usuario.perfilId }), respuestas.pagos);
  if (opciones.errorDeVacaciones === undefined) {
    cliente.setQueryData(
      clavesDeVacaciones.lista({ perfilId: usuario.perfilId }),
      respuestas.vacaciones,
    );
  }

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

function formularioDeEdicion() {
  return within(screen.getByRole('form', { name: /^Editar el / }));
}

/** Con el formulario de edicion abierto: cambia la hora de fin y guarda. */
async function guardarConHoraFin(hora: string): Promise<void> {
  const sesion = userEvent.setup();
  const horaFin = formularioDeEdicion().getByLabelText('Hora de fin');
  await sesion.clear(horaFin);
  await sesion.type(horaFin, hora);
  await sesion.click(formularioDeEdicion().getByRole('button', { name: 'Guardar cambios' }));
  await esperar();
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
   *
   * CRECIO CON LA TAREA 5: el bloque de vacaciones suma `/vacaciones-alumnos`.
   * Se actualizo a proposito —una peticion mas, nombrada— y no se aflojo: sigue
   * siendo un `toEqual` sobre el conjunto entero y SIN deduplicar, asi que una
   * lectura repetida tambien lo rompe. El orden se normaliza con `sort()`
   * porque lo fija el orden de montaje de los bloques, que no es lo que este
   * test mide; el conteo, si.
   *
   * Y VUELVE A CRECER CON LA TAREA 2 DE LA FASE 14: el bloque de pagos suma
   * `/pagos?perfilId=p1`. Otra peticion mas, nombrada, y por el mismo criterio:
   * se actualiza a proposito y no se afloja. Lo que NO se agrega —y es la mitad
   * que importa— es ninguna peticion al padron (`/usuarios`) para ponerle
   * nombre a `registradoPor`: el motivo esta en el docblock de
   * `bloque-pagos.tsx` y es que el padron no tiene administradores.
   */
  it('abrir la ficha pide ESTO y nada mas', async () => {
    await montarPidiendo({ usuario: unAlumno({ perfilId: 'p1' }) });
    await esperar();

    expect([...rutasPedidas()].sort()).toEqual(
      [
        '/packs',
        '/pagos?perfilId=p1',
        '/rutinas?perfilId=p1',
        '/salas',
        '/usuarios/u1',
        '/vacaciones-alumnos?perfilId=p1',
      ].sort(),
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
   * El cableado de «Editar»: el formulario de la edicion vive en
   * `editar-rutina.spec.tsx`; aqui solo se mira que cada boton abra el de SU fila.
   * Dos rutinas con horarios distintos entre si: con una sola, un boton que abra
   * «la primera» pasaria igual.
   */
  it('el boton Editar abre el formulario de ESA rutina, y de una en una', async () => {
    await montar({
      rutinas: [
        unaRutina({
          id: 'r-lun',
          nombre: 'Funcional',
          diaSemana: 1,
          horaInicio: '09:00',
          horaFin: '10:00',
          hasta: '2026-12-15',
        }),
        unaRutina({
          id: 'r-mar',
          nombre: 'Pilates',
          diaSemana: 2,
          horaInicio: '18:00',
          horaFin: '19:00',
          hasta: null,
        }),
      ],
    });

    await clicEn('Editar el martes de 18:00 a 19:00');

    const formularios = () => screen.getAllByRole('form', { name: /^Editar el / });
    expect(formularios()).toHaveLength(1);
    expect(within(formularios()[0] as HTMLElement).getByLabelText('Hora de inicio')).toHaveValue(
      '18:00',
    );
    // Esta dentro de la fila del martes, no de la del lunes.
    expect(formularios()[0]?.closest('li')).toHaveTextContent('Martes de 18:00 a 19:00');

    await clicEn('Editar el lunes de 09:00 a 10:00');

    expect(formularios()).toHaveLength(1);
    expect(within(formularios()[0] as HTMLElement).getByLabelText('Hora de inicio')).toHaveValue(
      '09:00',
    );
    expect(formularios()[0]?.closest('li')).toHaveTextContent('Lunes de 09:00 a 10:00');
  });

  it('guardar la edicion manda el PATCH de ESA rutina, cierra el formulario y avisa', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-lun', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
        unaRutina({ id: 'r-mar', diaSemana: 2, horaInicio: '18:00', horaFin: '19:00' }),
      ],
    });

    await clicEn('Editar el martes de 18:00 a 19:00');

    const formulario = within(screen.getByRole('form', { name: /^Editar el / }));
    const sesion = userEvent.setup();
    const horaFin = formulario.getByLabelText('Hora de fin');
    await sesion.clear(horaFin);
    await sesion.type(horaFin, '20:00');
    await sesion.click(formulario.getByRole('button', { name: 'Guardar cambios' }));
    await esperar();

    expect(escrituras()).toEqual([
      ['/rutinas/r-mar', { metodo: 'PATCH', cuerpo: { horaFin: '20:00' } }],
    ]);
    expect(screen.queryByRole('form', { name: /^Editar el / })).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('Dia fijo actualizado.');
    // Es un exito, no un error ni un dato: el mismo tono que el aviso de la clave.
    expect(screen.getByRole('alert')).toHaveClass('bg-emerald-50');
  });

  it('al abrir la edicion el foco va al nombre, y Editar anuncia cual esta expandido', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-lun', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
        unaRutina({ id: 'r-mar' }),
      ],
    });

    const martes = screen.getByRole('button', { name: 'Editar el martes de 18:00 a 19:00' });
    const lunes = screen.getByRole('button', { name: 'Editar el lunes de 09:00 a 10:00' });
    expect(martes).toHaveAttribute('aria-expanded', 'false');

    await clicEn('Editar el martes de 18:00 a 19:00');

    expect(martes).toHaveAttribute('aria-expanded', 'true');
    expect(lunes).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(formularioDeEdicion().getByLabelText('Nombre del turno'));
  });

  it('cancelar devuelve el foco al boton Editar de ESA fila', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-lun', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
        unaRutina({ id: 'r-mar' }),
      ],
    });

    await clicEn('Editar el martes de 18:00 a 19:00');
    await userEvent.setup().click(formularioDeEdicion().getByRole('button', { name: 'Cancelar' }));
    await esperar();

    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Editar el martes de 18:00 a 19:00' }),
    );
  });

  it('guardar devuelve el foco al boton Editar de ESA fila', async () => {
    await montar({
      rutinas: [
        unaRutina({ id: 'r-lun', diaSemana: 1, horaInicio: '09:00', horaFin: '10:00' }),
        unaRutina({ id: 'r-mar' }),
      ],
    });

    await clicEn('Editar el martes de 18:00 a 19:00');
    await guardarConHoraFin('20:00');

    // La fila ya no se llama «de 18:00 a 19:00» si la lista se refresca; aqui el
    // doble devuelve la misma, asi que se la busca por su dia.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Editar el martes/ }));
  });

  it('una baja que falla despues de una edicion OK no deja el «actualizado» colgado', async () => {
    await montar({ rutinas: [unaRutina({ id: 'r-mar' })] });

    await clicEn('Editar el martes de 18:00 a 19:00');
    await guardarConHoraFin('20:00');
    expect(screen.getByText('Dia fijo actualizado.')).toBeInTheDocument();

    laApiFalla(new ErrorDeApi('No se pudo dar de baja', 400));
    await clicEn('Dar de baja el martes de 18:00 a 19:00');
    // Ya al abrir la baja se va: no espera a que la baja salga mal.
    expect(screen.queryByText('Dia fijo actualizado.')).toBeNull();
    await confirmarEnElDialogo('Dar de baja');

    expect(screen.queryByText('Dia fijo actualizado.')).toBeNull();
    expect(screen.getByText('No se pudo dar de baja')).toBeInTheDocument();
  });

  it('un error viejo de la baja no sobrevive a una edicion OK', async () => {
    await montar({ rutinas: [unaRutina({ id: 'r-mar' })] });

    laApiFalla(new ErrorDeApi('No se pudo dar de baja', 400));
    await clicEn('Dar de baja el martes de 18:00 a 19:00');
    await confirmarEnElDialogo('Dar de baja');
    expect(screen.getByText('No se pudo dar de baja')).toBeInTheDocument();

    laApiFalla(null);
    await clicEn('Editar el martes de 18:00 a 19:00');
    await guardarConHoraFin('20:00');

    expect(screen.queryByText('No se pudo dar de baja')).toBeNull();
  });

  it('dar de baja la rutina que se esta editando cierra la edicion', async () => {
    await montar({ rutinas: [unaRutina({ id: 'r-mar' })] });

    await clicEn('Editar el martes de 18:00 a 19:00');
    await clicEn('Dar de baja el martes de 18:00 a 19:00');
    await confirmarEnElDialogo('Dar de baja');

    expect(screen.queryByRole('form', { name: /^Editar el / })).toBeNull();
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

// ---------------------------------------------------------------------------
// Las vacaciones (cuando NO viene)
// ---------------------------------------------------------------------------

/**
 * LOS MENSAJES DEL SERVICIO, COPIADOS PALABRA POR PALABRA.
 *
 * Verificados contra `apps/api/src/vacaciones/vacaciones.service.ts`. Son los
 * textos que VIAJAN, no el comentario del codigo.
 *
 * No se afirma con una expresion laxa tipo `/necesit/i`: una asercion asi la
 * pasa igual un mensaje generico, que es exactamente el fallo que estos tests
 * existen para cazar.
 */
const ORDEN_DE_LAS_FECHAS = 'hasta no puede ser anterior a desde';
const VACACIONES_INEXISTENTES = 'Vacaciones inexistentes';
const PERFIL_INEXISTENTE = 'Perfil inexistente';

/** Las filas de vacaciones, cada una como la lista de sus textos. */
function vacacionesDelDocumento(): string[][] {
  return [...document.querySelectorAll('ul[aria-label="Vacaciones"] > li')].map((li) =>
    [...li.querySelectorAll('p')].map((p) => p.textContent?.trim() ?? ''),
  );
}

/**
 * Los controles del alta por su ETIQUETA y en orden: la lista blanca del
 * formulario. Un control de mas lo rompe se llame como se llame.
 */
function controlesDelAlta(): string[] {
  const formulario = document.querySelector('form[aria-label="Cargar vacaciones"]');
  if (formulario === null) throw new Error('No hay formulario de vacaciones');

  return [...formulario.querySelectorAll('input, select, textarea')].map((control) => {
    const id = control.getAttribute('id') ?? '';
    const etiqueta = formulario.querySelector(`label[for="${CSS.escape(id)}"]`);
    return etiqueta?.textContent?.trim() ?? '(sin etiqueta)';
  });
}

/**
 * EL RELOJ, CONGELADO Y SOLO EL RELOJ, para lo que dura la funcion.
 *
 * El estado de cada rango —si ya paso, si esta pasando o si esta por venir—
 * se calcula contra `new Date()`. Sin congelarlo, los tests que lo miran
 * cambiarian de significado cada dia y las fechas escritas a mano caducarian
 * solas; peor todavia, un test podria pasar en verde hoy por la fecha en que
 * se escribio y no por lo que afirma.
 *
 * Se falsea `Date` y NADA MAS (`toFake: ['Date']`): los temporizadores siguen
 * siendo de verdad, que es lo que necesitan `userEvent` y `esperar()`.
 */
async function conElRelojEn(dia: string, hacer: () => Promise<void>): Promise<void> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(`${dia}T12:00:00.000Z`));

  try {
    await hacer();
  } finally {
    vi.useRealTimers();
  }
}

/** Rellena el alta con unas vacaciones validas, con los cambios que se le pasen. */
async function completarElAlta(cambios: Partial<Record<string, string>> = {}): Promise<void> {
  const valores: Record<string, string> = {
    'No viene desde': '2026-12-24',
    'No viene hasta': '2027-01-05',
    Motivo: CENTINELAS.motivoDeLasVacaciones,
    ...cambios,
  };

  for (const etiqueta of Object.keys(valores)) {
    await escribir(etiqueta, valores[etiqueta] ?? '');
  }
}

describe('el bloque de vacaciones', () => {
  it('lista SOLO las de esa persona', async () => {
    await montarPidiendo({ usuario: unAlumno({ id: 'u1', perfilId: 'p1' }) });
    await esperar();

    expect(pedirEspia).toHaveBeenCalledWith('/vacaciones-alumnos?perfilId=p1');
  });

  it('pinta las fechas, el estado y el motivo de cada rango, y nada mas', async () => {
    await conElRelojEn('2026-10-15', async () => {
      await montar({ vacaciones: [unaVacacion()] });

      // El conjunto ENTERO de textos de la fila: uno de mas la rompe.
      expect(vacacionesDelDocumento()).toEqual([
        ['2026-12-24 a 2027-01-05', 'Todavia no empezaron', CENTINELAS.motivoDeLasVacaciones],
      ]);
    });
  });

  it('un solo dia no se pinta como un rango', async () => {
    await montar({ vacaciones: [unaVacacion({ desde: '2026-12-25', hasta: '2026-12-25' })] });

    expect(vacacionesDelDocumento().map((celdas) => celdas[0])).toEqual(['2026-12-25']);
  });

  it('sin motivo lo dice, en vez de dejar el hueco vacio', async () => {
    // Un hueco en blanco se lee como «no cargo la pantalla».
    await montar({ vacaciones: [unaVacacion({ motivo: null })] });

    expect(vacacionesDelDocumento()[0]?.[2]).toBe('Sin motivo');
  });

  it('sin vacaciones lo dice, y no deja una lista vacia', async () => {
    await montar({ vacaciones: [] });

    expect(screen.getByText('No tiene vacaciones cargadas.')).toBeInTheDocument();
    expect(document.querySelector('ul[aria-label="Vacaciones"]')).toBeNull();
  });

  it('el tenantId de las vacaciones tampoco llega al marcado', async () => {
    await montar({ vacaciones: [unaVacacion({ tenantId: 'tenant-de-la-fila' })] });

    expect(document.body.innerHTML).not.toContain('tenant-de-la-fila');
  });
});

// ---------------------------------------------------------------------------
// Lo que ya paso y lo que viene
// ---------------------------------------------------------------------------

/**
 * UN RANGO QUE YA PASO NO SE LEE IGUAL QUE UNO QUE VIENE.
 *
 * El listado trae TODAS las de la persona, de siempre, y el service las
 * ordena por `desde` ascendente: arriba de todo esta lo mas viejo. Sin decir
 * en que estado esta cada rango, «se va en enero» y «se fue el enero pasado»
 * se leen igual, y la pregunta que trae a alguien a esta ficha es siempre
 * sobre lo que viene.
 *
 * Los tres estados se fijan EN EL MISMO MONTAJE y con el reloj congelado: con
 * un test por estado, el que mira solo el pasado pasaria en verde aunque el
 * futuro dijera lo mismo.
 */
describe('las vacaciones pasadas se distinguen de las que vienen', () => {
  it('ya pasaron, en curso y todavia no empezaron', async () => {
    await conElRelojEn('2026-10-15', async () => {
      await montar({
        vacaciones: [
          unaVacacion({ id: 'v-vieja', desde: '2026-07-01', hasta: '2026-07-15' }),
          unaVacacion({ id: 'v-ahora', desde: '2026-10-10', hasta: '2026-10-20' }),
          unaVacacion({ id: 'v-futura', desde: '2026-12-24', hasta: '2027-01-05' }),
        ],
      });

      expect(vacacionesDelDocumento().map((celdas) => celdas[1])).toEqual([
        'Ya pasaron',
        'En curso',
        'Todavia no empezaron',
      ]);
    });
  });

  /**
   * LOS DOS BORDES, que es donde un `<` de mas o de menos no se nota.
   *
   * El dia en que terminan y el dia en que empiezan TODAVIA CUENTAN: el rango
   * es cerrado por los dos lados —`fechaEnRango(fecha, desde, hasta)` en
   * `generacion-mes.service.ts`—, asi que el ultimo dia el alumno sigue sin
   * venir. Decir «ya pasaron» ese dia contradice al mes que se va a publicar.
   */
  it('el ultimo dia y el primero todavia cuentan', async () => {
    await conElRelojEn('2026-10-15', async () => {
      await montar({
        vacaciones: [
          unaVacacion({ id: 'v-termina-hoy', desde: '2026-10-01', hasta: '2026-10-15' }),
          unaVacacion({ id: 'v-empieza-hoy', desde: '2026-10-15', hasta: '2026-10-31' }),
          unaVacacion({ id: 'v-termino-ayer', desde: '2026-10-01', hasta: '2026-10-14' }),
        ],
      });

      expect(vacacionesDelDocumento().map((celdas) => celdas[1])).toEqual([
        'En curso',
        'En curso',
        'Ya pasaron',
      ]);
    });
  });
});

// ---------------------------------------------------------------------------
// Cargar unas vacaciones
// ---------------------------------------------------------------------------

describe('cargar unas vacaciones', () => {
  // LISTA BLANCA: el conjunto ENTERO de controles del alta.
  it('el formulario ofrece ESTOS campos y solo estos', async () => {
    await montar();

    expect(controlesDelAlta()).toEqual(['No viene desde', 'No viene hasta', 'Motivo']);
  });

  /**
   * EL `perfilId` DE LA FICHA, NO EL `id` DEL USUARIO.
   *
   * Son dos columnas distintas y las dos son cuid, asi que confundirlas no
   * revienta nada: el POST contesta 404 «Perfil inexistente» con suerte, y con
   * mala suerte —si ese cuid existiera como perfil— le carga las vacaciones a
   * otra persona. En la Fase 8 quedo un filtro roto exactamente asi
   * (`turnos/filtros.tsx` manda el id del usuario donde va el del perfil) y el
   * sintoma fue una lista siempre vacia, que nadie reporta.
   *
   * El alumno de prueba tiene `id: 'u1'` y `perfilId: 'p1'`: es lo unico que
   * hace visible la confusion.
   */
  it('crear manda el perfilId de la ficha, no el id del usuario', async () => {
    await montar({ usuario: unAlumno({ id: 'u1', perfilId: 'p1' }) });

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    expect(escrituras()).toEqual([
      [
        '/vacaciones-alumnos',
        {
          metodo: 'POST',
          cuerpo: {
            perfilId: 'p1',
            desde: '2026-12-24',
            hasta: '2027-01-05',
            motivo: CENTINELAS.motivoDeLasVacaciones,
          },
        },
      ],
    ]);
    // Y el id del usuario no viaja NI SIQUIERA en otra clave.
    expect(JSON.stringify(escrituras()[0]?.[1].cuerpo)).not.toContain('u1');
  });

  it('el motivo vacio se OMITE, no viaja como cadena vacia', async () => {
    // `motivo: ''` se guardaria como cadena vacia, que no es lo mismo que «no
    // puso motivo»: la columna nace en null.
    await montar();

    await completarElAlta({ Motivo: '' });
    await clicEn('Cargar vacaciones');

    expect(Object.keys(escrituras()[0]?.[1].cuerpo as object)).toEqual([
      'perfilId',
      'desde',
      'hasta',
    ]);
  });

  it('una fecha con otra forma no llega al servidor', async () => {
    await montar();

    await completarElAlta({ 'No viene desde': '24/12/2026' });
    await clicEn('Cargar vacaciones');

    expect(escrituras()).toEqual([]);
    expect(errorDelCampo('No viene desde')).toBe('La fecha va como YYYY-MM-DD');
  });

  it('tras un alta buena el formulario queda limpio', async () => {
    // Con los valores puestos, el siguiente rango se carga encima del anterior
    // sin que nadie lo note.
    await montar();

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    expect(screen.getByLabelText('No viene desde')).toHaveValue('');
    expect(screen.getByLabelText('Motivo')).toHaveValue('');
  });
});

// ---------------------------------------------------------------------------
// Lo que dice la API cuando no
// ---------------------------------------------------------------------------

/**
 * LOS MENSAJES SON LOS DEL SERVICIO Y SE ENSEÑAN TAL CUAL.
 *
 * El bloque NO comprueba el orden de las fechas a proposito: una comprobacion
 * local con otro texto seria un segundo mensaje que puede acabar diciendo algo
 * distinto del de la API, y —peor— dejaria ese camino de la API sin ejercitar
 * nunca.
 */
describe('lo que dice la API cuando no se pueden cargar', () => {
  it('hasta anterior a desde muestra el motivo de la API, palabra por palabra', async () => {
    await montar();
    laApiFalla(
      new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, {
        message: [ORDEN_DE_LAS_FECHAS],
        error: 'Bad Request',
        statusCode: 400,
      }),
    );

    await completarElAlta({ 'No viene desde': '2027-01-05', 'No viene hasta': '2026-12-24' });
    await clicEn('Cargar vacaciones');

    expect(escrituras()).toHaveLength(1);
    expect(screen.getByText(ORDEN_DE_LAS_FECHAS)).toBeInTheDocument();
  });

  /**
   * Y VA AL CAMPO `hasta`, NO AL `desde`.
   *
   * «hasta no puede ser anterior a desde» NOMBRA A LOS DOS campos, y
   * `repartirPorCampo` ordena por longitud del nombre: `desde` y `hasta` miden
   * lo mismo, asi que el ganador lo decide el orden de la lista que le pasa el
   * bloque. Con `desde` delante, la frase se colgaria del campo que
   * seguramente esta bien y el admin corregiria la fecha equivocada.
   *
   * Es el test que distingue «se ve el mensaje» de «se ve donde sirve».
   */
  it('y se cuelga del campo hasta, que es el que la API culpa', async () => {
    await montar();
    laApiFalla(new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, { message: [ORDEN_DE_LAS_FECHAS] }));

    await completarElAlta({ 'No viene desde': '2027-01-05', 'No viene hasta': '2026-12-24' });
    await clicEn('Cargar vacaciones');

    expect(errorDelCampo('No viene hasta')).toBe(ORDEN_DE_LAS_FECHAS);
    expect(errorDelCampo('No viene desde')).toBeNull();
  });

  /**
   * UNA FRASE QUE NO NOMBRA NINGUN CAMPO DIBUJADO VA AL CARTEL.
   *
   * `perfilId` es el otro campo que el DTO valida y NO tiene control: si
   * estuviera en la lista del reparto, su frase se la tragaria el reparto en
   * silencio y en pantalla no quedaria nada. Fuera de la lista cae en
   * `sueltas`, que es lo que se pinta arriba.
   */
  it('un fallo que no nombra ningun campo dibujado sale en el cartel', async () => {
    await montar();
    laApiFalla(new ErrorDeApi(PERFIL_INEXISTENTE, 404, { message: PERFIL_INEXISTENTE }));

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    expect(screen.getByText(PERFIL_INEXISTENTE)).toBeInTheDocument();
    expect(errorDelCampo('No viene desde')).toBeNull();
    expect(errorDelCampo('No viene hasta')).toBeNull();
  });

  it('un 403 se explica en palabras, no como «Forbidden»', async () => {
    // Las tres rutas piden ADMIN_OPERATIVO, asi que es ESE el rol que se nombra.
    await montar();
    laApiFalla(new ErrorDeApi('Forbidden', 403, { message: 'Forbidden' }));

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    expect(
      screen.getByText('Para esto hace falta ser administrador operativo. Tu rol no alcanza.'),
    ).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('Forbidden');
  });

  it('tras un fallo el formulario sigue ahi, con lo que ya se habia escrito', async () => {
    await montar();
    laApiFalla(new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, { message: [ORDEN_DE_LAS_FECHAS] }));

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    expect(screen.getByLabelText('No viene desde')).toHaveValue('2026-12-24');
    expect(screen.getByLabelText('Motivo')).toHaveValue(CENTINELAS.motivoDeLasVacaciones);
  });

  /**
   * UN FALLO AL LEER NO SE DIBUJA COMO «no tiene vacaciones cargadas».
   *
   * Es la trampa concreta de este endpoint. La ruta base es
   * `/vacaciones-alumnos` aunque el modulo, el service y el contrato se llamen
   * solo «vacaciones»: deducirla del nombre del modulo da un 404, y un 404 que
   * se pintara como lista vacia diria que el alumno viene todos los dias. El
   * mes se publicaria con las reservas que habia que excluir, y el sintoma
   * aparece a un mes de distancia.
   */
  it('un fallo al LEER no se lee como «no tiene vacaciones»', async () => {
    await montarPidiendo({ errorDeVacaciones: new ErrorDeApi('Not Found', 404) });
    await esperar();

    expect(screen.getByText('Not Found')).toBeInTheDocument();
    expect(screen.queryByText('No tiene vacaciones cargadas.')).toBeNull();
    expect(document.querySelector('ul[aria-label="Vacaciones"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Borrar
// ---------------------------------------------------------------------------

describe('borrar unas vacaciones', () => {
  it('confirma nombrando las fechas y el motivo, y no manda nada hasta confirmar', async () => {
    await montar({ vacaciones: [unaVacacion()] });

    await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('2026-12-24 a 2027-01-05');
    expect(dialogo).toHaveTextContent(CENTINELAS.motivoDeLasVacaciones);
    // El borrado es REAL, no una baja logica: el dialogo tiene que decirlo.
    expect(dialogo).toHaveTextContent(/se borran de verdad/i);
    expect(escrituras()).toEqual([]);
  });

  it('borra la DE ESA FILA, con dos sembradas', async () => {
    // Con una sola, «borra la suya» y «borra la primera» son indistinguibles.
    await montar({
      vacaciones: [
        unaVacacion({ id: 'v1', desde: '2026-07-01', hasta: '2026-07-15' }),
        unaVacacion({ id: 'v2', desde: '2026-12-24', hasta: '2027-01-05' }),
      ],
    });

    await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');
    await confirmarEnElDialogo('Borrar');

    expect(escrituras()).toEqual([['/vacaciones-alumnos/v2', { metodo: 'DELETE' }]]);
  });

  it('cancelar no manda nada', async () => {
    await montar({ vacaciones: [unaVacacion()] });

    await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');
    await confirmarEnElDialogo('Cancelar');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('si el borrado falla, el motivo se pinta DENTRO del dialogo', async () => {
    // Detras del dialogo no se lee, y el dialogo sigue abierto pidiendo que se
    // confirme algo que acaba de fallar.
    await montar({ vacaciones: [unaVacacion()] });
    laApiFalla(new ErrorDeApi(VACACIONES_INEXISTENTES, 404));

    await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');
    await confirmarEnElDialogo('Borrar');

    expect(screen.getByRole('dialog')).toHaveTextContent(VACACIONES_INEXISTENTES);
  });
});

// ---------------------------------------------------------------------------
// A quien se le dibuja
// ---------------------------------------------------------------------------

/**
 * UNA PROFESORA NO LLEVA VACACIONES POR AQUI.
 *
 * El modelo se llama `VacacionAlumno` y `planificarMes` solo las cruza contra
 * los `perfilId` QUE TIENEN RUTINAS en la sala —o sea, contra quien viene a
 * clase—. La ausencia de una profesora se gestiona con sus horarios asignados
 * (`HorarioProfesorAsignado`), que son otro modelo y otra pantalla.
 *
 * OJO CON COMO SE VERIFICA ESTO: la API NO lo impide. `VacacionesService.crear`
 * solo comprueba que el perfil exista, sin mirar el rol, asi que un POST con el
 * perfil de una profesora devuelve 201 y guarda la fila. Lo que pasa es que esa
 * fila no hace NADA: ningun consumidor la lee. O sea que el bloque, dibujado en
 * la ficha de una profesora, seria un control que promete tapar sus clases y
 * las deja en pie —y encima sin error que lo delate—.
 *
 * Por eso la decision es del front y vive aqui con su test. Si algun dia la API
 * empieza a honrar las vacaciones de una profesora, este test es el que hay que
 * borrar a mano, y eso es justamente lo que se quiere.
 */
describe('a quien se le dibujan las vacaciones', () => {
  it('a un alumno si', async () => {
    await montar({ usuario: unAlumno() });

    expect(document.querySelector('form[aria-label="Cargar vacaciones"]')).not.toBeNull();
  });

  it('a un profesor NO, y no es que este escondido: no esta en el marcado', async () => {
    // `queryByRole` no alcanzaria: consulta el arbol de accesibilidad, que ya
    // excluye por su cuenta lo que lleva `hidden`, asi que un bloque escondido
    // pasaria en verde y seguiria en el HTML que llego al navegador.
    await montar({ usuario: unProfesor() });

    expect(document.body.innerHTML).not.toMatch(/vacaciones/i);
    expect(document.querySelector('form[aria-label="Cargar vacaciones"]')).toBeNull();
  });

  it('y a un profesor tampoco se le PIDEN', async () => {
    // Dibujar nada pero pedirlas igual seria traer datos de una persona para
    // tirarlos, y la peticion no la ve ningun test de marcado.
    await montarPidiendo({ usuario: unProfesor() });
    await esperar();

    expect(rutasPedidas().filter((ruta) => ruta.startsWith('/vacaciones'))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lo que la ficha pide al montar
// ---------------------------------------------------------------------------

/**
 * LISTA BLANCA DE PETICIONES, UNA SOLA Y PARA LOS TRES ROLES.
 *
 * Y eso es una AFIRMACION, no un atajo. Las tres rutas de
 * `vacaciones.controller.ts` piden `ADMIN_OPERATIVO`, incluido el `@Get()`; y
 * la puerta del panel (`admin/layout.tsx`) ya exige `ADMIN_OPERATIVO` para
 * entrar. O sea que los tres roles que pueden llegar a esta ficha pasan la
 * misma puerta y piden EXACTAMENTE lo mismo: montar tres listas iguales con
 * tres nombres distintos daria la impresion de estar midiendo tres cosas. Lo
 * que se mide es la IGUALDAD, y por eso la lista esta escrita una vez y los
 * roles se recorren contra ella.
 *
 * Lo que SI cambia con el rol en esta ficha —el boton de resetear la
 * contraseña, que pide `ADMIN_SALON`— no es una peticion sino un dibujo, y de
 * eso se ocupa el bloque de acciones.
 *
 * Una LECTURA de mas no la ve ningun otro test de este archivo: no cambia un
 * nodo del marcado y no manda ningun cuerpo. Un `useSalas()` de precalentamiento
 * sobrevivio 74 tests en una tarea anterior de esta misma fase.
 */
const PETICIONES_AL_ABRIR_LA_FICHA = [
  '/packs',
  // LA TAREA 2 DE LA FASE 14. `GET /pagos` lleva `@Roles('ADMIN_OPERATIVO')`
  // igual que las tres rutas de vacaciones, asi que la igualdad entre los tres
  // roles que pueden llegar a esta ficha SIGUE SIENDO CIERTA con esta linea
  // dentro: no se partio la lista en una por rol.
  '/pagos?perfilId=p1',
  '/rutinas?perfilId=p1',
  '/salas',
  '/usuarios/u1',
  '/vacaciones-alumnos?perfilId=p1',
];

describe('lo que la ficha pide al montar', () => {
  it.each(['ADMIN_OPERATIVO', 'ADMIN_SALON', 'SUPERADMIN'] as const)(
    'AL MONTAR salen ESTAS peticiones y ninguna mas, mirando como %s',
    async (rol) => {
      // Ordenadas —el orden lo fija el montaje de los bloques, que no es lo
      // que esto mide— pero SIN DEDUPLICAR: una lectura repetida lo rompe.
      await montarPidiendo({ usuario: unAlumno({ perfilId: 'p1' }), rol });
      await esperar();

      expect([...rutasPedidas()].sort()).toEqual([...PETICIONES_AL_ABRIR_LA_FICHA].sort());
    },
  );

  /**
   * SIN PROVEEDOR DE ROL NO SE PIDEN LAS VACACIONES.
   *
   * Al reves que en cierres, donde el `@Get()` no lleva `@Roles` y cortar la
   * lectura seria inventar un permiso que la API no pide. Aqui el `@Get()` SI
   * lo lleva, asi que pedir sin rol seria un 403 pintado como una averia.
   *
   * La ficha en si se sigue pidiendo: `GET /usuarios/:id` NO lleva `@Roles`
   * —el service decide, porque un alumno puede pedir su propio detalle—.
   */
  it('sin proveedor de rol, ni las vacaciones ni los pagos se piden; el resto si', async () => {
    const cliente = prepararServidor({ usuario: unAlumno({ perfilId: 'p1' }) });

    // A proposito SIN `ProveedorDeRol`, que es lo que `pintar` si envuelve.
    render(
      <QueryClientProvider client={cliente}>
        <PaginaDeFicha />
      </QueryClientProvider>,
    );
    await esperar();

    expect([...rutasPedidas()].sort()).toEqual(
      ['/packs', '/rutinas?perfilId=p1', '/salas', '/usuarios/u1'].sort(),
    );
    expect(
      screen.getByText('Para esto hace falta ser administrador operativo. Tu rol no alcanza.'),
    ).toBeInTheDocument();
    // Y EL BLOQUE DE PAGOS DICE LO SUYO, con su propia frase y no con la de
    // arriba: dos carteles identicos en la misma pantalla no dejarian saber
    // cual de los dos bloques esta cortado.
    expect(
      screen.getByText(
        'Para ver los pagos hace falta ser administrador operativo. Tu rol no alcanza.',
      ),
    ).toBeInTheDocument();
  });

  /**
   * LA LISTA BLANCA DE ARRIBA MIRA `pedir`, NO LA RED.
   *
   * Y ese es su agujero: el doble esta puesto sobre `pedir`, asi que una
   * peticion hecha con `fetch` a pelo —o con `sendBeacon`, o con un
   * `<link rel="prefetch">`— no aparece en `rutasPedidas()`, no cambia un nodo
   * del marcado, no manda un cuerpo que ningun test mire, no toca los
   * almacenes y no dice nada por la consola. Se midio en esta misma fase: un
   * `void fetch('/api/bx/stats/caja')` en un `useEffect` paso los 1233 tests
   * del paquete y `tsc`.
   *
   * El daño, en una ficha, es doble. Va al proxy CON LA COOKIE de sesion, asi
   * que trae datos de verdad y los deja en la pestaña de red y en los
   * breadcrumbs de cualquier SDK de errores que se enchufe mañana. Y
   * `lib/cliente.ts` se abre diciendo que es «el unico fetch del navegador en
   * toda la aplicacion», una frase cierta solo mientras nadie escriba la
   * primera excepcion, que es la que ningun test ve.
   */
  it('no habla con la red por fuera de `pedir`, ni al leer ni al escribir', async () => {
    // El doble CONTESTA como contestaria la red —un 200 con JSON— en vez de
    // devolver `undefined`: asi una peticion clandestina falla por la
    // afirmacion de abajo, que dice a donde se hablaba, y no por un
    // `TypeError` al encadenarle algo al resultado.
    const red = vi.fn((_destino: RequestInfo | URL) =>
      Promise.resolve(
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
      ),
    );
    vi.stubGlobal('fetch', red);

    try {
      await montar({ vacaciones: [unaVacacion()] });

      await completarElAlta();
      await clicEn('Cargar vacaciones');

      await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');
      await confirmarEnElDialogo('Borrar');

      expect(escrituras()).toHaveLength(2);
      // Los destinos y no solo el conteo: si alguna vez cae, el informe dice a
      // donde se estaba hablando.
      expect(red.mock.calls.map(([destino]) => String(destino))).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  /**
   * ESTAR ABIERTA NO ES HACER ALGO.
   *
   * Ningun test de este archivo adelanta el reloj, asi que todo lo que la
   * ficha haga sola pasado un rato es invisible: la lista blanca cuenta lo que
   * se pidio en los primeros milisegundos y se va. Un `refetchInterval` de
   * medio minuto «porque hay dos admins cargando vacaciones» pasa por delante
   * del marcado, de los cuerpos, de los almacenes, de las dos caches y de la
   * lista blanca entera.
   *
   * Se miran CINCO MINUTOS, mas de lo que dura cualquier intervalo que alguien
   * ponga por comodidad.
   */
  it('la ficha abierta cinco minutos no pide nada por su cuenta', async () => {
    await montar({ vacaciones: [unaVacacion()] });

    vi.useFakeTimers();
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });

      expect(rutasPedidas()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// La cache de mutaciones
// ---------------------------------------------------------------------------

/**
 * LOS TRES ALMACENES DEL NAVEGADOR YA NO SE MIRAN AQUI.
 *
 * `localStorage`, `sessionStorage` y las galletas son una DIMENSION, no un
 * caso de esta ficha, y los vigila el tapon global de `vitest.setup.ts` en
 * TODOS los tests de este archivo —leer la ficha, cargar unas vacaciones,
 * borrarlas y un alta que falla incluidos—, contra el mismo registro de
 * centinelas y afirmando sobre las CLAVES. Aqui vivian cuatro tests con su
 * propia copia de `contenidoDe` y `galletasDelDocumento`; el agujero no era de
 * esta pantalla sino de las que no se habian acordado de copiarlas.
 *
 * Los conteos de escrituras que acompañaban a aquellos cuatro no se pierden:
 * el test del `fetch` crudo de mas arriba hace el alta Y el borrado y fija
 * `toHaveLength(2)`, que acota los dos.
 *
 * LA CACHE DE MUTACIONES NO ES UN ALMACEN DEL NAVEGADOR y sigue aqui.
 */
describe('las vacaciones no se quedan en la cache de mutaciones', () => {
  /**
   * Y TAMPOCO EN LA CACHE DE MUTACIONES, que es otro almacen.
   *
   * Vive en el mismo `QueryClient` —uno solo para toda la aplicacion, que dura
   * lo que dura la pestaña— y guarda lo que se MANDO (`variables`) y lo que
   * VOLVIO (`data`). Por defecto TanStack las conserva cinco minutos despues
   * de que el componente se desmonte: el admin cierra la ficha, se levanta, y
   * el motivo de las vacaciones de esa persona sigue ahi, legible desde la
   * consola por quien se siente.
   */
  it('ni en la cache de mutaciones cuando la ficha se cierra', async () => {
    const cliente = await montar();

    await completarElAlta();
    await clicEn('Cargar vacaciones');

    cleanup();
    await esperar();

    expect(
      JSON.stringify(
        cliente
          .getMutationCache()
          .getAll()
          .map((mutacion) => mutacion.state),
      ),
    ).not.toContain(CENTINELAS.motivoDeLasVacaciones);
  });
});

// ---------------------------------------------------------------------------
// Una escritura que falla sale UNA sola vez
// ---------------------------------------------------------------------------

/**
 * TODOS LOS CONTEOS DE ESCRITURAS DE ARRIBA CORREN SOBRE UN 200 O SOBRE UN
 * FALLO QUE SE MIRA ENSEGUIDA.
 *
 * Sobre un 200 no hay reintento que contar, y un `retry: 2` solo actua cuando
 * la peticion falla: pasa por delante de los tests de ruta, de metodo, de
 * cuerpo y de todos los `toHaveLength(1)` sin que ninguno lo note. Se midio en
 * el spec del hook: con `retry: 2` en una mutacion de esta fase, 90 tests
 * seguian en verde y `tsc` tambien.
 *
 * El daño es real y silencioso: un POST no es idempotente. Un 500 o un timeout
 * DESPUES de que la fila se escribio —el caso clasico— deja tres rangos de
 * vacaciones iguales para el mismo alumno, que al planificar el mes son tres
 * exclusiones solapadas: el alumno no pierde clases, pero el panel de
 * conflictos las lista por triplicado y nadie entiende de donde salieron.
 *
 * SE ESPERA A QUE EL ERROR ESTE PINTADO. Con un reintento, el texto no aparece
 * hasta que terminan los tres intentos, y contar antes contaria uno aunque
 * hubiera tres.
 */
describe('una escritura de vacaciones que falla sale UNA sola vez', () => {
  it('el alta', { timeout: 20_000 }, async () => {
    await montar();
    laApiFalla(new ErrorDeApi(ORDEN_DE_LAS_FECHAS, 400, { message: [ORDEN_DE_LAS_FECHAS] }));

    await completarElAlta();
    await clicEn('Cargar vacaciones');
    await screen.findByText(ORDEN_DE_LAS_FECHAS, {}, { timeout: 15_000 });

    expect(escrituras(), 'el POST se reintento: podrian quedar vacaciones duplicadas').toHaveLength(
      1,
    );
  });

  it('el borrado', { timeout: 20_000 }, async () => {
    await montar({ vacaciones: [unaVacacion()] });
    laApiFalla(new ErrorDeApi(VACACIONES_INEXISTENTES, 404));

    await clicEn('Borrar las vacaciones del 2026-12-24 a 2027-01-05');
    await confirmarEnElDialogo('Borrar');
    await screen.findByText(VACACIONES_INEXISTENTES, {}, { timeout: 15_000 });

    expect(escrituras()).toHaveLength(1);
  });
});
