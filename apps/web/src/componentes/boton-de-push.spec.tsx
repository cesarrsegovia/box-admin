import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BotonDePush } from './boton-de-push';

/** Una clave VAPID cualquiera en base64url; solo tiene que decodificar. */
const CLAVE = 'TWFuTWFuTWFu';

interface SuscripcionFalsa {
  endpoint: string;
  toJSON: () => unknown;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function suscripcionFalsa(endpoint = 'https://push.example/abc'): SuscripcionFalsa {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'clave-publica', auth: 'secreto' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  };
}

/**
 * Monta un navegador con soporte de push.
 *
 * `serviceWorker` se pone con `defineProperty` y no con `stubGlobal`: sustituir
 * `navigator` entero le quita a userEvent lo que necesita.
 */
function conSoporte(opciones: {
  permiso?: NotificationPermission;
  alPedir?: NotificationPermission;
  yaSuscrito?: SuscripcionFalsa | null;
  nueva?: SuscripcionFalsa;
  /**
   * `getRegistration()` resuelve `undefined` mientras `ready` sigue dando el
   * registro: el service worker todavia no esta instalado.
   *
   * Sin esta opcion, los dos devuelven el mismo objeto y NADA distingue cual de
   * los dos usa el componente. Con ella, usar `getRegistration()` donde va
   * `ready` revienta.
   */
  sinRegistroTodavia?: boolean;
}) {
  const pedirPermiso = vi.fn().mockResolvedValue(opciones.alPedir ?? 'granted');
  vi.stubGlobal('Notification', {
    permission: opciones.permiso ?? 'default',
    requestPermission: pedirPermiso,
  });
  vi.stubGlobal('PushManager', class {});

  const nueva = opciones.nueva ?? suscripcionFalsa();
  const subscribe = vi.fn().mockResolvedValue(nueva);
  const getSubscription = vi.fn().mockResolvedValue(opciones.yaSuscrito ?? null);
  const registro = { pushManager: { subscribe, getSubscription } };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      ready: Promise.resolve(registro),
      getRegistration: async () => (opciones.sinRegistroTodavia === true ? undefined : registro),
    },
    configurable: true,
  });

  return { pedirPermiso, subscribe, getSubscription, nueva };
}

/** Una respuesta del BFF. 204 es lo que devuelven las dos rutas de push. */
function respuesta(estado: number, cuerpo?: unknown): Response {
  if (estado === 204) return new Response(null, { status: 204 });

  return new Response(JSON.stringify(cuerpo ?? {}), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', CLAVE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('BotonDePush: cuando no puede funcionar, no se pinta', () => {
  it('sin NEXT_PUBLIC_VAPID_PUBLIC_KEY no hay boton', async () => {
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', '');
    conSoporte({});

    render(<BotonDePush />);

    // Un boton que no puede funcionar es peor que ningun boton: el alumno lo
    // pulsa, no pasa nada, y cree que la aplicacion esta rota.
    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
    expect(screen.queryByText(/notificaciones/i)).not.toBeInTheDocument();
  });

  it('en un navegador sin Notification tampoco', async () => {
    // Sin `conSoporte`: jsdom no trae ni Notification ni PushManager.
    render(<BotonDePush />);

    await waitFor(() => expect(screen.queryByRole('button')).not.toBeInTheDocument());
  });
});

