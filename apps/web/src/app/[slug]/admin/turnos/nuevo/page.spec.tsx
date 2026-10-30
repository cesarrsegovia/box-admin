import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SalaPublica, TurnoPublico, UsuarioResumen } from '@boxadmin/shared';
import { ErrorDeApi } from '@/lib/cliente';
import { clavesDeCatalogos } from '@/hooks/use-catalogos';
import { clavesDeUsuarios } from '@/hooks/use-usuarios';
import { vigilarEstosDatos } from '@/test/espia-de-consola';
import PaginaDeTurnoNuevo from './page';

const { empujar, pedirEspia } = vi.hoisted(() => ({
  empujar: vi.fn(),
  pedirEspia: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: empujar, replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/mi-gym/admin/turnos/nuevo',
  useParams: () => ({ slug: 'mi-gym' }),
}));

/** Se dobla `pedir`, no `fetch`: se audita el CUERPO que la pantalla manda. */
vi.mock('@/lib/cliente', async (original) => ({
  ...(await original<typeof import('@/lib/cliente')>()),
  pedir: pedirEspia,
}));

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

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

/** Siempre con una sala de baja: si no, "solo las activas" no se distingue. */
const SALAS: SalaPublica[] = [
  unaSala({ id: 's1', nombre: 'Sala Principal' }),
  unaSala({ id: 's2', nombre: 'Sala Chica' }),
  unaSala({ id: 's-baja', nombre: 'Sala Cerrada', activa: false }),
];

/**
 * `id` (del usuario) y `perfilId` (del perfil) SIEMPRE DISTINTOS: el turno
 * nombra al perfil, y con los dos iguales ninguna asercion veria cual viajo.
 */
function unaProfesora(cambios: Partial<UsuarioResumen> = {}): UsuarioResumen {
  return {
    id: 'usuario-de-marina',
    tenantId: 't-del-gimnasio',
    nombreCompleto: 'Marina-Ferreyra-Activa',
    email: 'marina@gym.test',
    rol: 'PROFESOR',
    activo: true,
    perfilId: 'perfil-de-marina',
    telefono: null,
    packId: null,
    pagoAlDia: true,
    salaIds: ['s1'],
    ...cambios,
  };
}

const PROFESORAS: UsuarioResumen[] = [
  unaProfesora(),
  unaProfesora({
    id: 'usuario-de-lucia',
    email: 'lucia@gym.test',
    perfilId: 'perfil-de-lucia',
    nombreCompleto: 'Lucia-Benitez-Activa',
  }),
  unaProfesora({
    id: 'usuario-de-rosa',
    email: 'rosa@gym.test',
    perfilId: 'perfil-de-rosa',
    nombreCompleto: 'Rosa-Quiroga-DeBaja',
    activo: false,
  }),
];

/**
 * Los nombres de las profesoras salen en pantalla (es su trabajo), pero no
 * tienen que escaparse a la consola, al titulo ni a los almacenes. Salen del
 * fixture, no de una segunda copia escrita a mano.
 */
vigilarEstosDatos(
  Object.fromEntries(PROFESORAS.map((p, indice) => [`laProfesora${indice}`, p.nombreCompleto])),
);

function unTurnoCreado(cambios: Partial<TurnoPublico> = {}): TurnoPublico {
  return {
    id: 'turno-recien-creado',
    tenantId: 't-del-gimnasio',
    salaId: 's2',
    nombre: 'Funcional',
    fecha: '2026-11-03',
    horaInicio: '08:00',
    horaFin: '09:00',
    cupo: 12,
    reservasActivas: 0,
    lugaresLibres: 12,
    profesor: null,
    ...cambios,
  };
}

// ---------------------------------------------------------------------------
// Andamiaje
// ---------------------------------------------------------------------------

