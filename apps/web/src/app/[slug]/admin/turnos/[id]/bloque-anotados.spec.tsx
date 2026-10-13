import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type {
  Advertencia,
  ReservaCreada,
  ReservaEnTurno,
  TurnoPublico,
  UsuarioResumen,
} from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import { BloqueDeAnotados } from './bloque-anotados';

/**
 * EL BLOQUE QUE MAS DATOS DE PERSONAS MANEJA DE TODA LA FASE.
 *
 * Los demas bloques de la ficha mueven la hora, el cupo y la profesora. Este
 * mueve NOMBRES DE ALUMNOS: quien esta anotado, quien cancelo y que le paso a
 * su clase. Por eso el centinela de este archivo no es el `tenantId` —que en
 * `ReservaEnTurno` ni siquiera viaja— sino EL NOMBRE de una anotada: si ese
 * nombre aparece en la consola, en el nombre de la pestaña o en un almacen del
 * navegador, es que la pantalla lo esta sacando por un canal que nadie declaro.
 */
const ANOTADA_CENTINELA = 'Ana Perez Centinela';

/** El `tenantId` del turno, que entra por props y no tiene por que salir. */
const TENANT = 'tnt-centinela-de-anotados';

const { pedirEspia } = vi.hoisted(() => ({ pedirEspia: vi.fn() }));

/**
 * Se dobla `pedir`, no `fetch`.
 *
 * Que `pedir` arme bien la URL ya lo fijan `use-turnos.spec` y el proxy. Lo que
 * se audita aqui es un escalon mas arriba: QUE pide este bloque y QUE cuerpo
 * manda. `ErrorDeApi` se deja REAL porque el bloque ramifica con `instanceof` y
 * con `.estado`.
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
    reservasActivas: 2,
    lugaresLibres: 8,
    profesor: null,
    ...cambios,
  };
}

function unaReserva(cambios: Partial<ReservaEnTurno> = {}): ReservaEnTurno {
  return {
    id: 'r1',
    perfilId: 'p-ana',
    nombreCompleto: ANOTADA_CENTINELA,
    origen: 'ADMIN',
    esPrueba: false,
    pagoRealizado: false,
    asistio: null,
    canceladaEn: null,
    cancelacionTipo: null,
    ...cambios,
  };
}

const ANA = unaReserva({ id: 'r1', perfilId: 'p-ana', nombreCompleto: ANOTADA_CENTINELA });
const BETO = unaReserva({ id: 'r2', perfilId: 'p-beto', nombreCompleto: 'Beto Diaz' });

function unUsuario(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'u-ana',
    tenantId: TENANT,
    nombreCompleto: ANOTADA_CENTINELA,
    email: 'ana@gym.test',
    rol: 'ALUMNO',
    activo: true,
    perfilId: 'p-ana',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['sala-a'],
    ...cambios,
  };
}

/**
 * El id del USUARIO y el del PERFIL son DISTINTOS a proposito en todos lados.
 *
 * `POST /turnos/:id/reservas` pide el del PERFIL, y el DTO lo dice con todas
 * las letras. Con los dos iguales —que es como suelen quedar las fixtures—
 * mandar el equivocado seria indistinguible de mandar el bueno, y el fallo
 * aparece recien en produccion como un 404 de "Perfil inexistente".
 */
const PERSONAS = [
  unUsuario({ id: 'u-ana', perfilId: 'p-ana', nombreCompleto: ANOTADA_CENTINELA }),
  unUsuario({ id: 'u-beto', perfilId: 'p-beto', nombreCompleto: 'Beto Diaz', email: 'b@gym.test' }),
];

const OTROS_TURNOS = [
  unTurno({ id: 't1' }),
  unTurno({ id: 't2', nombre: 'Flow', fecha: '2026-11-05', horaInicio: '19:00', horaFin: '20:00' }),
];

function unaReservaCreada(advertencias: Advertencia[] = []): ReservaCreada {
  return {
    id: 'r9',
    tenantId: TENANT,
    turnoId: 't1',
    perfilId: 'p-ana',
    origen: 'ADMIN',
    esPrueba: false,
    pagoRealizado: false,
    canceladaEn: null,
    cancelacionTipo: null,
    asistio: null,
    advertencias,
  };
}

