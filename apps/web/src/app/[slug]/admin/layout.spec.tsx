import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import type { MeRespuesta } from '@boxadmin/shared';
import { destinoPorRol } from '@/lib/destino-por-rol';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirigir = vi.fn();
const navegar = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirigir(destino);
    throw new Error('NEXT_REDIRECT');
  },
  // El boton de salir que ve el FANTASMA es de cliente y pide `useRouter`. No
  // se prueba aqui —tiene su propio spec— pero sin esto ni se monta.
  useRouter: () => ({ push: navegar }),
}));

/**
 * El doble del middleware: la ruta que estaria estampada en la peticion.
 *
 * `rutaPedida` NO se mockea —es la pieza que decide si la cabecera se cree—,
 * asi que `rutaDeRetornoSegura` corre de verdad en estos tests.
 */
const cabeceras = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => cabeceras(),
  // `lib/sesion` la importa. No llega a usarse —`leerSesion` esta doblada—
  // pero el modulo mockeado tiene que exponerla igual.
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const leerSesion = vi.fn();
const leerRol = vi.fn();
vi.mock('@/lib/sesion', async () => ({
  ...(await vi.importActual<typeof import('@/lib/sesion')>('@/lib/sesion')),
  leerSesion: () => leerSesion(),
  leerRol: (access: string) => leerRol(access),
}));

/**
 * El armazon se sustituye por un doble para poder auditar DOS cosas que desde
 * el armazon de verdad no se ven: el juego exacto de props que la puerta le
 * pasa, y que lo unico que envuelve sea `children`.
 */
const propsDelArmazon = vi.fn();
vi.mock('./armazon', () => ({
  Armazon: (props: { children: ReactNode }) => {
    propsDelArmazon(props);
    return <div data-testid="armazon">{props.children}</div>;
  },
}));

import LayoutDeAdmin from './layout';

async function montar() {
  const jsx = await LayoutDeAdmin({
    children: <p>el panel</p>,
    params: Promise.resolve({ slug: 'mi-gym' }),
  });
  render(jsx);
}

beforeEach(() => {
  redirigir.mockClear();
  leerSesion.mockReset();
  leerRol.mockReset();
  propsDelArmazon.mockClear();
  // Por defecto, SIN middleware: ninguna ruta estampada.
  cabeceras.mockResolvedValue(new Headers());
});

/** El login con un destino a cuestas. */
function alLogin(destino: string) {
  return `/mi-gym/login?volverA=${encodeURIComponent(destino)}`;
}

/** Lo que el middleware habria estampado si el admin estuviera en `ruta`. */
function estampar(ruta: string) {
  cabeceras.mockResolvedValue(new Headers({ 'x-ruta': ruta }));
}

/** El `volverA` que acabo en la URL del login, ya decodificado. */
function destinoDelLogin(): string | null {
  const url = redirigir.mock.calls[0]![0] as string;
  return new URL(url, 'http://x').searchParams.get('volverA');
}

/** Sin middleware: la portada del panel. */
const ENTRADA = '/mi-gym/admin';

/**
 * Un `/auth/me` ENTERO, con centinelas reconocibles en los campos que el panel
 * no necesita. La puerta recibe este objeto completo; de el solo tienen que
 * salir el rol y el nombre.
 */
function yoCompleto(cambios: Partial<MeRespuesta> = {}): MeRespuesta {
  return {
    id: 'usr-centinela',
    tenantId: 'tnt-centinela',
    nombreCompleto: 'Ana Gomez',
    email: 'ana@centinela.test',
    rol: 'ADMIN_OPERATIVO',
    activo: true,
    tenant: { id: 'tnt-centinela', nombre: 'Mi Gym', slug: 'mi-gym', activo: true },
    ...cambios,
  };
}

/** Los campos de `/auth/me` que NO tienen por que aparecer en ninguna parte. */
const CENTINELAS = ['usr-centinela', 'tnt-centinela', 'ana@centinela.test'];

