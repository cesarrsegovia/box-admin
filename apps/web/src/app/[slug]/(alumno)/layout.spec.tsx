import { render, screen } from '@testing-library/react';
import { ROLES_USUARIO, type MeRespuesta } from '@boxadmin/shared';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirigir = vi.fn();
const navegar = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (destino: string) => {
    redirigir(destino);
    throw new Error('NEXT_REDIRECT');
  },
  // El boton de salir es de cliente y pide `useRouter`. No se prueba aqui
  // —tiene su propio spec— pero sin esto ni se monta.
  useRouter: () => ({ push: navegar }),
}));

/**
 * El doble del middleware: lo que estaria estampado en la peticion.
 *
 * `rutaPedida` NO se mockea. Es la pieza que decide si la cabecera se cree o
 * no, y mockearla dejaria sin probar justo eso: `rutaDeRetornoSegura` corre de
 * verdad en estos tests.
 */
const cabeceras = vi.fn();
vi.mock('next/headers', () => ({
  headers: () => cabeceras(),
  // `lib/sesion` la importa. No se llega a usar —`leerSesion` esta doblada—
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
 * La navegacion se sustituye por un doble por dos motivos: es de cliente y
 * usaria `usePathname`, y —lo que importa— asi se puede auditar el juego
 * EXACTO de props que la puerta le pasa. La puerta tiene el `/auth/me` entero
 * en la mano cuando dibuja, y todo lo que cruce hacia un componente de cliente
 * viaja en el payload RSC aunque no se dibuje.
 */
const propsDeLaNavegacion = vi.fn();
vi.mock('@/componentes/navegacion', () => ({
  Navegacion: (props: { slug: string }) => {
    propsDeLaNavegacion(props);
    return <nav data-testid="navegacion" />;
  },
}));

import LayoutDeAlumno from './layout';

async function montar() {
  const jsx = await LayoutDeAlumno({
    children: <p>el area del alumno</p>,
    params: Promise.resolve({ slug: 'mi-gym' }),
  });
  render(jsx);
}

beforeEach(() => {
  redirigir.mockClear();
  navegar.mockClear();
  leerSesion.mockReset();
  leerRol.mockReset();
  propsDeLaNavegacion.mockClear();
  // Por defecto, SIN middleware: ninguna ruta estampada.
  cabeceras.mockResolvedValue(new Headers());
});

/** Un `/auth/me` ENTERO, con centinelas en los campos que nadie debe dibujar. */
function yoCompleto(cambios: Partial<MeRespuesta> = {}): MeRespuesta {
  return {
    id: 'usr-centinela',
    tenantId: 'tnt-centinela',
    nombreCompleto: 'Ana Gomez',
    email: 'ana@centinela.test',
    rol: 'ALUMNO',
    activo: true,
    tenant: { id: 'tnt-centinela', nombre: 'Mi Gym', slug: 'mi-gym', activo: true },
    ...cambios,
  };
}

const CENTINELAS = ['usr-centinela', 'tnt-centinela', 'ana@centinela.test'];

/** El login con un destino a cuestas. */
function alLogin(destino: string) {
  return `/mi-gym/login?volverA=${encodeURIComponent(destino)}`;
}

/** Lo que el middleware habria estampado si el usuario estuviera en `ruta`. */
function estampar(ruta: string) {
  cabeceras.mockResolvedValue(new Headers({ 'x-ruta': ruta }));
}

/** El `volverA` que acabo en la URL del login, ya decodificado. */
function destinoDelLogin(): string | null {
  const url = redirigir.mock.calls[0]![0] as string;
  return new URL(url, 'http://x').searchParams.get('volverA');
}

/** Sin middleware: la entrada del area. */
const ENTRADA = '/mi-gym/calendario';

describe('la puerta del area de alumno', () => {
  it('sin sesion manda al login', async () => {
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('con sesion de otro gimnasio manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'otro-gimnasio' });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  /**
   * El destino viaja CODIFICADO, no crudo.
   *
   * Un `volverA=/mi-gym/calendario` sin codificar sobrevive mientras el destino
   * no lleve query propia; el dia que la lleve —un `?f=` como el del check-in—
   * su `&` parte el query del login en dos y el destino llega mutilado. Se
   * comprueba parseando, no comparando la cadena: asi el test dice que el
   * destino se recupera entero, no como se escribio.
   */
  it('el destino viaja codificado dentro del query', async () => {
    estampar('/mi-gym/mi-pack?mes=2026-10');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    const destino = redirigir.mock.calls[0]![0] as string;
    // Sin codificar, el `?mes=` del destino se leeria como un parametro MAS
    // del login y el destino llegaria partido en dos.
    expect(destino).toContain('%3Fmes%3D2026-10');
    expect(destinoDelLogin()).toBe('/mi-gym/mi-pack?mes=2026-10');
  });

  it('un ALUMNO entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ALUMNO' });

    await montar();

    expect(screen.getByText('el area del alumno')).toBeInTheDocument();
  });

  // El caso que esta tarea existe para cerrar.
  it('un ADMIN_OPERATIVO NO entra al area del alumno', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO' });

    await montar();

    expect(screen.queryByText('el area del alumno')).not.toBeInTheDocument();
  });

  it('a un admin se le ofrece ir a SU panel, no se lo manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_OPERATIVO' });

    await montar();

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /panel/i })).toHaveAttribute('href', '/mi-gym/admin');
  });

  // Un token caducado da 401 en /auth/me: eso SI se arregla volviendo a entrar.
  it('si /auth/me falla, manda al login', async () => {
    leerSesion.mockResolvedValue({ access: 'caducado', slug: 'mi-gym' });
    leerRol.mockResolvedValue(null);

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('un PROFESOR tampoco entra', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    expect(screen.queryByText('el area del alumno')).not.toBeInTheDocument();
  });
});

