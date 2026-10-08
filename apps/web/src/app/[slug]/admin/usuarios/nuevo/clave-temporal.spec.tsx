import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Advertencia } from '@boxadmin/shared';
import { ClaveTemporal } from './clave-temporal';
import { espiarLaConsola, SECRETOS_DEL_PANEL } from '@/test/espia-de-consola';

/**
 * El centinela de esta pantalla: la contraseña temporal del alta.
 *
 * Sale de `SECRETOS_DEL_PANEL` y no de una cadena escrita aqui porque el tapon
 * del titulo —global, en `vitest.setup.ts`— vigila esa misma constante: con dos
 * copias, cambiar esta dejaria al tapon buscando algo que ya no se siembra.
 */
const CLAVE = SECRETOS_DEL_PANEL.claveDelAlta;

/**
 * El portapapeles se dobla ANTES de que `userEvent.setup()` ponga el suyo.
 *
 * `setup()` instala su propio doble en `navigator.clipboard`, asi que el orden
 * importa: primero se crea la sesion de userEvent, despues se pisa el
 * portapapeles con el espia. Al reves, el espia no se llamaria nunca y los
 * tests del portapapeles pasarian mirando al vacio.
 */
const escribirEnPortapapeles = vi.fn<(texto: string) => Promise<void>>();

function montar(advertencias: Advertencia[] = [], alTerminar = vi.fn()) {
  const sesion = userEvent.setup();

  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: escribirEnPortapapeles },
    configurable: true,
    writable: true,
  });

  render(
    <ClaveTemporal
      nombre="Ana Gomez"
      clave={CLAVE}
      advertencias={advertencias}
      alTerminar={alTerminar}
    />,
  );

  return { sesion, alTerminar };
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
 * El tapon de la consola, en CADA test de este archivo.
 *
 * No es una comprobacion mas: es la dimension de "lo que la pantalla dice fuera
 * del DOM", que no auditaba ningun spec de `apps/web`. Va en `afterEach` para
 * que cubra tambien los tests que se escriban despues sin acordarse de el.
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

