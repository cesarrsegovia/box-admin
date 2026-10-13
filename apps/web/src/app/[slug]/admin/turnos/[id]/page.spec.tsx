import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReservaEnTurno, TurnoPublico, UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeTurnos } from '@/hooks/use-turnos';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import PaginaDeFichaDeTurno from './page';

/**
 * El centinela de esta pantalla: el `tenantId` del turno.
 *
 * No es una contrasena, pero es EL dato que la Fase 0 se ocupo de que no
 * cruzara entre gimnasios, y es el que viaja en todas las respuestas de turnos
 * sin que ninguna pantalla tenga nada que hacer con el. Sirve igual de
 * centinela: si aparece en el DOM o en la consola, es que algo esta volcando la
 * respuesta entera en algun sitio.
 */
const TENANT = 'tnt-centinela-del-turno';

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

/** El query de la URL, que algun test cambia para mirar el `volverA`. */
let queryActual = '';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ slug: 'mi-gym', id: 't1' }),
  useSearchParams: () => new URLSearchParams(queryActual),
  usePathname: () => '/mi-gym/admin/turnos/t1',
}));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fijan `use-turnos.spec` y el proxy. Lo que
 * se audita aqui es un escalon mas arriba: QUE pide la ficha y QUE cuerpo
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

function unTurno(cambios: Partial<TurnoPublico> = {}): TurnoPublico {
  return {
    id: 't1',
    tenantId: TENANT,
    salaId: 'sala-a',
    nombre: 'Flow',
    fecha: '2026-11-03',
    horaInicio: '18:00',
    horaFin: '19:00',
    cupo: 10,
    reservasActivas: 0,
    lugaresLibres: 10,
    profesor: null,
    ...cambios,
  };
}

function unaProfesora(id: string, nombreCompleto: string, activo = true): UsuarioResumen {
  return {
    id,
    tenantId: TENANT,
    nombreCompleto,
    email: `${id}@gym.test`,
    rol: 'PROFESOR',
    activo,
    perfilId: `p-${id}`,
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['sala-a'],
  };
}

const PROFESORAS = [unaProfesora('prof-1', 'Ana Perez'), unaProfesora('prof-2', 'Beto Diaz')];

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface Respuestas {
  turno: TurnoPublico;
  profesoras: UsuarioResumen[];
  /** Las del bloque de anotados, que pide su propia lista. */
  reservas: ReservaEnTurno[];
}

let respuestas: Respuestas;
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

/** El cuerpo de la UNICA escritura que hubo. Falla si hubo otra cantidad. */
function cuerpoEnviado(): unknown {
  const hechas = escrituras();
  expect(hechas, 'se esperaba exactamente una escritura').toHaveLength(1);

  return hechas[0]?.[1].cuerpo;
}

/** Las rutas pedidas, EN ORDEN y sin deduplicar, escrituras incluidas. */
function rutasPedidas(): string[] {
  return pedirEspia.mock.calls.map(([ruta]) => ruta as string);
}

/**
 * Lo mismo pero CON EL METODO, para auditar lo que provoca una ACCION.
 *
 * Despues de una escritura hay siempre una lectura: la invalidacion del hook
 * vuelve a pedir el turno. Sin el metodo, esa lectura y el PATCH que la causo
 * son la misma cadena y la lista no distingue una de otra.
 */
function peticiones(): string[] {
  return pedirEspia.mock.calls.map(([ruta, opciones]) => {
    const metodo = (opciones as { metodo?: string } | undefined)?.metodo ?? 'GET';

    return `${metodo} ${ruta as string}`;
  });
}

interface OpcionesDeMontaje {
  turno?: TurnoPublico;
  profesoras?: UsuarioResumen[];
  reservas?: ReservaEnTurno[];
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  respuestas = {
    turno: opciones.turno ?? unTurno(),
    profesoras: opciones.profesoras ?? PROFESORAS,
    reservas: opciones.reservas ?? [],
  };