describe('la puerta del panel', () => {
  it('SIN SESION manda al login conservando a donde iba', async () => {
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('con sesion de OTRO GIMNASIO manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'otro-gimnasio' });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('con ROL INSUFICIENTE muestra una pantalla, NO redirige', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.getByText(/no tenes permiso/i)).toBeInTheDocument();
  });

  it('la pantalla de sin permiso dice QUE ROL hace falta', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(screen.getByText(/administrador operativo/i)).toBeInTheDocument();
  });

  it('un PROFESOR tampoco entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    expect(screen.queryByText('el panel')).not.toBeInTheDocument();
  });

  /**
   * EL MISMO BUG DE LA FASE 13, DEL OTRO LADO DEL MOSTRADOR.
   *
   * Esta salida estaba cableada a `/${slug}/calendario` para CUALQUIER rol
   * rechazado. Para una profesora que abria una URL del panel —un enlace que le
   * pasaron, un favorito viejo— eso no era «una pantalla que no es la suya»:
   * era un segundo callejon. El calendario exige `rol === 'ALUMNO'`, asi que
   * salir de aqui la dejaba en «Esta no es tu area».
   *
   * El `href` se afirma ENTERO y no por subcadena: `/mi-gym/` esta dentro de
   * `/mi-gym/calendario` tambien.
   */
  it('a una profesora rechazada se le ofrece SU area, no el calendario', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    const salida = document.querySelector('[data-salida]');
    expect(salida?.getAttribute('href')).toBe('/mi-gym/mis-clases');
    expect(salida?.getAttribute('href')).not.toBe('/mi-gym/calendario');
    // Y el enlace DICE adonde lleva: «Ir a donde si tenes algo» es un enlace
    // que no se puede decidir pulsar.
    expect(salida?.textContent).toBe('Ir a tus clases');
  });

  /**
   * LA SALIDA SALE DE `destinoPorRol` Y NO DE UNA RAMA ESCRITA AQUI.
   *
   * Dos ideas de «donde tiene algo esta persona» es lo que se separa con el
   * tiempo, y la que se quedaria vieja es la de esta pantalla. Se barren los
   * dos roles que pueden llegar de verdad: los tres de admin entran, y el
   * FANTASMA tiene su propio caso porque NO recibe enlace.
   */
  it('el href de cada rol rechazado es el que dice `destinoPorRol`', async () => {
    for (const rol of ['PROFESOR', 'ALUMNO'] as const) {
      // El `cleanup()` global corre entre TESTS, no entre vueltas de un bucle.
      cleanup();
      leerRol.mockReset();
      leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
      leerRol.mockResolvedValue({ rol });

      await montar();

      const salida = document.querySelector('[data-salida]');
      expect(salida?.getAttribute('href'), `con rol ${rol}`).toBe(destinoPorRol(rol, 'mi-gym'));
      // UNO, no dos: un `getByRole(..., { name })` encuentra el suyo aunque al
      // lado cuelguen otros tres. Solo el total los ve.
      expect(screen.queryAllByRole('link'), `con rol ${rol}`).toHaveLength(1);
    }
  });

  /**
   * EL FANTASMA NO TIENE ADONDE IR, Y ESO SE DICE CON UN BOTON Y NO CON UN
   * ENLACE.
   *
   * `destinoPorRol` lo manda al calendario porque es el respaldo de todo lo que
   * no es admin ni profesor, pero el calendario tambien lo rechaza: es un rol
   * tecnico, rango 0. Delegar aqui sin excepcion seria arreglar el bug de la
   * profesora y reabrirlo con otro rol en la misma linea.
   */
  it('a un FANTASMA no se le ofrece ningun enlace, solo cerrar sesion', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'FANTASMA' });

    await montar();

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /cerrar sesion/i })).toBeInTheDocument();
  });

  it('un ADMIN_OPERATIVO entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO', nombreCompleto: 'Ana', tenant: {} });

    await montar();

    expect(screen.getByText('el panel')).toBeInTheDocument();
  });

  it('un ADMIN_SALON entra, porque los roles son jerarquicos', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_SALON', nombreCompleto: 'Ana', tenant: {} });

    await montar();

    expect(screen.getByText('el panel')).toBeInTheDocument();
  });

  it('si /auth/me falla, manda al login y NO muestra sin permiso', async () => {
    leerSesion.mockResolvedValue({ access: 'caducado', slug: 'mi-gym' });
    leerRol.mockResolvedValue(null);

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });
});