/**
 * DE DONDE SE LO ECHA, AHI VUELVE.
 *
 * El caso que motivo el middleware: hasta ahora el `volverA` llevaba una
 * constante, asi que a quien se le vencia la sesion en `/mi-pack` aterrizaba
 * en el calendario. La ruta llega en una cabecera, y la cabecera no se cree
 * sin mirarla.
 */
describe('a donde devuelve el login', () => {
  it('al alumno al que se le vence la sesion en /mi-pack lo devuelve a /mi-pack', async () => {
    estampar('/mi-gym/mi-pack');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(redirigir).toHaveBeenCalledWith(alLogin('/mi-gym/mi-pack'));
    // Y VUELVE AHI: el destino se pasa por la MISMA funcion que usa el
    // formulario de login al entrar. Que la puerta lo escriba no sirve de nada
    // si el que lo lee lo descarta.
    expect(rutaDeRetornoSegura(destinoDelLogin() ?? undefined, 'mi-gym')).toBe('/mi-gym/mi-pack');
  });

  it('la ruta vuelve con su query puesta: sin el filtro es otra pagina', async () => {
    estampar('/mi-gym/comprobantes?tipo=profesor');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(rutaDeRetornoSegura(destinoDelLogin() ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/comprobantes?tipo=profesor',
    );
  });

  /**
   * ⚠️ LA CABECERA NO SE CONFIA.
   *
   * El matcher del middleware no cubre todas las rutas, y en las que no cubre
   * una `x-ruta` escrita por el cliente llega al servidor tal cual. Si se
   * usara sin mirar, cualquiera se fabricaria un login que al entrar escupe al
   * usuario fuera de su gimnasio —o fuera del dominio—.
   */
  it('una cabecera falsificada hacia otro gimnasio cae al destino seguro', async () => {
    estampar('/otro-gimnasio/sus-datos');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
    expect(destinoDelLogin()).not.toContain('otro-gimnasio');
  });

  it('una cabecera falsificada hacia fuera del dominio tampoco pasa', async () => {
    estampar('//evil.com/phishing');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
  });

  it('un ".." codificado, que el navegador normaliza fuera, tampoco', async () => {
    estampar('/mi-gym/%2e%2e/otro-gimnasio/sus-datos');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
  });

  it('sin cabecera —sin middleware— se cae a la entrada del area', async () => {
    cabeceras.mockResolvedValue(new Headers());
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    // Ni vacio, ni "null", ni "undefined" metidos en la URL.
    expect(destinoDelLogin()).toBe(ENTRADA);
  });
});

/**
 * EL CALLEJON DEL PROFESOR.
 *
 * El profesor no es alumno, pero tampoco llega a `ADMIN_OPERATIVO`: el panel
 * lo rechazaria con su propia pantalla de sin permiso. Ofrecerle "ir al panel"
 * seria mandarlo a una puerta que ya sabemos cerrada, y ofrecerle el login
 * seria peor: `destinoPorRol` devuelve al profesor al calendario, que es esta
 * misma pantalla. Lo unico que de verdad lo saca de aqui es cerrar sesion.
 */
describe('a quien no tiene panel no se le ofrece un panel', () => {
  it('a un PROFESOR no se le ofrece el panel', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    expect(screen.queryByRole('link', { name: /panel/i })).not.toBeInTheDocument();
    // Ni ningun otro enlace: el unico camino es el boton de salir.
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('a un PROFESOR se le ofrece cerrar sesion', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'PROFESOR' });

    await montar();

    expect(screen.getByRole('button', { name: /cerrar sesion/i })).toBeInTheDocument();
  });

  it('a un ADMIN_SALON si, porque el panel lo acepta', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'ADMIN_SALON' });

    await montar();

    expect(screen.getByRole('link', { name: /panel/i })).toHaveAttribute('href', '/mi-gym/admin');
  });

  it('un FANTASMA tampoco entra ni recibe panel', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue({ rol: 'FANTASMA' });

    await montar();

    expect(screen.queryByText('el area del alumno')).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});