  pedirEspia.mockImplementation((ruta: string, opcionesDePeticion?: { metodo?: string }) => {
    if (esEscritura(opcionesDePeticion) && falloDeEscritura !== null) {
      return Promise.reject(falloDeEscritura);
    }

    // El DELETE contesta 204 sin cuerpo, y `pedir` lo traduce a `null`.
    if (opcionesDePeticion?.metodo === 'DELETE') return Promise.resolve(null);
    if (ruta.startsWith('/usuarios')) return Promise.resolve(respuestas.profesoras);
    if (ruta.endsWith('/reservas')) return Promise.resolve(respuestas.reservas);

    return Promise.resolve(respuestas.turno);
  });

  // `staleTime: Infinity` para que lo SEMBRADO no se vuelva a pedir. Sin eso,
  // `expect(pedirEspia).not.toHaveBeenCalled()` seria imposible de escribir.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

async function pintar(cliente: QueryClient): Promise<void> {
  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeFichaDeTurno />
    </QueryClientProvider>,
  );
  await Promise.resolve();
}

/** Monta con el turno Y SUS RESERVAS sembrados, y deja `pedirEspia` limpio. */
async function montar(opciones: OpcionesDeMontaje = {}): Promise<QueryClient> {
  const cliente = prepararServidor(opciones);

  cliente.setQueryData(clavesDeTurnos.uno('t1'), respuestas.turno);
  // El bloque de anotados pide su propia lista. Sembrarla es lo que mantiene a
  // las listas blancas de los OTROS bloques diciendo lo que vinieron a decir:
  // sin esto, cada una ganaria una lectura que no es suya.
  cliente.setQueryData(clavesDeTurnos.reservas('t1'), respuestas.reservas);

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
 * No busca el texto en la pantalla: busca el nodo al que el control apunta con
 * `aria-describedby`. Un error pintado en un cartel de arriba devuelve `null`
 * aunque el texto este visible, que es justo lo que hay que distinguir.
 */
function errorDelCampo(etiqueta: string | RegExp): string | null {
  const campo = screen.getByLabelText(etiqueta);
  const id = campo.getAttribute('aria-describedby');
  if (id === null) return null;

  return document.getElementById(id)?.textContent ?? null;
}

function formularioDeDatos(): HTMLFormElement {
  const formulario = document.querySelector<HTMLFormElement>('form[aria-label="Datos del turno"]');
  if (formulario === null) throw new Error('No hay formulario de datos');

  return formulario;
}

/** Las etiquetas visibles del bloque de datos. */
function camposDelFormularioDeDatos(): string[] {
  return [...formularioDeDatos().querySelectorAll('label')].map(
    (etiqueta) => etiqueta.textContent?.trim() ?? '',
  );
}

/**
 * Los `name` de TODOS los controles del formulario, SIN pasar por el arbol de
 * accesibilidad y SIN pasar por las etiquetas.
 *
 * Es lo unico que ve un campo oculto: un `<input type="hidden">` no tiene
 * etiqueta que mirar y `*ByRole` lo excluye de oficio, pero el formulario lo
 * MANDA IGUAL, y con `forbidNonWhitelisted` eso es un 400 de la peticion entera.
 */
function controlesDelFormularioDeDatos(): string[] {
  return [...formularioDeDatos().querySelectorAll('input, select, textarea')].map((control) =>
    control.getAttribute('name'),
  ) as string[];
}

/**
 * Los botones QUE HAY EN EL MARCADO, sin pasar por el arbol de accesibilidad.
 *
 * `getAllByRole('button')` excluye por su cuenta lo que lleva `hidden`,
 * `aria-hidden` o `display:none`, asi que con el no se puede afirmar que algo NO
 * ESTA: se puede afirmar que no se ve, que es otra cosa.
 */
function botonesDelDocumento(): string[] {
  return [...document.querySelectorAll('button')].map((boton) => boton.textContent?.trim() ?? '');
}

// ---------------------------------------------------------------------------
// Lo que no sale de esta pantalla
// ---------------------------------------------------------------------------

/**
 * Lo que la pantalla dice FUERA DEL DOM lo vigila `vigilarLosCanalesDeSalida`
 * desde `vitest.setup.ts`, en todos los specs: la consola, el titulo de la
 * pagina y el nombre de la pestaña, contra los secretos del panel y contra lo
 * que cada spec registre con `vigilarEstosDatos`. Dejo de ser manual cuando se
 * vio que solo cinco de cuarenta y nueve specs se habian acordado de pedirlo.
 */
vigilarEstosDatos({ tenantIdDelTurno: TENANT });

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  falloDeEscritura = null;
  queryActual = '';
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// La carga
// ---------------------------------------------------------------------------

describe('la ficha de un turno', () => {
  it('pide ESE turno', async () => {
    await montarPidiendo();
    await esperar();

    expect(pedirEspia).toHaveBeenCalledWith('/turnos/t1');
  });

  /**
   * LISTA BLANCA DE PETICIONES, el conjunto entero, EN ORDEN y SIN DEDUPLICAR.
   *
   * Ordenada porque el orden es parte de lo que se fija —una lectura que se
   * cuela antes del turno es una lectura que no espero—, y sin deduplicar
   * porque pedir dos veces lo mismo tambien es un fallo: con `staleTime`
   * infinito en el cliente del test, un doble pedido solo puede venir de dos
   * consultas con claves distintas pidiendo la misma ruta.
   */
  it('AL MONTAR salen ESTAS peticiones y ninguna mas', async () => {
    await montarPidiendo();
    await esperar();

    // DOS, y en este orden: el bloque de anotados no existe hasta que el turno
    // llega, y entonces pide su lista. Los catalogos que ese bloque usa —las
    // personas a anotar y los turnos destino— NO estan aqui, y no estarlo es
    // justamente lo que esta lista fija.
    expect(rutasPedidas()).toEqual(['/turnos/t1', '/turnos/t1/reservas']);
  });

  it('muestra el turno con su fecha y su horario', async () => {
    await montar({ turno: unTurno({ nombre: 'Flow', fecha: '2026-11-03' }) });

    expect(screen.getByRole('heading', { name: 'Flow' })).toBeInTheDocument();
    expect(screen.getByText(/2026-11-03/)).toBeInTheDocument();
    expect(screen.getByText(/18:00/)).toBeInTheDocument();
  });

  /**
   * UN 401 MANDA AL LOGIN CONSERVANDO LA RUTA, Y SE MONTA CON QUERY.
   *
   * Montarlo sin query seria fijarlo en el unico escenario donde la distincion
   * no existe: con la URL pelada, conservar el query y tirarlo dan exactamente
   * el mismo destino, y el test no podria ver la diferencia.
   */
  it('un 401 manda al login conservando la ruta', async () => {
    queryActual = 'volverA=%2Fmi-gym%2Fadmin%2Fturnos%3Fdesde%3D2026-11-01';

    const cliente = prepararServidor({});
    pedirEspia.mockRejectedValue(new ErrorDeApi('Sin sesion', 401));
    await pintar(cliente);
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent(
        '/mi-gym/admin/turnos/t1?volverA=%2Fmi-gym%2Fadmin%2Fturnos%3Fdesde%3D2026-11-01',
      )}`,
    );
  });

  it('sin query el destino no lleva un ? pelado', async () => {
    const cliente = prepararServidor({});
    pedirEspia.mockRejectedValue(new ErrorDeApi('Sin sesion', 401));
    await pintar(cliente);
    await esperar();

    expect(empujar).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/admin/turnos/t1')}`,
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
   * EL ORDEN DE LOS BLOQUES ES UNA DECISION, NO EL ORDEN EN QUE SE ESCRIBIERON.
   *
   * El cartel de borrar dice «Cancelalas antes de borrarlo», y el sitio donde
   * se cancelan es el bloque de anotados. Si ese bloque quedara DEBAJO del
   * cartel que lo nombra, el admin lee la instruccion y no ve a donde ir.
   */
  it('los bloques van en ESTE orden, con los anotados antes de borrar', async () => {
    await montar();

    const titulos = [...document.querySelectorAll('h2')].map((h2) => h2.textContent?.trim() ?? '');

    expect(titulos).toEqual(['Datos', 'Profesora', 'Anotados', 'Borrar']);
  });

  it('el tenantId no aparece en ninguna parte del DOM', async () => {
    await montar();

    expect(document.body.innerHTML).not.toContain(TENANT);
  });

  it('no queda nada en el almacenamiento del navegador', async () => {
    await montar({ turno: unTurno({ profesor: { id: 'prof-1', nombreCompleto: 'Ana Perez' } }) });
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
    await montar({ turno: unTurno({ nombre: 'Flow', cupo: 10 }) });

    await escribir('Cupo', '12');
    await clicEn('Guardar datos');

    expect(escrituras()).toEqual([['/turnos/t1', { metodo: 'PATCH', cuerpo: { cupo: 12 } }]]);
  });

  it('dos campos cambiados viajan los dos, y nada mas', async () => {
    await montar({ turno: unTurno({ nombre: 'Flow', horaFin: '19:00' }) });

    await escribir('Nombre', 'Flow suave');
    await escribir('Hora de fin', '19:30');
    await clicEn('Guardar datos');

    expect(cuerpoEnviado()).toEqual({ nombre: 'Flow suave', horaFin: '19:30' });
  });

  /**
   * LISTA BLANCA DE LO QUE PROVOCA UNA ACCION, no solo de lo que provoca el
   * montaje.
   *
   * Todos los demas tests de peticiones de este archivo estan anclados al
   * montaje o al unico clic que abre el selector de profesora; los de guardar
   * miran `escrituras()`, que FILTRA las lecturas. Entre los tres dejaban una
   * dimension entera sin mirar: lo que una pantalla pide DESPUES de guardar.
   *
   * Ahi cabe —y sobrevivio a los 33 tests de este archivo— un
   * `prefetchQuery` de `/turnos/:id/reservas` metido en el guardado "para que
   * el bloque de anotados no parpadee": una peticion que nadie declaro, con los
   * nombres y los datos de los alumnos anotados, traidos por el bloque que
   * cambia la hora y guardados en una cache que dura lo que dura la pestaña.
   *
   * La lectura que SI va es la del propio turno: el hook invalida tras escribir
   * y la ficha esta montada mirandolo. Esa es toda la lista.
   */
  it('guardar los datos pide ESTO y nada mas', async () => {
    await montar({ turno: unTurno({ cupo: 10 }) });

    await escribir('Cupo', '12');
    await clicEn('Guardar datos');

    // DOS, y la que NO esta es la que importa: no vuelve a pedirse
    // `/turnos/t1/reservas`. Cambiar el cupo no cambia quien esta anotado, y
    // desde que la ficha tiene bloque de anotados esa consulta SI tiene
    // observador: la version unica de `useInvalidar` la refrescaba igual, y
    // traia de vuelta los nombres de los alumnos por una escritura que no los
    // toca. Ver `useInvalidarAnotados` en `use-turnos`.
    expect(peticiones()).toEqual(['PATCH /turnos/t1', 'GET /turnos/t1']);
  });

  it('sin cambios no hay peticion', async () => {
    await montar();

    await clicEn('Guardar datos');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(screen.getByText(/no cambiaste nada/i)).toBeInTheDocument();
  });

  /**
   * El 409 del cupo. La API dice POR QUE —cuantas reservas hay— y esa es toda
   * la informacion util: con "no se pudo guardar" el admin no sabe a cuanto si
   * puede bajarlo.
   */
  it('bajar el cupo por debajo de los anotados muestra el motivo de la API', async () => {
    await montar({ turno: unTurno({ cupo: 10, reservasActivas: 3 }) });
    laApiFalla(
      new ErrorDeApi(
        'El turno ya tiene 3 reserva(s) activa(s); el cupo no puede bajar de ahi. ' +
          'Cancela reservas primero.',
        409,
        {
          message:
            'El turno ya tiene 3 reserva(s) activa(s); el cupo no puede bajar de ahi. ' +
            'Cancela reservas primero.',
          error: 'Conflict',
          statusCode: 409,
        },
      ),
    );

    await escribir('Cupo', '2');
    await clicEn('Guardar datos');

    expect(errorDelCampo('Cupo')).toMatch(/3 reserva\(s\) activa\(s\)/);
  });

  /**
   * LA PETICION SALE IGUAL, aunque la ficha ya diga que hay tres anotados.
   *
   * El recuento que tiene la pantalla es el de la ultima lectura, y entre esa
   * lectura y el clic alguien pudo cancelar. Adivinar el 409 aqui le negaria al
   * admin un cambio que la API SI aceptaria.
   */
  it('el cupo bajo no se bloquea en la pantalla: lo decide la API', async () => {
    await montar({ turno: unTurno({ cupo: 10, reservasActivas: 3 }) });

    await escribir('Cupo', '2');
    await clicEn('Guardar datos');

    expect(escrituras()).toEqual([['/turnos/t1', { metodo: 'PATCH', cuerpo: { cupo: 2 } }]]);
  });

  /**
   * `ActualizarTurnoDto` NO acepta `salaId`: mover un turno de sala invalidaria
   * los accesos de quienes ya reservaron.
   *
   * Afirmado sobre el MARCADO, no con `queryByRole`: `*ByRole` consulta el arbol
   * de accesibilidad, que ya excluye lo que lleva `hidden`. Un campo oculto
   * sigue estando en el formulario y SE MANDA IGUAL, y con
   * `forbidNonWhitelisted` eso es un 400 que tira la peticion entera —y se
   * lleva por delante el cupo que iba al lado.
   */
  it('no ofrece cambiar la sala', async () => {
    await montar({ turno: unTurno({ salaId: 'sala-a' }) });

    expect(controlesDelFormularioDeDatos()).toEqual([
      'nombre',
      'fecha',
      'horaInicio',
      'horaFin',
      'cupo',
    ]);
    expect(formularioDeDatos().innerHTML.toLowerCase()).not.toContain('sala');
  });

  it('el formulario tiene ESTOS campos y solo estos', async () => {
    await montar();

    expect(camposDelFormularioDeDatos()).toEqual([
      'Nombre',
      'Fecha',
      'Hora de inicio',
      'Hora de fin',
      'Cupo',
    ]);
  });

  it('una hora de fin anterior a la de inicio no se manda', async () => {
    await montar({ turno: unTurno({ horaInicio: '18:00', horaFin: '19:00' }) });

    await escribir('Hora de fin', '17:00');
    await clicEn('Guardar datos');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(errorDelCampo('Hora de fin')).toMatch(/despues/i);
  });

  it('un cupo de cero no se manda: el DTO pide 1 como minimo', async () => {
    await montar();

    await escribir('Cupo', '0');
    await clicEn('Guardar datos');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(errorDelCampo('Cupo')).not.toBeNull();
  });

  it('guardar dos veces seguidas no vuelve a mandar lo ya guardado', async () => {
    await montar({ turno: unTurno({ cupo: 10 }) });

    await escribir('Cupo', '12');
    await clicEn('Guardar datos');
    await clicEn('Guardar datos');

    expect(escrituras()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// La profesora
// ---------------------------------------------------------------------------

describe('el bloque de la profesora', () => {
  it('dice quien la da, o que no hay nadie', async () => {
    await montar({ turno: unTurno({ profesor: null }) });

    expect(screen.getByText(/sin profesora/i)).toBeInTheDocument();
  });

  /**
   * EL CATALOGO NO SE PIDE HASTA QUE HACE FALTA.
   *
   * Cambiar la profesora es la mas rara de las tres acciones de esta ficha:
   * traer el padron entero de profesoras al montar es una peticion que casi
   * nunca se usa, en una pantalla que se abre todo el dia.
   *
   * Las dos mitades hacen falta. Sin la segunda, el test pasaria tambien si el
   * catalogo no se pidiera NUNCA —y entonces no estaria fijando "tarde" sino
   * "jamas", y el selector estaria roto sin que esto se entere.
   */
  it('el catalogo de profesoras NO se pide hasta que hace falta', async () => {
    await montar();
    await esperar();

    expect(rutasPedidas()).toEqual([]);

    await clicEn('Cambiar profesora');

    expect(rutasPedidas()).toEqual(['/usuarios?tipo=profesor']);
  });

  it('asignar una profesora manda su id', async () => {
    await montar({ turno: unTurno({ profesor: null }) });

    await clicEn('Cambiar profesora');
    await userEvent.setup().selectOptions(screen.getByLabelText('Profesora a cargo'), 'prof-2');
    await clicEn('Guardar profesora');

    expect(escrituras()).toEqual([
      ['/turnos/t1/profesor', { metodo: 'PATCH', cuerpo: { profesorId: 'prof-2' } }],
    ]);
  });

  /**
   * `AsignarProfesorDto` usa `@ValidateIf` y no `@IsOptional` A PROPOSITO:
   * `profesorId: null` es un valor legitimo —quitar la profesora— y hay que
   * distinguirlo de "no vino la clave". Omitir la clave NO la quita: el DTO la
   * da por ausente y el turno se queda como estaba, en silencio y en verde.
   */
  it('quitar la profesora manda null EXPLICITO, no omite la clave', async () => {
    await montar({ turno: unTurno({ profesor: { id: 'prof-1', nombreCompleto: 'Ana Perez' } }) });

    await clicEn('Cambiar profesora');
    await userEvent.setup().selectOptions(screen.getByLabelText('Profesora a cargo'), '');
    await clicEn('Guardar profesora');

    expect(cuerpoEnviado()).toEqual({ profesorId: null });
  });

  /** La misma lista blanca, en el otro bloque que escribe y se queda. */
  it('guardar la profesora pide ESTO y nada mas', async () => {
    await montar({ turno: unTurno({ profesor: null }) });

    await clicEn('Cambiar profesora');
    await userEvent.setup().selectOptions(screen.getByLabelText('Profesora a cargo'), 'prof-2');
    await clicEn('Guardar profesora');

    expect(peticiones()).toEqual([
      'GET /usuarios?tipo=profesor',
      'PATCH /turnos/t1/profesor',
      'GET /turnos/t1',
    ]);
  });

  it('la que ya esta puesta viene elegida en el selector', async () => {
    await montar({ turno: unTurno({ profesor: { id: 'prof-2', nombreCompleto: 'Beto Diaz' } }) });

    await clicEn('Cambiar profesora');

    expect(screen.getByLabelText('Profesora a cargo')).toHaveValue('prof-2');
  });

  /**
   * La profesora puesta sigue en la lista aunque este dada de baja.
   *
   * Sin ella, el selector arrancaria en "sin profesora" para un turno que SI
   * tiene una, y guardar cualquier otra cosa seria guardar sobre una mentira.
   */
  it('una profesora dada de baja no se ofrece, pero la del turno sigue estando', async () => {
    await montar({
      turno: unTurno({ profesor: { id: 'prof-4', nombreCompleto: 'Dani Rios' } }),
      profesoras: [
        ...PROFESORAS,
        unaProfesora('prof-4', 'Dani Rios', false),
        unaProfesora('prof-5', 'Eva Sol', false),
      ],
    });

    await clicEn('Cambiar profesora');

    const opciones = [...screen.getByLabelText('Profesora a cargo').querySelectorAll('option')].map(
      (opcion) => opcion.getAttribute('value'),
    );

    expect(opciones).toContain('prof-4');
    expect(opciones).not.toContain('prof-5');
  });

  it('cancelar el cambio no llama a la API', async () => {
    await montar();

    await clicEn('Cambiar profesora');
    await userEvent.setup().selectOptions(screen.getByLabelText('Profesora a cargo'), 'prof-2');
    await clicEn('Cancelar');

    expect(escrituras()).toEqual([]);
  });

  it('el fallo de la API se muestra tal cual', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('Esa profesora no tiene acceso a la sala del turno', 400));

    await clicEn('Cambiar profesora');
    await userEvent.setup().selectOptions(screen.getByLabelText('Profesora a cargo'), 'prof-2');
    await clicEn('Guardar profesora');

    expect(screen.getByText(/no tiene acceso a la sala/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Borrar
// ---------------------------------------------------------------------------

describe('borrar el turno', () => {
  /**
   * EL BORRADO DA 409 SI HAY RESERVAS ACTIVAS, y eso se sabe ANTES de pulsar.
   *
   * Ofrecer el boton y contestar con el 409 convierte una regla conocida en un
   * error, y encima deja al admin creyendo que el turno se borro hasta que lee
   * el cartel. Se afirma sobre el MARCADO porque un boton escondido con CSS
   * sigue estando a un clic.
   */
  it('BORRAR dice de entrada si hay anotados, y no se ofrece como si fuera a funcionar', async () => {
    await montar({ turno: unTurno({ reservasActivas: 3 }) });

    expect(screen.getByText(/3 reserva\(s\) activa\(s\)/)).toBeInTheDocument();
    expect(botonesDelDocumento()).not.toContain('Borrar turno');
  });

  it('sin anotados SI se ofrece', async () => {
    await montar({ turno: unTurno({ reservasActivas: 0 }) });

    expect(botonesDelDocumento()).toContain('Borrar turno');
  });

  /**
   * El dialogo NOMBRA el turno. "¿Estas seguro?" sobre una pestaña vieja es
   * como se borra el turno equivocado: dos turnos del mismo nombre en dias
   * distintos se distinguen por la fecha y la hora, no por el nombre.
   */
  it('borrar confirma NOMBRANDO el turno', async () => {
    await montar({
      turno: unTurno({
        nombre: 'Flow',
        fecha: '2026-11-03',
        horaInicio: '18:00',
        horaFin: '19:00',
      }),
    });

    await clicEn('Borrar turno');

    expect(screen.getByRole('dialog')).toHaveTextContent('Flow');
    expect(screen.getByRole('dialog')).toHaveTextContent('2026-11-03');
    expect(screen.getByRole('dialog')).toHaveTextContent('18:00');
  });

  it('cancelar la confirmacion no llama a la API', async () => {
    await montar();

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Cancelar');

    expect(pedirEspia).not.toHaveBeenCalled();
  });

  it('confirmar borra el turno', async () => {
    await montar();

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Borrar turno');

    expect(escrituras()).toEqual([['/turnos/t1', { metodo: 'DELETE' }]]);
  });

  it('tras borrar vuelve al listado', async () => {
    await montar();

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Borrar turno');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos');
  });

  /**
   * SE VUELVE AL LISTADO CON LOS FILTROS CON LOS QUE SE LLEGO, Y SE MONTA CON
   * FILTROS PUESTOS.
   *
   * Montarlo sin ellos seria fijarlo en el unico escenario donde la distincion
   * no existe: con la URL pelada, conservarlos y tirarlos dan exactamente el
   * mismo destino, y el test no podria ver la diferencia. Es el mismo caso
   * ciego que el `volverA` del 401 de aqui arriba.
   */
  it('tras borrar vuelve al listado CON los filtros con los que se llego', async () => {
    queryActual = 'salaId=sala-a&desde=2026-11-01';
    await montar();

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Borrar turno');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos?desde=2026-11-01&salaId=sala-a');
  });

  /**
   * Y VIAJAN LOS FILTROS, NO LA URL ENTERA.
   *
   * La de la ficha puede llevar cosas que en el listado no significan nada —el
   * `volverA` con el que se vuelve del login es la que ya existe—. Reenviarlas
   * no rompe la pantalla, pero deja en la barra de direcciones un enlace que la
   * persona puede copiar y mandar, con una ruta de retorno vieja pegada detras.
   */
  it('lo que no es un filtro del listado no viaja de vuelta', async () => {
    queryActual = 'volverA=%2Fmi-gym%2Fadmin&desde=2026-11-01&salaId=';
    await montar();

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Borrar turno');

    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos?desde=2026-11-01');
  });

  /**
   * EL 409 SE MANEJA IGUAL, aunque la ficha dijera que no habia nadie.
   *
   * El recuento es el de la ultima lectura: entre esa lectura y la confirmacion
   * alguien puede anotarse desde su telefono. Sin esto, el admin ve el dialogo
   * cerrarse y da por borrado un turno que sigue vivo.
   */
  it('borrar igual maneja el 409, por si alguien se anota en el medio', async () => {
    await montar({ turno: unTurno({ reservasActivas: 0 }) });
    laApiFalla(
      new ErrorDeApi('El turno tiene 1 reserva(s) activa(s). Cancelalas antes de borrarlo.', 409, {
        message: 'El turno tiene 1 reserva(s) activa(s). Cancelalas antes de borrarlo.',
        error: 'Conflict',
        statusCode: 409,
      }),
    );

    await clicEn('Borrar turno');
    await confirmarEnElDialogo('Borrar turno');

    expect(enElDialogo().getByText(/1 reserva\(s\) activa\(s\)/)).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });
});