function montar({
  respuesta,
  error,
  errorDeSalas,
  errorDeProfesoras,
}: {
  respuesta?: TurnoPublico;
  error?: unknown;
  errorDeSalas?: unknown;
  errorDeProfesoras?: unknown;
} = {}) {
  pedirEspia.mockImplementation((ruta: string) => {
    if (ruta.startsWith('/salas')) {
      return errorDeSalas === undefined ? Promise.resolve(SALAS) : Promise.reject(errorDeSalas);
    }
    if (ruta.startsWith('/usuarios')) {
      return errorDeProfesoras === undefined
        ? Promise.resolve(PROFESORAS)
        : Promise.reject(errorDeProfesoras);
    }
    if (error !== undefined) return Promise.reject(error);
    return Promise.resolve(respuesta ?? unTurnoCreado());
  });

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Con el catalogo en error NO se siembra: el fallo es lo que se mira.
  if (errorDeSalas === undefined) cliente.setQueryData(clavesDeCatalogos.salas(), SALAS);
  if (errorDeProfesoras === undefined) {
    cliente.setQueryData(clavesDeUsuarios.lista({ tipo: 'profesor' }), PROFESORAS);
  }

  render(
    <QueryClientProvider client={cliente}>
      <PaginaDeTurnoNuevo />
    </QueryClientProvider>,
  );

  return userEvent.setup();
}

async function esperar(): Promise<void> {
  await act(async () => {
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      await new Promise((resolver) => setTimeout(resolver, 0));
    }
  });
}

/** Elige por el TEXTO de la opcion, que es lo unico que ve el admin. */
async function elegir(
  sesion: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
  opcion: string,
): Promise<void> {
  const control = screen.getByLabelText(etiqueta);
  const elegida = [...control.querySelectorAll('option')].find(
    (option) => option.textContent?.trim() === opcion,
  );
  if (elegida === undefined) throw new Error(`"${etiqueta}" no tiene la opcion "${opcion}"`);
  await sesion.selectOptions(control, elegida);
}

async function escribir(
  sesion: ReturnType<typeof userEvent.setup>,
  etiqueta: string,
  texto: string,
): Promise<void> {
  const control = screen.getByLabelText(etiqueta);
  await sesion.clear(control);
  await sesion.type(control, texto);
}

interface Relleno {
  inicio?: string;
  fin?: string;
  cupo?: string;
  profesora?: string;
  /** `null` = no se elige ninguna. */
  sala?: string | null;
}

/** Rellena todo lo obligatorio y envia. */
async function completarYEnviar(
  sesion: ReturnType<typeof userEvent.setup>,
  { inicio = '08:00', fin = '09:00', cupo = '12', profesora, sala = 'Sala Chica' }: Relleno = {},
): Promise<void> {
  if (sala !== null) await elegir(sesion, 'Sala', sala);
  await escribir(sesion, 'Nombre de la clase', 'Funcional');
  await escribir(sesion, 'Fecha', '2026-11-03');
  await escribir(sesion, 'Hora de inicio', inicio);
  await escribir(sesion, 'Hora de fin', fin);
  await escribir(sesion, 'Cupo', cupo);
  if (profesora !== undefined) await elegir(sesion, 'Profesora', profesora);

  await sesion.click(screen.getByRole('button', { name: /crear turno/i }));
  await esperar();
}

function esEscritura(llamada: unknown[]): boolean {
  return (llamada[1] as { metodo?: string } | undefined)?.metodo === 'POST';
}

/** El cuerpo de la UNICA escritura, encontrada por ruta y metodo. */
function cuerpoEnviado(): Record<string, unknown> {
  const llamada = pedirEspia.mock.calls.find(
    (c: unknown[]) => c[0] === '/turnos' && esEscritura(c),
  );
  if (llamada === undefined) throw new Error('La pantalla no mando el POST');
  return (llamada[1] as { cuerpo: Record<string, unknown> }).cuerpo;
}

function huboEscritura(): boolean {
  return pedirEspia.mock.calls.some((c: unknown[]) => esEscritura(c));
}

function opcionesDe(etiqueta: string): string[] {
  return [...screen.getByLabelText(etiqueta).querySelectorAll('option')].map(
    (o) => o.textContent?.trim() ?? '',
  );
}

// ---------------------------------------------------------------------------
// Los desplegables
// ---------------------------------------------------------------------------