/**
 * A DONDE DEVUELVE EL LOGIN.
 *
 * Este `volverA` estuvo cableado a `/mi-gym/admin` y por eso NO CONSERVABA
 * NADA: `destinoPorRol` manda a un admin a esa misma URL, asi que el parametro
 * no cambiaba el aterrizaje de nadie. Aparentaba funcionar.
 */
describe('el panel devuelve a la pagina donde estaba', () => {
  it('al admin que cae en /admin/usuarios lo devuelve a /admin/usuarios', async () => {
    estampar('/mi-gym/admin/usuarios');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirigir).toHaveBeenCalledWith(alLogin('/mi-gym/admin/usuarios'));
    // NO la portada cableada: esa es justo la mentira que esto termina.
    expect(destinoDelLogin()).not.toBe(ENTRADA);
    expect(rutaDeRetornoSegura(destinoDelLogin() ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/admin/usuarios',
    );
  });

  it('la ruta vuelve con su query: un listado sin su filtro es otro listado', async () => {
    estampar('/mi-gym/admin/usuarios?tipo=profesor');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(rutaDeRetornoSegura(destinoDelLogin() ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/admin/usuarios?tipo=profesor',
    );
  });

  it('una cabecera falsificada hacia otro gimnasio cae al destino seguro', async () => {
    estampar('/otro-gimnasio/admin/usuarios');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
    expect(destinoDelLogin()).not.toContain('otro-gimnasio');
  });

  it('sin cabecera —sin middleware— se cae a la portada del panel', async () => {
    cabeceras.mockResolvedValue(new Headers());
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
  });
});

/**
 * LA AUDITORIA DE LO QUE SOBRA.
 *
 * Los ocho tests de arriba son de presencia: miran que este lo que tiene que
 * estar. Ninguno ve que la puerta AÑADA algo —un saludo, una insignia, el
 * email debajo del titulo— sin quitar nada. Y la puerta es justo el sitio
 * donde eso es facil: recibe el objeto entero de `/auth/me`, con el id, el
 * tenantId y el email dentro, y tiene todo eso a mano cuando dibuja.
 *
 * Esto se comprueba comparando TOTALES: el juego entero de props y el texto
 * entero de lo que se envuelve.
 */
describe('la puerta no agrega nada de su cosecha', () => {
  it('al armazon le llega EXACTAMENTE slug, rol, nombre y children', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    const props = propsDelArmazon.mock.calls[0]![0] as Record<string, unknown>;
    // La lista ENTERA de props: pasarle `yo` de postre tambien rompe. Y no es
    // cosmetico — el armazon acabara teniendo partes de cliente, y todo lo que
    // cruce se serializa al payload que viaja al navegador.
    expect(Object.keys(props).sort()).toEqual(['children', 'nombre', 'rol', 'slug']);
    expect(props.slug).toBe('mi-gym');
    expect(props.rol).toBe('ADMIN_OPERATIVO');
    expect(props.nombre).toBe('Ana Gomez');
  });

  it('lo que envuelve es la pagina y NADA MAS', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    expect(screen.getByTestId('armazon').textContent).toBe('el panel');
  });

  it('ni el id, ni el tenantId, ni el email llegan al DOM del panel', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    for (const centinela of CENTINELAS) {
      expect(document.body.innerHTML).not.toContain(centinela);
    }
  });

  it('la pantalla de sin permiso tampoco filtra nada de /auth/me', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto({ rol: 'ALUMNO' }));

    await montar();

    // Un 403 que le enseña a quien no tiene permiso el id interno de su propio
    // usuario no es un drama, pero es informacion que nadie pidio dibujar.
    for (const centinela of CENTINELAS) {
      expect(document.body.innerHTML).not.toContain(centinela);
    }
  });
});