// ---------------------------------------------------------------------------
// El servidor de mentira
// ---------------------------------------------------------------------------

interface Respuestas {
  reservas: ReservaEnTurno[];
  personas: UsuarioResumen[];
  turnos: TurnoPublico[];
  creada: ReservaCreada;
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
 * vuelve a pedir las reservas. Sin el metodo, esa lectura legitima y la
 * escritura que la causo son la misma cadena y la lista no distingue una de
 * otra.
 */
function peticiones(): string[] {
  return pedirEspia.mock.calls.map(([ruta, opciones]) => {
    const metodo = (opciones as { metodo?: string } | undefined)?.metodo ?? 'GET';

    return `${metodo} ${ruta as string}`;
  });
}

interface OpcionesDeMontaje {
  turno?: TurnoPublico;
  reservas?: ReservaEnTurno[];
  personas?: UsuarioResumen[];
  turnos?: TurnoPublico[];
  creada?: ReservaCreada;
}

function prepararServidor(opciones: OpcionesDeMontaje): QueryClient {
  respuestas = {
    reservas: opciones.reservas ?? [ANA],
    personas: opciones.personas ?? PERSONAS,
    turnos: opciones.turnos ?? OTROS_TURNOS,
    creada: opciones.creada ?? unaReservaCreada(),
  };

  pedirEspia.mockImplementation((ruta: string, opcionesDePeticion?: { metodo?: string }) => {
    if (esEscritura(opcionesDePeticion) && falloDeEscritura !== null) {
      return Promise.reject(falloDeEscritura);
    }

    if (opcionesDePeticion?.metodo === 'POST') return Promise.resolve(respuestas.creada);
    // Cancelar y reasignar devuelven la reserva tocada; a este bloque le da
    // igual lo que traigan: lo que mira es la lista, que se vuelve a pedir.
    if (esEscritura(opcionesDePeticion)) return Promise.resolve(unaReservaCreada());

    if (ruta.startsWith('/usuarios')) return Promise.resolve(respuestas.personas);
    if (ruta.startsWith('/turnos/t1/reservas')) return Promise.resolve(respuestas.reservas);
    if (ruta.startsWith('/turnos')) return Promise.resolve(respuestas.turnos);

    throw new Error(`Ruta sin doblar: ${ruta}`);
  });

  // `staleTime: Infinity` para que nada se vuelva a pedir solo. Sin eso,
  // `expect(rutasPedidas()).toEqual([])` seria imposible de escribir.
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
}

/** Deja que las consultas y mutaciones se resuelvan y que React pinte. */
async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 6; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

function pintar(opciones: OpcionesDeMontaje): QueryClient {
  const cliente = prepararServidor(opciones);

  render(
    <QueryClientProvider client={cliente}>
      <BloqueDeAnotados turno={opciones.turno ?? unTurno()} />
    </QueryClientProvider>,
  );

  return cliente;
}

/** Monta, espera a que la lista llegue, y deja `pedirEspia` limpio. */
async function montar(opciones: OpcionesDeMontaje = {}): Promise<QueryClient> {
  const cliente = pintar(opciones);
  await esperar();
  pedirEspia.mockClear();

  return cliente;
}

async function clicEn(nombre: string | RegExp): Promise<void> {
  await userEvent.setup().click(screen.getByRole('button', { name: nombre }));
  await esperar();
}

/** El panel de la accion en curso (cancelar o reasignar), que NOMBRA a quien. */
function enElPanel() {
  return within(screen.getByRole('group'));
}

/** Abre el panel de cancelar de la fila de esa persona. */
async function abrirCancelarDe(nombre: string): Promise<void> {
  await clicEn(`Cancelar la reserva de ${nombre}`);
}

async function abrirReasignarDe(nombre: string): Promise<void> {
  await clicEn(`Reasignar la reserva de ${nombre}`);
}

/** Elige que le pasa a la clase y confirma. */
async function cancelarA(nombre: string, queLePasaALaClase: RegExp): Promise<void> {
  await abrirCancelarDe(nombre);
  await userEvent.setup().click(enElPanel().getByRole('radio', { name: queLePasaALaClase }));
  await clicEn('Confirmar la cancelacion');
}

/** El texto de cada fila de una tabla, celda a celda. */
function filasDe(etiqueta: string): string[][] {
  const tabla = screen.getByRole('table', { name: etiqueta });

  return [...tabla.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? ''),
  );
}