describe('crear un turno a mano: lo que se ofrece', () => {
  it('ofrece SOLO las salas activas', () => {
    montar();

    expect(opcionesDe('Sala')).toContain('Sala Principal');
    expect(opcionesDe('Sala')).toContain('Sala Chica');
    expect(opcionesDe('Sala')).not.toContain('Sala Cerrada');
  });

  it('ofrece las profesoras activas por perfilId, y arranca en «La del horario semanal»', () => {
    montar();

    const control = screen.getByLabelText('Profesora') as HTMLSelectElement;
    expect(control.value).toBe('');
    expect(opcionesDe('Profesora')).toEqual([
      'La del horario semanal',
      'Marina-Ferreyra-Activa',
      'Lucia-Benitez-Activa',
    ]);
    // Los VALORES son perfilId, en el mismo orden; la de baja no esta.
    expect([...control.options].map((o) => o.value)).toEqual([
      '',
      'perfil-de-marina',
      'perfil-de-lucia',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Lo que viaja
// ---------------------------------------------------------------------------

describe('crear un turno a mano: lo que viaja', () => {
  it('enviar sin elegir profesora no manda profesorId', async () => {
    const sesion = montar();
    await completarYEnviar(sesion);

    expect(Object.keys(cuerpoEnviado()).sort()).toEqual(
      ['cupo', 'fecha', 'horaFin', 'horaInicio', 'nombre', 'salaId'].sort(),
    );
  });

  it('enviar con profesora manda SU perfilId, no su id de usuario', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { profesora: 'Lucia-Benitez-Activa' });

    expect(cuerpoEnviado().profesorId).toBe('perfil-de-lucia');
  });

  it('con profesora el cuerpo es EXACTAMENTE los siete campos, y ninguno mas', async () => {
    // Lista blanca tambien en la rama con profesora: el ValidationPipe lleva
    // `forbidNonWhitelisted`, y un `usuarioId` colado ahi es un 400.
    const sesion = montar();
    await completarYEnviar(sesion, { profesora: 'Marina-Ferreyra-Activa' });

    expect(cuerpoEnviado()).toEqual({
      salaId: 's2',
      nombre: 'Funcional',
      fecha: '2026-11-03',
      horaInicio: '08:00',
      horaFin: '09:00',
      cupo: 12,
      profesorId: 'perfil-de-marina',
    });
  });

  it('el cupo viaja como numero, y el resto tal como se escribio', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { cupo: '12' });

    expect(cuerpoEnviado()).toEqual({
      salaId: 's2',
      nombre: 'Funcional',
      fecha: '2026-11-03',
      horaInicio: '08:00',
      horaFin: '09:00',
      cupo: 12,
    });
    expect(typeof cuerpoEnviado().cupo).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Validacion
// ---------------------------------------------------------------------------

describe('crear un turno a mano: validacion', () => {
  it('fin antes que inicio no se envia, y se dice', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { inicio: '10:00', fin: '09:00' });

    expect(huboEscritura()).toBe(false);
    expect(screen.getByText(/despues de la de inicio/i)).toBeInTheDocument();
  });

  it('fin igual que inicio tampoco se envia', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { inicio: '09:00', fin: '09:00' });

    expect(huboEscritura()).toBe(false);
    expect(screen.getByText(/despues de la de inicio/i)).toBeInTheDocument();
  });

  it('una hora mal escrita no se envia, y se dice', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { inicio: '8', fin: '09:00' });

    expect(huboEscritura()).toBe(false);
    expect(screen.getByText(/HH:MM/)).toBeInTheDocument();
  });

  it('un cupo de cero no se envia', async () => {
    const sesion = montar();
    await completarYEnviar(sesion, { cupo: '0' });

    expect(huboEscritura()).toBe(false);
    expect(screen.getByText(/al menos 1/i)).toBeInTheDocument();
  });

  it('sin sala elegida no se envia, y el error queda atado al control', async () => {
    // Todo lo demas COMPLETO: si faltara otra cosa, el rechazo podria ser de otra regla.
    const sesion = montar();
    await completarYEnviar(sesion, { sala: null });

    expect(huboEscritura()).toBe(false);
    expect(screen.getByText(/elegi una sala/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Sala')).toHaveAccessibleDescription(/elegi una sala/i);
  });
});

// ---------------------------------------------------------------------------
// Despues de enviar
// ---------------------------------------------------------------------------

describe('crear un turno a mano: el resultado', () => {
  it('al crear navega al detalle del turno NUEVO', async () => {
    const sesion = montar({ respuesta: unTurnoCreado({ id: 'el-id-que-devolvio-la-api' }) });
    await completarYEnviar(sesion);

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar).toHaveBeenCalledWith('/mi-gym/admin/turnos/el-id-que-devolvio-la-api');
  });

  it('el error de la API se muestra tal cual y no navega', async () => {
    const sesion = montar({
      error: new ErrorDeApi('No se pueden crear turnos en una sala dada de baja', 400),
    });
    await completarYEnviar(sesion);

    expect(
      screen.getByText('No se pueden crear turnos en una sala dada de baja'),
    ).toBeInTheDocument();
    expect(empujar).not.toHaveBeenCalled();
  });

  it('mientras se envia, el boton esta deshabilitado', async () => {
    const sesion = montar();
    // La escritura NUNCA se resuelve: se mira el instante de "enviando".
    pedirEspia.mockImplementation((ruta: string) => {
      if (ruta.startsWith('/salas')) return Promise.resolve(SALAS);
      if (ruta.startsWith('/usuarios')) return Promise.resolve(PROFESORAS);
      return new Promise(() => {});
    });
    await completarYEnviar(sesion);

    expect(screen.getByRole('button', { name: /crear turno/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Catalogos y sesion
// ---------------------------------------------------------------------------

describe('crear un turno a mano: cuando algo falla', () => {
  it('si las salas no cargan, lo dice', async () => {
    montar({ errorDeSalas: new ErrorDeApi('Error interno', 500) });
    await esperar();

    expect(screen.getByText(/no se pudieron cargar las salas/i)).toBeInTheDocument();
  });

  it('si las profesoras no cargan, lo dice y se puede enviar sin profesorId', async () => {
    const sesion = montar({ errorDeProfesoras: new ErrorDeApi('Error interno', 500) });
    await esperar();

    expect(screen.getByText(/no pudimos traer las profesoras/i)).toBeInTheDocument();

    await completarYEnviar(sesion);
    expect(Object.keys(cuerpoEnviado()).sort()).toEqual(
      ['cupo', 'fecha', 'horaFin', 'horaInicio', 'nombre', 'salaId'].sort(),
    );
  });

  it('con todo en orden no hay avisos de catalogo', async () => {
    montar();
    await esperar();

    expect(screen.queryByText(/no se pudieron cargar las salas/i)).toBeNull();
    expect(screen.queryByText(/no pudimos traer las profesoras/i)).toBeNull();
  });

  it('un 401 en el POST manda al login y no enseña el mensaje crudo', async () => {
    const sesion = montar({ error: new ErrorDeApi('Unauthorized', 401) });
    await completarYEnviar(sesion);

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar.mock.calls[0]?.[0]).toContain('/mi-gym/login');
    expect(screen.queryByText('Unauthorized')).toBeNull();
    expect(screen.getByText(/tu sesion caduco/i)).toBeInTheDocument();
  });

  it('un 401 SOLO al cargar las salas manda al login, UNA sola vez', async () => {
    montar({ errorDeSalas: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar.mock.calls[0]?.[0]).toContain('/mi-gym/login');
  });

  it('un 401 SOLO al cargar las profesoras manda al login, UNA sola vez', async () => {
    montar({ errorDeProfesoras: new ErrorDeApi('Unauthorized', 401) });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
    expect(empujar.mock.calls[0]?.[0]).toContain('/mi-gym/login');
  });

  it('con los dos catalogos en 401 se va al login UNA sola vez', async () => {
    montar({
      errorDeSalas: new ErrorDeApi('Unauthorized', 401),
      errorDeProfesoras: new ErrorDeApi('Unauthorized', 401),
    });
    await esperar();

    expect(empujar).toHaveBeenCalledTimes(1);
  });

  it('un 403 en el POST dice que rol hace falta, no el texto crudo de la API', async () => {
    const sesion = montar({ error: new ErrorDeApi('Forbidden resource', 403) });
    await completarYEnviar(sesion);

    expect(
      screen.getByText('Para esto hace falta ser administrador operativo. Tu rol no alcanza.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Forbidden resource')).toBeNull();
    expect(empujar).not.toHaveBeenCalled();
  });
});