describe('la pantalla de la clave temporal', () => {
  it('muestra la clave entera, legible, y de quien es', () => {
    montar();

    expect(screen.getByText(CLAVE)).toBeInTheDocument();
    expect(screen.getByText(/ana gomez/i)).toBeInTheDocument();
  });

  it('dice que no se va a poder verla de nuevo', () => {
    montar();

    expect(screen.getByText(/no vas a poder verla de nuevo/i)).toBeInTheDocument();
  });

  it('dice QUIEN puede repararlo, porque no es quien da de alta', () => {
    // El operativo que la pierde no puede resetearla: eso pide ADMIN_SALON.
    // Si la pantalla no lo dice, el admin se entera cuando ya es tarde.
    montar();

    expect(screen.getByText(/admin del salon/i)).toBeInTheDocument();
  });

  it('el boton de seguir arranca deshabilitado', () => {
    montar();

    expect(screen.getByRole('button', { name: /listo/i })).toBeDisabled();
  });

  it('marcar que se anoto habilita el boton', async () => {
    const { sesion } = montar();

    await sesion.click(screen.getByLabelText(/ya la anote/i));

    expect(screen.getByRole('button', { name: /listo/i })).toBeEnabled();
  });

  it('«Listo» avisa a quien la monto, y solo despues de marcar', async () => {
    const { sesion, alTerminar } = montar();

    await sesion.click(screen.getByRole('button', { name: /listo/i }));
    expect(alTerminar).not.toHaveBeenCalled();

    await sesion.click(screen.getByLabelText(/ya la anote/i));
    await sesion.click(screen.getByRole('button', { name: /listo/i }));

    expect(alTerminar).toHaveBeenCalledTimes(1);
  });

  it('no se cierra haciendo clic afuera', async () => {
    const { sesion, alTerminar } = montar();

    await sesion.click(document.body);

    expect(screen.getByText(CLAVE)).toBeInTheDocument();
    expect(alTerminar).not.toHaveBeenCalled();
  });

  it('no se cierra con Escape', async () => {
    // `Confirmar` SI cierra con Escape, y esta pantalla se le parece. Aqui
    // cerrar por inercia pierde el unico dato que no se puede releer.
    const { sesion, alTerminar } = montar();

    await sesion.keyboard('{Escape}');

    expect(screen.getByText(CLAVE)).toBeInTheDocument();
    expect(alTerminar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// El portapapeles: la unica copia que sale del navegador
// ---------------------------------------------------------------------------

describe('copiar la clave', () => {
  it('el boton de copiar la manda al portapapeles', async () => {
    const { sesion } = montar();

    await sesion.click(screen.getByRole('button', { name: /copiar/i }));

    expect(escribirEnPortapapeles).toHaveBeenCalledWith(CLAVE);
  });

  /**
   * NADA SE COPIA SOLO.
   *
   * Copiar al abrir es la "comodidad" evidente de esta pantalla, y deja la
   * clave en el portapapeles del SISTEMA —fuera del navegador, fuera de
   * cualquier cache que se vacie al cerrar la pestaña— de una maquina de
   * mostrador que usan cuatro personas por turno. En Windows, el historial del
   * portapapeles (Win+V) la guarda ademas para despues.
   *
   * El test de arriba no lo ve: con el autocopiado el espia TAMBIEN se llamo
   * con la clave, solo que antes. Por eso este mira ANTES del clic.
   */
  it('no se copia nada hasta que alguien lo pide', () => {
    montar();

    expect(escribirEnPortapapeles).not.toHaveBeenCalled();
  });

  it('si el portapapeles falla lo dice, en vez de fingir que copio', async () => {
    escribirEnPortapapeles.mockRejectedValue(new Error('sin permiso'));
    const { sesion } = montar();

    await sesion.click(screen.getByRole('button', { name: /copiar/i }));

    expect(screen.getByText(/no se pudo copiar/i)).toBeInTheDocument();
  });

  it('cuando copia, lo dice', async () => {
    const { sesion } = montar();

    await sesion.click(screen.getByRole('button', { name: /copiar/i }));

    expect(screen.getByText(/copiada/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Las advertencias
// ---------------------------------------------------------------------------

describe('las advertencias del alta', () => {
  it('se muestran JUNTO a la clave', () => {
    montar([{ codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' }]);

    expect(screen.getByText(/no tiene salas asignadas/i)).toBeInTheDocument();
  });

  it('se muestran TODAS, no la primera', () => {
    montar([
      { codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' },
      { codigo: 'SIN_PACK', mensaje: 'No tiene pack asignado' },
    ]);

    expect(screen.getByText(/no tiene salas asignadas/i)).toBeInTheDocument();
    expect(screen.getByText(/no tiene pack asignado/i)).toBeInTheDocument();
  });

  it('sin advertencias no se dibuja el hueco', () => {
    montar([]);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('no se leen como un error: el alta SI se hizo', () => {
    // `role="alert"` interrumpe al lector de pantalla y suena a que fallo algo.
    // El alta salio bien; lo que hay es algo que mirar.
    montar([{ codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' }]);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Lo que queda cuando la pantalla se va
// ---------------------------------------------------------------------------

describe('recargar no la hace desaparecer en silencio', () => {
  /**
   * `beforeunload` es lo unico que el navegador deja usar para frenar un F5.
   *
   * Sin esto, recargar con la clave en pantalla la borra sin decir nada: el
   * alumno quedo creado y nadie sabe su contraseña.
   */
  it('avisa antes de recargar mientras no se haya anotado', () => {
    montar();

    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
  });

  it('una vez anotada deja de molestar', async () => {
    const { sesion } = montar();

    await sesion.click(screen.getByLabelText(/ya la anote/i));

    const evento = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(false);
  });
});

describe('la clave no se guarda en ningun sitio del navegador', () => {
  it('ni en localStorage ni en sessionStorage, ni antes ni despues de copiarla', async () => {
    const { sesion } = montar([{ codigo: 'SIN_SALAS', mensaje: 'No tiene salas asignadas' }]);

    await sesion.click(screen.getByRole('button', { name: /copiar/i }));
    await sesion.click(screen.getByLabelText(/ya la anote/i));

    expect({ local: contenidoDe(localStorage), sesion: contenidoDe(sessionStorage) }).toEqual({
      local: {},
      sesion: {},
    });
  });
});
