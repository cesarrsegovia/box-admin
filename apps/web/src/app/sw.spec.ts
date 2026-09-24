import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * El service worker de verdad, probado en jsdom.
 *
 * En jsdom `self` es `window`, asi que los `addEventListener` de `sw.ts` quedan
 * enganchados al window del test y se pueden disparar con `dispatchEvent`. Lo
 * que no existe en jsdom es `registration` ni `clients`: se ponen a mano abajo.
 *
 * Serwist se sustituye entero. Lo que se prueba aqui es el push, no su cache, y
 * el modulo real intenta leer un manifiesto que solo existe tras el build.
 */
vi.mock('@serwist/next/worker', () => ({ defaultCache: [] }));
vi.mock('serwist', () => ({
  NetworkFirst: class {},
  Serwist: class {
    addEventListeners() {}
  },
}));

const mostrar = vi.fn();
const abrirVentana = vi.fn();
const ventanas = vi.fn<() => Promise<unknown[]>>(async () => []);

beforeAll(async () => {
  Object.defineProperty(self, 'registration', {
    value: { showNotification: mostrar },
    configurable: true,
  });
  Object.defineProperty(self, 'clients', {
    value: { matchAll: ventanas, openWindow: abrirVentana },
    configurable: true,
  });

  // Se importa DESPUES de poner los dobles: el modulo se ejecuta al importarlo.
  await import('./sw');
});

afterEach(() => {
  mostrar.mockClear();
  abrirVentana.mockClear();
  ventanas.mockReset();
  ventanas.mockResolvedValue([]);
});

/** Dispara un `push` como lo haria el navegador y espera a su `waitUntil`. */
async function llegaUnPush(cuerpo: string | undefined): Promise<void> {
  const esperas: Promise<unknown>[] = [];
  const evento = Object.assign(new Event('push'), {
    data: cuerpo === undefined ? null : { text: () => cuerpo },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });

  self.dispatchEvent(evento as unknown as Event);
  await Promise.all(esperas);
}

/** Dispara un `notificationclick` sobre una notificacion con esos datos. */
async function tocanLaNotificacion(datos: unknown): Promise<{ cerrada: boolean }> {
  const cerrar = vi.fn();
  const esperas: Promise<unknown>[] = [];
  const evento = Object.assign(new Event('notificationclick'), {
    notification: { close: cerrar, data: datos },
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });

  self.dispatchEvent(evento as unknown as Event);
  await Promise.all(esperas);

  return { cerrada: cerrar.mock.calls.length > 0 };
}

describe('el handler de push del service worker', () => {
  it('muestra la notificacion con el titulo, el cuerpo y el destino', async () => {
    await llegaUnPush(
      JSON.stringify({ titulo: 'Tienes plaza', cuerpo: 'Hola Ana', url: '/calendario' }),
    );

    expect(mostrar).toHaveBeenCalledWith('Tienes plaza', {
      body: 'Hola Ana',
      icon: '/icono-192.png',
      data: { url: '/calendario' },
    });
  });

  it('el titulo va COMO TEXTO y sin tocar, con apostrofes y ampersands incluidos', async () => {
    // `showNotification` recibe una cadena, no HTML: escaparla aqui se veria
    // "O&#x27;Brien" en la pantalla del telefono.
    await llegaUnPush(JSON.stringify({ titulo: "Clase de O'Brien & Ana", cuerpo: '' }));

    expect(mostrar.mock.calls[0]![0]).toBe("Clase de O'Brien & Ana");
  });

  it('un cuerpo ilegible muestra algo igualmente en vez de reventar', async () => {
    await llegaUnPush('{roto');

    expect(mostrar).toHaveBeenCalledWith('BoxAdmin', expect.objectContaining({ body: '' }));
  });

  it('un push sin cuerpo tampoco se pierde', async () => {
    await llegaUnPush(undefined);

    expect(mostrar).toHaveBeenCalledWith('BoxAdmin', expect.anything());
  });
});

describe('el handler de notificationclick', () => {
  it('cierra la notificacion y abre el destino', async () => {
    const { cerrada } = await tocanLaNotificacion({ url: '/mi-gym/mi-pack' });

    expect(cerrada).toBe(true);
    expect(abrirVentana).toHaveBeenCalledWith('/mi-gym/mi-pack');
  });

  it('reutiliza una ventana abierta y la lleva al destino que mando la API', async () => {
    const navegar = vi.fn();
    const enfocar = vi.fn();
    ventanas.mockResolvedValue([
      { url: 'https://app.test/mi-gym/perfil', navigate: navegar, focus: enfocar },
    ]);

    await tocanLaNotificacion({ url: '/mi-gym/calendario' });

    expect(navegar).toHaveBeenCalledWith('/mi-gym/calendario');
    expect(enfocar).toHaveBeenCalled();
    expect(abrirVentana).not.toHaveBeenCalled();
  });

  it('de la ventana abierta NO deduce ningun gimnasio', async () => {
    const navegar = vi.fn();
    ventanas.mockResolvedValue([
      { url: 'https://app.test/gym-b/perfil', navigate: navegar, focus: vi.fn() },
    ]);

    // Reutilizarla es cortesia, no una fuente de datos: si de su URL se sacara
    // el gimnasio, un socio de dos acabaria en `/gym-b/gym-a/calendario`.
    await tocanLaNotificacion({ url: '/gym-a/calendario' });

    expect(navegar).toHaveBeenCalledWith('/gym-a/calendario');
  });

  it('si la ventana abierta no se deja navegar, abre una nueva', async () => {
    ventanas.mockResolvedValue([
      {
        url: 'https://app.test/mi-gym/perfil',
        navigate: vi.fn().mockRejectedValue(new Error('no controlada')),
        focus: vi.fn(),
      },
    ]);

    await tocanLaNotificacion({ url: '/mi-gym/calendario' });

    expect(abrirVentana).toHaveBeenCalledWith('/mi-gym/calendario');
  });

  it('una notificacion sin datos abre la aplicacion y no falla', async () => {
    await tocanLaNotificacion(undefined);

    expect(abrirVentana).toHaveBeenCalledWith('/');
  });

  it('no abre nunca un destino de otro origen', async () => {
    await tocanLaNotificacion({ url: 'https://otro-sitio.test/robo' });

    expect(abrirVentana).toHaveBeenCalledWith('/');
  });
});
