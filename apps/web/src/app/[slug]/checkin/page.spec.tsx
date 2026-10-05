import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CheckInRechazado, MotivoDeRechazoDeCheckIn, PresenteMarcado } from '@boxadmin/shared';
import PaginaDeCheckIn from './page';

/**
 * El `redirect` de Next corta la ejecucion lanzando. Se imita ese
 * comportamiento: si no lanzara, la pagina seguiria y renderizaria la pantalla
 * para alguien sin sesion, y el test pasaria sin darse cuenta.
 */
const { redirect, leerSesion, sesionValidaPara } = vi.hoisted(() => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`NEXT_REDIRECT ${destino}`);
  }),
  leerSesion: vi.fn(),
  sesionValidaPara: vi.fn(),
}));

vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/sesion', () => ({ leerSesion, sesionValidaPara }));

function respuesta(cuerpo: unknown, estado: number): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

function marcado(cambios: Partial<PresenteMarcado> = {}): PresenteMarcado {
  return {
    reservaId: 'res-1',
    turnoId: 'turno-1',
    fecha: '2026-10-03',
    horaInicio: '19:00',
    clase: 'Funcional',
    marcadaEn: '2026-10-03T22:01:00.000Z',
    ...cambios,
  };
}

function rechazo(cambios: Partial<CheckInRechazado> = {}): CheckInRechazado {
  return {
    motivo: 'sin-reserva',
    message: 'Mensaje redactado por la API',
    ...cambios,
  };
}

/** Deja la red colgada: sirve para mirar el estado inicial. */
function fetchQueNoResponde() {
  return vi.fn().mockReturnValue(new Promise(() => {}));
}

function fetchQueDevuelve(cuerpo: unknown, estado: number) {
  return vi.fn().mockResolvedValue(respuesta(cuerpo, estado));
}

/** `f: null` significa que el parametro NO viene en la URL; `f: ''` que viene vacio. */
async function montar({
  slug = 'mi-gym',
  f = 'firma-del-cartel' as string | null,
  conSesion = true,
}: { slug?: string; f?: string | null; conSesion?: boolean } = {}) {
  leerSesion.mockResolvedValue({ access: 'tok', slug });
  sesionValidaPara.mockReturnValue(conSesion);

  const elemento = await PaginaDeCheckIn({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(f === null ? {} : { f }),
  });

  render(elemento);
}