/**
 * LA AUDITORIA DE LO QUE SOBRA.
 *
 * Los tests de arriba son de presencia: miran que este lo que tiene que estar.
 * Ninguno ve que la puerta AÑADA algo sin quitar nada —un saludo, una insignia,
 * una prop de postre a un componente de cliente—, y la puerta es justo donde
 * eso es facil: recibe el `/auth/me` entero, con id, tenantId y email dentro.
 *
 * Esto solo se ve comparando TOTALES.
 */
describe('la puerta no agrega nada de su cosecha', () => {
  it('a la navegacion le llega EXACTAMENTE slug', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    const props = propsDeLaNavegacion.mock.calls[0]![0] as Record<string, unknown>;
    // La lista ENTERA: pasarle `yo` de postre tambien rompe. No es cosmetico
    // —la navegacion es de CLIENTE, asi que todo lo que cruce se serializa al
    // payload RSC y queda a la vista en el "ver codigo fuente".
    expect(Object.keys(props).sort()).toEqual(['slug']);
    expect(props.slug).toBe('mi-gym');
  });

  it('lo que envuelve es la pagina y NADA MAS', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    expect(screen.getByRole('main').textContent).toBe('el area del alumno');
  });

  it('ni el id, ni el tenantId, ni el email llegan al DOM del alumno', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto());

    await montar();

    for (const centinela of CENTINELAS) {
      expect(document.body.innerHTML).not.toContain(centinela);
    }
  });

  it('a un admin se le ofrece UN enlace, no dos', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto({ rol: 'ADMIN_OPERATIVO' }));

    await montar();

    // Un `getByRole(..., { name: /panel/i })` encuentra el suyo aunque al lado
    // cuelguen otros tres. Solo el total los ve.
    expect(screen.queryAllByRole('link')).toHaveLength(1);
  });

  /**
   * EL TOKEN NO SE DIBUJA. NI AQUI NI EN NINGUN ROL.
   *
   * El access vive en una cookie httpOnly justo para que el JavaScript de la
   * pagina no pueda leerlo. Pintarlo en el HTML —aunque sea en un `data-` que
   * no se ve— tira ese muro abajo: queda en el "ver codigo fuente", en el
   * payload RSC y al alcance de cualquier script de terceros.
   *
   * Se barren TODOS los roles porque cada uno sale por una rama distinta, y un
   * test de un solo rol solo audita la rama de ese rol.
   */
  it('el token de la sesion no se dibuja para NINGUN rol', async () => {
    for (const rol of ROLES_USUARIO) {
      leerSesion.mockResolvedValue({ access: 'tok-centinela', slug: 'mi-gym' });
      leerRol.mockResolvedValue(yoCompleto({ rol }));

      await montar();

      expect(document.body.innerHTML, `con rol ${rol}`).not.toContain('tok-centinela');
    }
  });

  it('la pantalla de "esta no es tu area" tampoco filtra nada de /auth/me', async () => {
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'mi-gym' });
    leerRol.mockResolvedValue(yoCompleto({ rol: 'ADMIN_OPERATIVO' }));

    await montar();

    for (const centinela of CENTINELAS) {
      expect(document.body.innerHTML).not.toContain(centinela);
    }
  });
});