describe('BotonDePush: el permiso tiene TRES estados', () => {
  it('a quien ya dijo que no se le explica como revertirlo desde el navegador', async () => {
    // `requestPermission()` sobre un permiso denegado resuelve `denied` al
    // instante y sin abrir ningun dialogo: un boton ahi no hace nada visible.
    conSoporte({ permiso: 'denied' });

    render(<BotonDePush />);

    // Por rol y no por texto: el aviso sustituye al boton, asi que tiene que
    // anunciarse a quien no lo esta mirando.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/configuracion del navegador/i),
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('si lo deniegan al pulsar, se cambia el boton por la explicacion', async () => {
    const { subscribe } = conSoporte({ alPedir: 'denied' });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    // Por rol y no por texto: el aviso sustituye al boton, asi que tiene que
    // anunciarse a quien no lo esta mirando.
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/configuracion del navegador/i),
    );
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('si cierran el dialogo sin decidir, el boton sigue ahi y no hay error', async () => {
    // `default` no es `denied`: puede volver a pulsarlo cuando quiera.
    const { subscribe } = conSoporte({ alPedir: 'default' });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    await waitFor(() => expect(subscribe).not.toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /^activar notificaciones$/i })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('BotonDePush: activar', () => {
  it('se suscribe y manda endpoint y claves al BFF, nunca a la API', async () => {
    const traer = vi.fn().mockResolvedValue(respuesta(204));
    vi.stubGlobal('fetch', traer);
    const { subscribe } = conSoporte({});
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    await waitFor(() => expect(traer).toHaveBeenCalled());
    expect(subscribe).toHaveBeenCalledWith(
      expect.objectContaining({ userVisibleOnly: true, applicationServerKey: expect.anything() }),
    );

    const [url, opciones] = traer.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('/api/bx/push/suscripcion');
    expect(opciones.method).toBe('POST');
    expect(JSON.parse(String(opciones.body))).toEqual({
      endpoint: 'https://push.example/abc',
      p256dh: 'clave-publica',
      auth: 'secreto',
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^desactivar notificaciones$/i }),
      ).toBeInTheDocument(),
    );
  });

  it('si ya estaba suscrito, al montar ofrece desactivar', async () => {
    conSoporte({ yaSuscrito: suscripcionFalsa() });

    render(<BotonDePush />);

    expect(
      await screen.findByRole('button', { name: /^desactivar notificaciones$/i }),
    ).toBeInTheDocument();
  });

  it('un 503 NO se muestra como un error: el gimnasio no lo tiene configurado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        respuesta(503, {
          message: 'Este gimnasio no tiene las notificaciones push configuradas.',
        }),
      ),
    );
    conSoporte({});
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    await waitFor(() =>
      expect(
        screen.getByText(/todavia no tiene las notificaciones configuradas/i),
      ).toBeInTheDocument(),
    );
    // Un 503 significa "esta instalacion no tiene esa capacidad", no "fallaste".
    // Lo que NO puede pasar es que se escupa el mensaje crudo de la API por la
    // via del error generico, ni que quede un boton invitando a reintentarlo
    // toda la tarde.
    expect(
      screen.queryByText('Este gimnasio no tiene las notificaciones push configuradas.'),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Y se anuncia, porque sustituye al boton que se acaba de pulsar.
    expect(screen.getByRole('alert')).toHaveTextContent(
      /todavia no tiene las notificaciones configuradas/i,
    );
  });

  it('si el unsubscribe falla DESPUES de suscribir bien, no se traga el fallo', async () => {
    const rota = suscripcionFalsa();
    rota.unsubscribe = vi.fn().mockRejectedValue(new Error('el navegador dijo que no'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(500, { message: 'Se cayo la base' })),
    );
    conSoporte({ nueva: rota });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    // El `.catch()` del deshacer es para que el error que se muestre sea el de
    // verdad —el del servidor—, no el del deshacer, que no le dice nada a nadie.
    await waitFor(() => expect(screen.getByText('Se cayo la base')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^activar notificaciones$/i })).toBeInTheDocument();
  });

  it('si el service worker aun no esta instalado, activar espera a serviceWorker.ready', async () => {
    // `getRegistration()` resuelve `undefined` justo despues de cargar la
    // pagina. Usarlo en `activar` en vez de `ready` reventaria al llamar a
    // `pushManager.subscribe` sobre undefined; el boton tiene que salir igual.
    const traer = vi.fn().mockResolvedValue(respuesta(204));
    vi.stubGlobal('fetch', traer);
    const { subscribe } = conSoporte({ sinRegistroTodavia: true });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    await waitFor(() => expect(subscribe).toHaveBeenCalled());
    expect(
      await screen.findByRole('button', { name: /^desactivar notificaciones$/i }),
    ).toBeInTheDocument();
  });

  it('si el servidor no se queda la suscripcion, el navegador tampoco', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(500, { message: 'Se cayo la base' })),
    );
    const { nueva } = conSoporte({});
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(await screen.findByRole('button', { name: /^activar notificaciones$/i }));

    // Sin este deshacer queda una suscripcion viva que el servidor no conoce:
    // el alumno lee "Activar" y no recibe nada.
    await waitFor(() => expect(nueva.unsubscribe).toHaveBeenCalled());
    expect(screen.getByText('Se cayo la base')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^activar notificaciones$/i })).toBeInTheDocument();
  });
});