let fetchFalso: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchFalso = fetchQueDevuelve(marcado(), 201);
  vi.stubGlobal('fetch', fetchFalso);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PaginaDeCheckIn · la puerta', () => {
  it('sin sesion manda al login CONSERVANDO la firma del QR', async () => {
    await expect(montar({ conSesion: false, f: 'abc' })).rejects.toThrow(/NEXT_REDIRECT/);

    // Sin el `volverA`, el alumno entra y aterriza en el calendario con la
    // firma perdida: tendria que volver a escanear parado frente a la pared.
    expect(redirect).toHaveBeenCalledWith(
      `/mi-gym/login?volverA=${encodeURIComponent('/mi-gym/checkin?f=abc')}`,
    );
  });

  it('sin sesion no llama a la API', async () => {
    await expect(montar({ conSesion: false })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('la firma viaja codificada, no cruda, dentro del volverA', async () => {
    await expect(montar({ conSesion: false, f: 'a+b/c=' })).rejects.toThrow(/NEXT_REDIRECT/);

    const destino = redirect.mock.calls[0]![0] as string;
    const volverA = new URL(destino, 'http://x').searchParams.get('volverA');
    expect(volverA).toBe('/mi-gym/checkin?f=a%2Bb%2Fc%3D');
  });

  it('con sesion no redirige a ningun lado', async () => {
    await montar();

    expect(redirect).not.toHaveBeenCalled();
  });
});

describe('PaginaDeCheckIn · los estados', () => {
  it('arranca marcando y lo dice', async () => {
    vi.stubGlobal('fetch', (fetchFalso = fetchQueNoResponde()));
    await montar();

    expect(screen.getByText(/marcando/i)).toBeInTheDocument();
    expect(fetchFalso).toHaveBeenCalled();
  });

  it('llama al proxy con POST /checkin y la firma en el cuerpo', async () => {
    await montar({ f: 'firma-abc' });

    await waitFor(() => expect(fetchFalso).toHaveBeenCalled());
    const [url, opciones] = fetchFalso.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/bx/checkin');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(String(opciones.body))).toEqual({ firma: 'firma-abc' });
  });

  it('marcado: confirma con la clase y la hora', async () => {
    vi.stubGlobal(
      'fetch',
      (fetchFalso = fetchQueDevuelve(marcado({ clase: 'Funcional', horaInicio: '19:00' }), 201)),
    );
    await montar();

    expect(await screen.findByText(/quedaste presente/i)).toBeInTheDocument();
    expect(screen.getByText(/Funcional/)).toBeInTheDocument();
    expect(screen.getByText(/19:00/)).toBeInTheDocument();
  });

  it('sin firma en la URL lo dice y NO llama a la API', async () => {
    await montar({ f: null });

    expect(screen.getByText(/falta la firma/i)).toBeInTheDocument();
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it('una firma vacia se trata como firma ausente', async () => {
    await montar({ f: '' });

    expect(screen.getByText(/falta la firma/i)).toBeInTheDocument();
    expect(fetchFalso).not.toHaveBeenCalled();
  });
});

/**
 * Lo que cada motivo —y SOLO ese motivo— tiene que decir.
 *
 * Buscar la frase esperada no alcanza: un test que solo comprueba que
 * aparece lo correcto pasa igual cuando ademas aparece lo de otro motivo, y
 * ahi esta el dano. Decirle "no hace falta que hagas nada mas" a quien tiene
 * la lista cerrada es exactamente lo que el contrato pide no hacer.
 */
const FRASES_POR_MOTIVO: Record<MotivoDeRechazoDeCheckIn, RegExp[]> = {
  'sin-reserva': [/no encontramos una reserva/i, /fijate en tu calendario/i],
  'fuera-de-ventana': [/fuera del horario/i],
  'ya-marcada': [/ya estabas marcado/i, /no hace falta que hagas nada mas/i],
  'lista-ya-pasada': [/paso lista/i, /hablalo con tu profesora/i],
};

/** Esta el texto del motivo esperado y NO esta el de ninguno de los otros tres. */
function soloHablaDe(motivo: MotivoDeRechazoDeCheckIn): void {
  for (const [suyo, frases] of Object.entries(FRASES_POR_MOTIVO)) {
    for (const frase of frases) {
      if (suyo === motivo) expect(screen.getByText(frase)).toBeInTheDocument();
      else expect(screen.queryByText(frase)).toBeNull();
    }
  }
}

describe('PaginaDeCheckIn · los cuatro motivos', () => {
  async function conRechazo(datos: CheckInRechazado) {
    vi.stubGlobal('fetch', (fetchFalso = fetchQueDevuelve(datos, 409)));
    await montar();
  }

  it('sin-reserva: dice que no hay reserva, no que ya marco', async () => {
    await conRechazo(rechazo({ motivo: 'sin-reserva', message: 'No tenes reserva cerca' }));

    expect(await screen.findByText(/no encontramos una reserva/i)).toBeInTheDocument();
    expect(screen.getByText(/No tenes reserva cerca/)).toBeInTheDocument();
    soloHablaDe('sin-reserva');
  });

  it('fuera-de-ventana: dice CUAL era la clase y A QUE HORA', async () => {
    await conRechazo(
      rechazo({
        motivo: 'fuera-de-ventana',
        message: 'Llegaste 40 minutos tarde',
        clase: 'Spinning',
        fecha: '2026-10-03',
        horaInicio: '07:30',
      }),
    );

    expect(await screen.findByText(/fuera del horario/i)).toBeInTheDocument();
    // Sin la clase y la hora, el alumno no sabe de que clase le hablan.
    expect(screen.getByText(/Spinning/)).toBeInTheDocument();
    expect(screen.getByText(/07:30/)).toBeInTheDocument();
    expect(screen.getByText(/Llegaste 40 minutos tarde/)).toBeInTheDocument();
    soloHablaDe('fuera-de-ventana');
  });

  it('ya-marcada: lo tranquiliza, con su clase', async () => {
    await conRechazo(
      rechazo({
        motivo: 'ya-marcada',
        message: 'Ya habias marcado',
        clase: 'Funcional',
        fecha: '2026-10-03',
        horaInicio: '19:00',
      }),
    );

    expect(await screen.findByText(/ya estabas marcado/i)).toBeInTheDocument();
    expect(screen.getByText(/Funcional/)).toBeInTheDocument();
    soloHablaDe('ya-marcada');
  });

  it('lista-ya-pasada: NO dice "ya marcaste", manda con la profesora', async () => {
    await conRechazo(
      rechazo({
        motivo: 'lista-ya-pasada',
        message: 'La lista de esa clase ya esta cerrada',
        clase: 'Funcional',
        fecha: '2026-10-03',
        horaInicio: '19:00',
      }),
    );

    // Decirle "ya marcaste" a quien no marco lo manda a buscar un problema que
    // no existe. Lo que tiene que hacer es hablar con su profesora.
    expect(await screen.findByText(/paso lista/i)).toBeInTheDocument();
    // Ni el titulo de otro motivo, ni —peor— su consejo: "no hace falta que
    // hagas nada mas" es justo lo contrario de lo que este alumno necesita.
    soloHablaDe('lista-ya-pasada');
  });

  it('un rechazo no se presenta como una falla del sistema', async () => {
    await conRechazo(rechazo({ motivo: 'ya-marcada', clase: 'Funcional', horaInicio: '19:00' }));

    expect(await screen.findByText(/ya estabas marcado/i)).toBeInTheDocument();
    expect(screen.queryByText(/no pudimos marcar/i)).toBeNull();
  });

  it('el mensaje de la API se muestra como TEXTO, nunca como HTML', async () => {
    await conRechazo(rechazo({ motivo: 'sin-reserva', message: '<img src=x onerror=alert(1)>' }));

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('PaginaDeCheckIn · lo que no es un rechazo', () => {
  it('sin red: lo distingue de un rechazo', async () => {
    vi.stubGlobal('fetch', (fetchFalso = vi.fn().mockRejectedValue(new TypeError('fetch'))));
    await montar();

    // Un rechazo es una respuesta del sistema; esto es la AUSENCIA de
    // respuesta, y lo que el alumno tiene que hacer es distinto.
    expect(await screen.findByText(/no pudimos marcar/i)).toBeInTheDocument();
    expect(screen.queryByText(/no encontramos una reserva/i)).toBeNull();
    expect(screen.queryByText(/ya estabas marcado/i)).toBeNull();
  });

  it('un 500 tampoco es un rechazo', async () => {
    vi.stubGlobal('fetch', (fetchFalso = fetchQueDevuelve({ message: 'Boom' }, 500)));
    await montar();

    expect(await screen.findByText(/no pudimos marcar/i)).toBeInTheDocument();
    expect(screen.queryByText(/no encontramos una reserva/i)).toBeNull();
  });

  it('un 409 con un motivo que no esta en el contrato no se inventa una pantalla', async () => {
    vi.stubGlobal(
      'fetch',
      (fetchFalso = fetchQueDevuelve({ motivo: 'vaya-usted-a-saber', message: 'raro' }, 409)),
    );
    await montar();

    expect(await screen.findByText(/no pudimos marcar/i)).toBeInTheDocument();
  });

  it('se puede reintentar sin volver a escanear', async () => {
    const usuario = userEvent.setup();
    const falso = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('fetch'))
      .mockResolvedValueOnce(respuesta(marcado(), 201));
    vi.stubGlobal('fetch', (fetchFalso = falso));

    await montar();
    expect(await screen.findByText(/no pudimos marcar/i)).toBeInTheDocument();

    await usuario.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText(/quedaste presente/i)).toBeInTheDocument();
  });
});