// ---------------------------------------------------------------------------
// Los canales que no son el DOM
// ---------------------------------------------------------------------------

/**
 * Lo que la pantalla dice FUERA DEL DOM lo vigila `vigilarLosCanalesDeSalida`
 * desde `vitest.setup.ts`, en todos los specs: la consola, el titulo de la
 * pagina y el nombre de la pestaña, contra los secretos del panel y contra lo
 * que cada spec registre con `vigilarEstosDatos`. Dejo de ser manual cuando se
 * vio que solo cinco de cuarenta y nueve specs se habian acordado de pedirlo.
 */
vigilarEstosDatos({ nombreDeLaAnotada: ANOTADA_CENTINELA, tenantIdDelTurno: TENANT });

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  falloDeEscritura = null;
  localStorage.clear();
  sessionStorage.clear();
});

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------

describe('la lista de anotados', () => {
  it('pide las reservas de ESE turno', async () => {
    pintar({});
    await esperar();

    expect(pedirEspia).toHaveBeenCalledWith('/turnos/t1/reservas');
  });

  /**
   * LISTA BLANCA DE PETICIONES AL MONTAR, el conjunto entero y EN ORDEN.
   *
   * Los dos catalogos que este bloque usa —las personas a anotar y los turnos
   * destino— NO se piden aqui: se piden al abrir lo que los necesita. Si
   * alguno se colara al montaje, esta lista lo ve.
   */
  it('AL MONTAR pide ESTO y nada mas', async () => {
    pintar({});
    await esperar();

    expect(peticiones()).toEqual(['GET /turnos/t1/reservas']);
  });

  it('lista a los anotados con su nombre', async () => {
    await montar({ reservas: [ANA, BETO] });

    expect(screen.getByText(ANOTADA_CENTINELA)).toBeInTheDocument();
    expect(screen.getByText('Beto Diaz')).toBeInTheDocument();
  });

  /**
   * `GET /turnos/:id/reservas` DEVUELVE TODAS, activas y canceladas: la que
   * separa es la pantalla.
   *
   * Mezclarlas no es un detalle estetico. Un admin que cuenta las filas para
   * saber si entra alguien mas contaria gente que ya no viene, y el que busca a
   * quien cancelar se encuentra dos veces el mismo nombre.
   */
  it('las canceladas van aparte y se distinguen', async () => {
    await montar({
      reservas: [
        ANA,
        unaReserva({
          id: 'r3',
          perfilId: 'p-caro',
          nombreCompleto: 'Caro Luna',
          canceladaEn: '2026-11-01T10:00:00.000Z',
          cancelacionTipo: 'DEFINITIVA',
        }),
      ],
    });

    // Solo las dos primeras celdas: la tercera son los botones de la fila.
    expect(filasDe('Anotados').map((fila) => [fila[0], fila[1]])).toEqual([
      [ANOTADA_CENTINELA, 'La anoto el admin'],
    ]);
    expect(filasDe('Canceladas').map((fila) => fila[0])).toEqual(['Caro Luna']);
  });

  /** Y la cancelada dice QUE PASO CON LA CLASE, no la sigla que viajo. */
  it('la cancelada dice que paso con la clase, sin siglas', async () => {
    await montar({
      reservas: [
        unaReserva({
          id: 'r3',
          nombreCompleto: 'Caro Luna',
          canceladaEn: '2026-11-01T10:00:00.000Z',
          cancelacionTipo: 'RECUPERABLE',
        }),
      ],
    });

    const [fila] = filasDe('Canceladas');
    expect(fila?.[1]).toMatch(/se le devolvio/i);
    expect(fila?.[1]?.toLowerCase()).not.toContain('recuperable');
  });

  it('sin nadie anotado lo dice, y no deja una tabla vacia', async () => {
    await montar({ reservas: [] });

    expect(screen.getByText(/todavia no hay nadie anotado/i)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Anotados' })).toBeNull();
  });

  it('un fallo al traer la lista se puede reintentar', async () => {
    const cliente = prepararServidor({});
    pedirEspia.mockRejectedValue(new ErrorDeApi('Sin conexion', 0));
    render(
      <QueryClientProvider client={cliente}>
        <BloqueDeAnotados turno={unTurno()} />
      </QueryClientProvider>,
    );
    await esperar();

    expect(screen.getByText(/sin conexion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Cancelar
// ---------------------------------------------------------------------------

describe('cancelar una reserva', () => {
  /**
   * LA PREGUNTA ES QUE LE PASA A LA CLASE, NO "¿QUE TIPO DE CANCELACION?".
   *
   * `ConsumoDePack` cuenta como consumidas «las no canceladas y las canceladas
   * como DEFINITIVA». O sea: una definitiva le GASTA la clase al alumno y una
   * recuperable se la DEVUELVE. Esa es la decision real, y es la que el admin
   * tiene que poder explicarle a quien esta del otro lado del mostrador.
   * «RECUPERABLE / DEFINITIVA» obliga a saberse la tabla de memoria para no
   * regalarle una clase al gimnasio o robarsela al alumno.
   */
  it('la eleccion dice QUE LE PASA A LA CLASE, no las siglas', async () => {
    await montar();

    await abrirCancelarDe(ANOTADA_CENTINELA);

    const panel = screen.getByRole('group');
    expect(within(panel).getByRole('radio', { name: /se la devolvemos/i })).toBeInTheDocument();
    expect(within(panel).getByRole('radio', { name: /se la gastamos/i })).toBeInTheDocument();

    // El texto, no el marcado: el `value` del control si lleva la sigla, que es
    // lo que viaja. Lo que no puede llevarla es lo que la persona LEE.
    const leido = panel.textContent?.toLowerCase() ?? '';
    expect(leido).not.toContain('recuperable');
    expect(leido).not.toContain('definitiva');
  });

  /**
   * NO HAY VALOR POR DEFECTO, Y NO ES UN DESCUIDO.
   *
   * Elegir por el admin es decidir en su nombre sobre la clase de otra persona.
   * Con un defecto, el camino de menor resistencia —abrir y confirmar— le gasta
   * o le devuelve la clase a alguien sin que nadie lo haya decidido.
   */
  it('NO hay un tipo elegido por defecto', async () => {
    await montar();

    await abrirCancelarDe(ANOTADA_CENTINELA);

    const elegidos = enElPanel()
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked);

    expect(elegidos).toEqual([]);
  });

  it('sin elegir no se manda nada, y lo dice', async () => {
    await montar();

    await abrirCancelarDe(ANOTADA_CENTINELA);
    await clicEn('Confirmar la cancelacion');

    expect(pedirEspia).not.toHaveBeenCalled();
    expect(enElPanel().getByText(/elegi que pasa con la clase/i)).toBeInTheDocument();
  });

  /**
   * LOS DOS VALORES, en la misma prueba.
   *
   * Elegir "se la gastamos" y mandar `recuperable` es INVISIBLE en pantalla: la
   * reserva se cancela igual, la fila desaparece igual y el cartel no cambia.
   * Lo unico que cambia es el saldo del pack del alumno, que nadie mira hasta
   * fin de mes. Fijar un solo valor dejaria pasar un codigo que manda siempre
   * el mismo.
   */
  it('manda el tipo que se eligio', async () => {
    await montar({ reservas: [ANA, BETO] });

    await cancelarA(ANOTADA_CENTINELA, /se la devolvemos/i);
    await cancelarA('Beto Diaz', /se la gastamos/i);

    expect(escrituras()).toEqual([
      ['/reservas/r1?tipo=recuperable', { metodo: 'DELETE' }],
      ['/reservas/r2?tipo=definitiva', { metodo: 'DELETE' }],
    ]);
  });

  /**
   * CON DOS SEMBRADAS. Con una sola, "cancela la suya" y "cancela la primera"
   * son indistinguibles: es la leccion del borrado de testimonios de la 6B.
   */
  it('cancela la reserva DE ESA FILA, con dos sembradas', async () => {
    await montar({ reservas: [ANA, BETO] });

    await abrirCancelarDe('Beto Diaz');

    // El panel NOMBRA a quien, que es la otra mitad: un panel que no dice de
    // quien es deja al admin confirmando a ciegas.
    expect(screen.getByRole('group')).toHaveAccessibleName(/Beto Diaz/);

    await userEvent.setup().click(enElPanel().getByRole('radio', { name: /se la devolvemos/i }));
    await clicEn('Confirmar la cancelacion');

    expect(escrituras()).toEqual([['/reservas/r2?tipo=recuperable', { metodo: 'DELETE' }]]);
  });

  it('volver sin confirmar no llama a la API', async () => {
    await montar();

    await abrirCancelarDe(ANOTADA_CENTINELA);
    await userEvent.setup().click(enElPanel().getByRole('radio', { name: /se la gastamos/i }));
    await clicEn('Volver');

    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * LISTA BLANCA DE LO QUE PROVOCA LA ACCION, CON EL METODO PEGADO A LA RUTA.
   *
   * Tras escribir, la invalidacion vuelve a pedir las reservas: esa lectura es
   * legitima y tiene que estar. Sin el metodo delante, esa lectura y la
   * escritura que la causo son la misma cadena y la lista no las distingue.
   */
  it('cancelar pide ESTO y nada mas', async () => {
    await montar();

    await cancelarA(ANOTADA_CENTINELA, /se la devolvemos/i);

    expect(peticiones()).toEqual([
      'DELETE /reservas/r1?tipo=recuperable',
      'GET /turnos/t1/reservas',
    ]);
  });

  it('cancelar una ya cancelada muestra el motivo de la API', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('La reserva ya estaba cancelada', 409));

    await cancelarA(ANOTADA_CENTINELA, /se la gastamos/i);

    expect(screen.getByText('La reserva ya estaba cancelada')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Anotar
// ---------------------------------------------------------------------------

describe('anotar a alguien', () => {
  /**
   * EL CATALOGO DE PERSONAS NO SE PIDE HASTA QUE HACE FALTA.
   *
   * Las dos mitades hacen falta: sin la segunda, el test pasaria tambien si el
   * padron no se pidiera NUNCA, y entonces no estaria fijando "tarde" sino
   * "jamas", con el selector roto y esto en verde.
   */
  it('el padron de personas NO se pide hasta abrir el anotar', async () => {
    await montar();

    expect(rutasPedidas()).toEqual([]);

    await clicEn('Anotar a alguien');

    expect(rutasPedidas()).toEqual(['/usuarios?salaId=sala-a&activo=true']);
  });

  /**
   * EL `perfilId`, NO EL `id` DEL USUARIO.
   *
   * `CrearReservaDto` lo dice con todas las letras: «El id del Perfil, no el
   * del Usuario. Los listados de usuarios devuelven `perfilId` justamente para
   * esto». Mandar el del usuario es un 404 de "Perfil inexistente" —o, peor, el
   * perfil de otra persona el dia que los ids se parezcan—.
   */
  it('manda el perfilId, NO el id del usuario', async () => {
    await montar();

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-beto');
    await clicEn('Anotar');

    expect(escrituras()).toEqual([
      ['/turnos/t1/reservas', { metodo: 'POST', cuerpo: { perfilId: 'p-beto' } }],
    ]);
  });

  /**
   * El ValidationPipe global lleva `forbidNonWhitelisted`: una clave de mas en
   * el cuerpo no se ignora, es un 400 de la peticion ENTERA.
   */
  it('el cuerpo lleva EXACTAMENTE las claves esperadas', async () => {
    await montar();

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect(cuerpoEnviado()).toEqual({ perfilId: 'p-ana' });
    expect(Object.keys(cuerpoEnviado() as object)).toEqual(['perfilId']);
  });

  it('sin elegir a nadie no se manda nada', async () => {
    await montar();

    await clicEn('Anotar a alguien');
    pedirEspia.mockClear();
    await clicEn('Anotar');

    expect(pedirEspia).not.toHaveBeenCalled();
  });

  /**
   * EL TURNO COMPLETO LO DECIDE LA API, Y SU MENSAJE TRAE EL NUMERO.
   *
   * El recuento que tiene la ficha es el de la ultima lectura: entre esa
   * lectura y el clic alguien pudo cancelar. Adivinar el 409 aqui le negaria al
   * admin un alta que la API SI aceptaria, y con un mensaje inventado en vez
   * del de la API, que dice cuantos hay sobre cuantos caben.
   */
  it('un turno completo muestra el motivo de la API con el numero', async () => {
    await montar({ turno: unTurno({ cupo: 2, reservasActivas: 2, lugaresLibres: 0 }) });
    laApiFalla(new ErrorDeApi('El turno esta completo (2/2).', 409));

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-beto');
    await clicEn('Anotar');

    expect(screen.getByText(/\(2\/2\)/)).toBeInTheDocument();
  });

  /**
   * LAS ADVERTENCIAS NO SON ERRORES: la reserva SE CREO y ademas hay algo que
   * mirar.
   *
   * `ReservaCreada extends ConAdvertencias`, y el aviso que de verdad manda la
   * API —«El alumno ya tiene N de M clases de su pack en este periodo. La
   * reserva se creo igualmente.»— es justo lo que el gimnasio cobra o no cobra.
   * Tirarlas deja un alta en verde y una clase sin cobrar.
   */
  it('las ADVERTENCIAS del alta se muestran', async () => {
    await montar({
      creada: unaReservaCreada([
        {
          codigo: 'PACK_AGOTADO',
          mensaje:
            'El alumno ya tiene 8 de 8 clases de su pack en este periodo. ' +
            'La reserva se creo igualmente.',
        },
      ]),
    });

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect(screen.getByText(/8 de 8 clases de su pack/i)).toBeInTheDocument();
  });

  it('sin advertencias no aparece ningun cartel de advertencia', async () => {
    await montar();

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect(screen.queryByText(/pero mira esto/i)).toBeNull();
  });

  it('anotar pide ESTO y nada mas', async () => {
    await montar();

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect(peticiones()).toEqual([
      'GET /usuarios?salaId=sala-a&activo=true',
      'POST /turnos/t1/reservas',
      'GET /turnos/t1/reservas',
    ]);
  });

  it('ya anotado muestra el motivo de la API', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('El usuario ya tiene una reserva activa en este turno', 409));

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect(screen.getByText(/ya tiene una reserva activa en este turno/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Reasignar
// ---------------------------------------------------------------------------

describe('reasignar una reserva', () => {
  /**
   * EL DESTINO SE ELIGE ENTRE TURNOS, Y ACOTADO A LA SALA DEL TURNO ACTUAL.
   *
   * Quien ya esta anotado aqui tiene acceso a ESTA sala; ofrecerle turnos de
   * otras es ofrecerle el 403 de «El usuario no tiene acceso a la sala del
   * turno destino». Y el turno actual no se ofrece: reasignar a donde ya esta
   * es el 409 de «ya tiene una reserva activa en el turno destino».
   */
  it('el destino se elige entre turnos, acotado a la sala del turno actual', async () => {
    await montar();

    await abrirReasignarDe(ANOTADA_CENTINELA);

    expect(rutasPedidas()).toEqual(['/turnos?salaId=sala-a']);

    const opciones = [...screen.getByLabelText('Turno destino').querySelectorAll('option')].map(
      (opcion) => opcion.getAttribute('value'),
    );

    expect(opciones).toEqual(['', 't2']);
  });

  /**
   * LAS DOS MITADES: sin la segunda, esto pasaria tambien si el catalogo de
   * turnos no se pidiera jamas.
   */
  it('el catalogo de turnos NO se pide hasta abrir el reasignar', async () => {
    await montar();

    expect(rutasPedidas()).toEqual([]);

    await abrirReasignarDe(ANOTADA_CENTINELA);

    expect(rutasPedidas()).toEqual(['/turnos?salaId=sala-a']);
  });

  /**
   * `ReasignarReservaDto` pide `turnoId`, y es el DESTINO: el origen sale de la
   * propia reserva. Mandar el turno de origen seria un no-op silencioso.
   */
  it('manda el turno destino con la clave turnoId', async () => {
    await montar();

    await abrirReasignarDe(ANOTADA_CENTINELA);
    await userEvent.setup().selectOptions(screen.getByLabelText('Turno destino'), 't2');
    await clicEn('Confirmar la reasignacion');

    expect(escrituras()).toEqual([
      ['/reservas/r1/reasignar', { metodo: 'PATCH', cuerpo: { turnoId: 't2' } }],
    ]);
  });

  it('reasigna la reserva DE ESA FILA, con dos sembradas', async () => {
    await montar({ reservas: [ANA, BETO] });

    await abrirReasignarDe('Beto Diaz');
    await userEvent.setup().selectOptions(screen.getByLabelText('Turno destino'), 't2');
    await clicEn('Confirmar la reasignacion');

    expect(escrituras()).toEqual([
      ['/reservas/r2/reasignar', { metodo: 'PATCH', cuerpo: { turnoId: 't2' } }],
    ]);
  });

  /**
   * LA CUARTA ENTRADA NO ES UN DESCUIDO, Y POR ESO ESTA ESCRITA.
   *
   * `useInvalidar` invalida el turno, sus reservas y TODA la clave `['turnos']`,
   * y cuando eso corre —dentro del `onSuccess`, antes de que el panel se
   * cierre— el selector de destinos sigue montado mirando
   * `['turnos', {salaId}]`. Asi que su catalogo se vuelve a pedir, y esta bien
   * que se pida: el turno destino acaba de ganar una reserva y la ocupacion que
   * el selector ensena cambio.
   *
   * Se deja a la vista en vez de maquillarla: el dia que aparezca una QUINTA
   * entrada, esta lista la ve.
   */
  it('reasignar pide ESTO y nada mas', async () => {
    await montar();

    await abrirReasignarDe(ANOTADA_CENTINELA);
    await userEvent.setup().selectOptions(screen.getByLabelText('Turno destino'), 't2');
    await clicEn('Confirmar la reasignacion');

    expect(peticiones()).toEqual([
      'GET /turnos?salaId=sala-a',
      'PATCH /reservas/r1/reasignar',
      'GET /turnos/t1/reservas',
      'GET /turnos?salaId=sala-a',
    ]);
  });

  it('el destino lleno muestra el motivo de la API con el numero', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('El turno destino esta completo (10/10).', 409));

    await abrirReasignarDe(ANOTADA_CENTINELA);
    await userEvent.setup().selectOptions(screen.getByLabelText('Turno destino'), 't2');
    await clicEn('Confirmar la reasignacion');

    expect(screen.getByText(/\(10\/10\)/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Los dos errores que NO se tratan como el resto del panel
// ---------------------------------------------------------------------------

describe('los dos errores distintos', () => {
  /**
   * UN 403 QUE NO ES DE ROL.
   *
   * El panel traduce los 403 a «para esto hace falta ser tal rol». Aqui eso
   * seria MENTIR: el admin tiene el rol de sobra —si no, no habria llegado a la
   * ficha—; el que no tiene acceso a la sala es EL ALUMNO. Y la diferencia no
   * es cosmetica: con el mensaje de rol, el admin llama al dueño del salon a
   * pedir permisos que ya tiene, en vez de abrir la ficha del alumno y
   * asignarle la sala.
   *
   * No se afirma contra `/necesit/i`: `mensajeDeFallo` nunca dice "necesitas",
   * dice «Para esto hace falta ser ...». Una afirmacion contra una palabra que
   * el codigo no usa esta en verde por casualidad ortografica y no fijaria
   * nada.
   */
  it('el 403 de sala NO se traduce a un mensaje de rol', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('El usuario no tiene acceso a la sala del turno destino', 403));

    await abrirReasignarDe(ANOTADA_CENTINELA);
    await userEvent.setup().selectOptions(screen.getByLabelText('Turno destino'), 't2');
    await clicEn('Confirmar la reasignacion');

    expect(screen.getByText(/no tiene acceso a la sala/i)).toBeInTheDocument();
    expect(screen.queryByText(/hace falta ser/i)).toBeNull();
    expect(screen.queryByText(/tu rol no alcanza/i)).toBeNull();
  });

  /**
   * LA OTRA MITAD. Sin esto, el bloque podria no traducir NINGUN 403 y el test
   * de arriba seguiria verde: estaria fijando "nunca miente" en vez de
   * "distingue". El 403 del guard de roles —«Sin permisos para esta
   * operacion»— no le dice nada a nadie delante del mostrador.
   */
  it('el 403 de rol SI dice que el rol no alcanza', async () => {
    await montar();
    laApiFalla(new ErrorDeApi('Sin permisos para esta operacion', 403));

    await cancelarA(ANOTADA_CENTINELA, /se la gastamos/i);

    expect(screen.getByText(/hace falta ser administrador operativo/i)).toBeInTheDocument();
  });

  /**
   * UN 409 QUE SI ES REINTENTABLE, a diferencia de todos los demas.
   *
   * Los otros 409 de reservas piden OTRA ACCION: cancela antes de borrar, crea
   * una nueva en vez de reasignar, elegi otro turno porque este esta lleno.
   * Este pide LO MISMO MAS TARDE: la transaccion Serializable del cupo se
   * solapo con otra y la base aborto una. Ofrecer "reintentar" en los otros
   * seria invitar a repetir algo que va a volver a fallar igual.
   */
  it('el 409 de concurrencia OFRECE REINTENTAR y los otros no', async () => {
    await montar();
    laApiFalla(
      new ErrorDeApi(
        'Otra peticion esta tocando este turno ahora mismo; reintenta en unos segundos.',
        409,
      ),
    );

    await cancelarA(ANOTADA_CENTINELA, /se la devolvemos/i);

    expect(enElPanel().getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();

    // Y el otro 409, el que pide otra accion, NO lo ofrece.
    await clicEn('Volver');
    laApiFalla(new ErrorDeApi('La reserva ya estaba cancelada', 409));
    await cancelarA(ANOTADA_CENTINELA, /se la devolvemos/i);

    expect(enElPanel().queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  /** Y reintentar REPITE LA MISMA peticion, con el tipo que ya se habia elegido. */
  it('reintentar repite la misma peticion', async () => {
    await montar();
    laApiFalla(
      new ErrorDeApi(
        'Otra peticion esta tocando este turno ahora mismo; reintenta en unos segundos.',
        409,
      ),
    );

    await cancelarA(ANOTADA_CENTINELA, /se la gastamos/i);
    falloDeEscritura = null;
    await userEvent.setup().click(enElPanel().getByRole('button', { name: 'Reintentar' }));
    await esperar();

    expect(escrituras()).toEqual([
      ['/reservas/r1?tipo=definitiva', { metodo: 'DELETE' }],
      ['/reservas/r1?tipo=definitiva', { metodo: 'DELETE' }],
    ]);
  });
});

// ---------------------------------------------------------------------------
// Las fugas
// ---------------------------------------------------------------------------

describe('lo que no sale de aqui', () => {
  /**
   * LOS IDENTIFICADORES NO SE PINTAN, NI SIQUIERA COMO RESPALDO.
   *
   * Se monta con una reserva SIN NOMBRE RESUELTO a proposito: con todas las
   * filas trayendo nombre, "pinto el nombre" y "pinto el id si no hay nombre"
   * son indistinguibles, y un `?? reserva.perfilId` de respaldo pasaria entero.
   * Un identificador delante del mostrador no le sirve a nadie, y encima es el
   * dato con el que se cruzan tablas.
   */
  it('los identificadores no entran en el marcado', async () => {
    await montar({
      reservas: [
        unaReserva({
          id: 'rsv-centinela-sin-nombre',
          perfilId: 'perfil-centinela-sin-nombre',
          nombreCompleto: '',
        }),
      ],
    });

    expect(screen.getByText(/sin nombre/i)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain('perfil-centinela-sin-nombre');
    expect(document.body.innerHTML).not.toContain('rsv-centinela-sin-nombre');
  });

  it('el tenantId del turno no aparece en el DOM', async () => {
    await montar({ reservas: [ANA, BETO] });

    expect(document.body.innerHTML).not.toContain(TENANT);
  });

  it('no queda nada en el almacenamiento del navegador', async () => {
    await montar({ reservas: [ANA, BETO] });

    await clicEn('Anotar a alguien');
    await userEvent.setup().selectOptions(screen.getByLabelText('Persona a anotar'), 'p-ana');
    await clicEn('Anotar');

    expect({ local: { ...localStorage }, sesion: { ...sessionStorage } }).toEqual({
      local: {},
      sesion: {},
    });
  });
});