describe('BotonDePush: desactivar', () => {
  it('avisa al servidor Y borra la suscripcion del navegador', async () => {
    const traer = vi.fn().mockResolvedValue(respuesta(204));
    vi.stubGlobal('fetch', traer);
    const existente = suscripcionFalsa('https://push.example/de-este-navegador');
    conSoporte({ yaSuscrito: existente });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(
      await screen.findByRole('button', { name: /^desactivar notificaciones$/i }),
    );

    await waitFor(() => expect(traer).toHaveBeenCalled());
    const [url, opciones] = traer.mock.calls[0]! as [string, RequestInit];
    expect(opciones.method).toBe('DELETE');
    // Con el endpoint: sin el, la API borra los avisos de TODOS sus
    // dispositivos, no solo los de este navegador.
    expect(url).toBe(
      `/api/bx/push/suscripcion?endpoint=${encodeURIComponent('https://push.example/de-este-navegador')}`,
    );
    await waitFor(() => expect(existente.unsubscribe).toHaveBeenCalled());

    expect(
      await screen.findByRole('button', { name: /^activar notificaciones$/i }),
    ).toBeInTheDocument();
  });

  it('si el DELETE va bien y el unsubscribe falla, NO sigue diciendo "Desactivar"', async () => {
    const traer = vi.fn().mockResolvedValue(respuesta(204));
    vi.stubGlobal('fetch', traer);
    const existente = suscripcionFalsa();
    existente.unsubscribe = vi.fn().mockRejectedValue(new Error('el navegador dijo que no'));
    conSoporte({ yaSuscrito: existente });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(
      await screen.findByRole('button', { name: /^desactivar notificaciones$/i }),
    );

    // El servidor ya borro la fila: no va a llegar ni un aviso mas. Un boton que
    // siguiera diciendo "Desactivar" le prometeria al alumno unos avisos que no
    // existen — el unico camino por el que puede creerse avisado sin estarlo.
    expect(
      await screen.findByRole('button', { name: /^activar notificaciones$/i }),
    ).toBeInTheDocument();
    // Y el fallo se cuenta igual: el navegador se quedo una suscripcion muerta.
    expect(screen.getByText('el navegador dijo que no')).toBeInTheDocument();
  });

  it('si el DELETE falla, NO desuscribe el navegador ni dice que esta desactivado', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respuesta(500, { message: 'Se cayo la base' })),
    );
    const existente = suscripcionFalsa();
    conSoporte({ yaSuscrito: existente });
    const usuario = userEvent.setup();

    render(<BotonDePush />);
    await usuario.click(
      await screen.findByRole('button', { name: /^desactivar notificaciones$/i }),
    );

    await waitFor(() => expect(screen.getByText('Se cayo la base')).toBeInTheDocument());
    // Desuscribir aqui dejaria al alumno leyendo "Desactivar" —creyendose
    // avisado— con el navegador ya mudo.
    expect(existente.unsubscribe).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /^desactivar notificaciones$/i }),
    ).toBeInTheDocument();
  });
});
