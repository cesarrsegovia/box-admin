import { cleanup, render, screen } from '@testing-library/react';
import { ROLES_USUARIO, type MeRespuesta, type RolUsuario } from '@boxadmin/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { destinoPorRol } from '@/lib/destino-por-rol';
import { rutaDeRetornoSegura } from '@/lib/ruta-de-retorno';
import { vigilarEstosDatos } from '@/test/espia-de-consola';

/**
 * LA PUERTA DEL AREA DE LA PROFESORA.
 *
 * Este archivo prueba DOS cosas que hasta la Fase 13 no existian y que solo
 * sirven juntas: que la puerta deje pasar a quien tiene que pasar, y que el
 * login mande a esa persona A ESTA PUERTA. Cada mitad sola es lo que habia
 * antes —un destino perfectamente calculado hacia una puerta cerrada— y por
 * eso el test que las une (`el login manda a una profesora a SU area`) usa la
 * funcion de verdad y monta el layout en la ruta que ella devuelve, en vez de
 * comparar dos cadenas escritas a mano en dos archivos.
 */

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
 * La navegacion se sustituye por un doble, igual que en el layout del alumno:
 * es de cliente y usaria `usePathname`, y asi se audita el juego EXACTO de
 * props que la puerta le pasa. La puerta tiene el `/auth/me` entero en la mano
 * y todo lo que cruce hacia un componente de cliente viaja en el payload RSC
 * aunque no se dibuje.
 */
const propsDeLaNavegacion = vi.fn();
vi.mock('./navegacion-profesora', () => ({
  NavegacionProfesora: (props: { slug: string }) => {
    propsDeLaNavegacion(props);
    return <nav data-testid="navegacion" />;
  },
}));

import LayoutDeProfesor from './layout';

/** La entrada del area, escrita UNA vez. Es la que devuelve `destinoPorRol`. */
const ENTRADA = '/mi-gym/mis-clases';

async function montar(): Promise<void> {
  const jsx = await LayoutDeProfesor({
    children: <p>la agenda de la profesora</p>,
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

/**
 * UN `/auth/me` ENTERO, con centinelas en los campos que nadie debe dibujar.
 *
 * La puerta recibe la respuesta COMPLETA de `/auth/me` —id, tenantId, email y
 * el nombre de la persona— y solo necesita el rol. Todo lo demas es lo que se
 * escapa cuando alguien agrega un saludo.
 */
function yoCompleto(cambios: Partial<MeRespuesta> = {}): MeRespuesta {
  return {
    id: 'usr-centinela-profe',
    tenantId: 'tnt-centinela-profe',
    nombreCompleto: 'Lucia Ferrari',
    email: 'lucia@centinela.test',
    rol: 'PROFESOR',
    activo: true,
    tenant: { id: 'tnt-centinela-profe', nombre: 'Mi Gym', slug: 'mi-gym', activo: true },
    ...cambios,
  };
}

const CENTINELAS = {
  elIdDeLaProfesora: 'usr-centinela-profe',
  elTenantDeLaProfesora: 'tnt-centinela-profe',
  elEmailDeLaProfesora: 'lucia@centinela.test',
  elTokenDeLaSesion: 'tok-centinela-profe',
};

/**
 * Los cuatro se registran en los trece canales globales.
 *
 * El `access` tambien, y no es simetrico con los otros tres: vive en una cookie
 * httpOnly justo para que el JavaScript de la pagina no pueda leerlo, asi que
 * un volcado suyo por `console` o por `localStorage` no filtra un dato — tira
 * el muro entero.
 */
vigilarEstosDatos(CENTINELAS);

/** El login con un destino a cuestas. */
function alLogin(destino: string): string {
  return `/mi-gym/login?volverA=${encodeURIComponent(destino)}`;
}

/** Lo que el middleware habria estampado si la profesora estuviera en `ruta`. */
function estampar(ruta: string): void {
  cabeceras.mockResolvedValue(new Headers({ 'x-ruta': ruta }));
}

/** El `volverA` que acabo en la URL del login, ya decodificado. */
function destinoDelLogin(): string | null {
  const url = redirigir.mock.calls[0]![0] as string;
  return new URL(url, 'http://x').searchParams.get('volverA');
}

/** Deja la sesion lista para un rol concreto. */
function conRol(rol: RolUsuario, yo: Partial<MeRespuesta> = {}): void {
  leerSesion.mockResolvedValue({ access: CENTINELAS.elTokenDeLaSesion, slug: 'mi-gym' });
  leerRol.mockResolvedValue(yoCompleto({ rol, ...yo }));
}

// ---------------------------------------------------------------------------
// Quien entra y quien no
// ---------------------------------------------------------------------------

describe('la puerta del area de la profesora', () => {
  it('una profesora llega a su area', async () => {
    conRol('PROFESOR');

    await montar();

    expect(screen.getByText('la agenda de la profesora')).toBeInTheDocument();
    // Y NO se la echa ni se le dibuja la pantalla de rechazo: las tres cosas
    // son distintas y un solo `getByText` no distingue «entro» de «entro y
    // ademas se le enseño el cartel».
    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.queryByText('Esta no es tu area')).not.toBeInTheDocument();
  });

  /**
   * EL CASO QUE LE PASABA A ELLA, AHORA AL REVES.
   *
   * Un alumno no es «una profesora con menos permisos»: es otra persona. Y
   * no se lo manda al login —volver a autenticarse no cambia el rol, seria un
   * bucle— sino que se le ofrece el sitio donde SI tiene algo, que es el
   * calendario. El `href` se afirma ENTERO y no por subcadena: `/mi-gym/`
   * esta dentro de `/mi-gym/mis-clases` tambien.
   */
  it('un alumno NO, y se le ofrece donde si tiene algo', async () => {
    conRol('ALUMNO');

    await montar();

    expect(screen.queryByText('la agenda de la profesora')).not.toBeInTheDocument();
    expect(redirigir).not.toHaveBeenCalled();

    const salida = document.querySelector('[data-salida]');
    expect(salida?.getAttribute('href')).toBe('/mi-gym/calendario');
    // Y el enlace DICE adonde lleva. «Ir a donde si tenes algo» es un enlace
    // que no se puede decidir pulsar.
    expect(salida?.textContent).toBe('Ir a tu calendario');

    // UNO, no dos: un `getByRole(..., { name: ... })` encuentra el suyo aunque
    // al lado cuelguen otros tres. Solo el total los ve.
    expect(screen.queryAllByRole('link')).toHaveLength(1);
  });

  it('un admin tampoco', async () => {
    conRol('ADMIN_OPERATIVO');

    await montar();

    expect(screen.queryByText('la agenda de la profesora')).not.toBeInTheDocument();

    const salida = document.querySelector('[data-salida]');
    expect(salida?.getAttribute('href')).toBe('/mi-gym/admin');
    expect(salida?.textContent).toBe('Ir al panel');
  });

  /**
   * LA JERARQUIA NO ABRE ESTA PUERTA, Y ESO NO SE VE CON UN SOLO ROL.
   *
   * `ADMIN_SALON` y `SUPERADMIN` estan POR ENCIMA de `PROFESOR` en
   * `JERARQUIA_ROLES`, asi que un `rolAlcanza(yo.rol, 'PROFESOR')` —la forma
   * obvia de escribir esta comprobacion— los dejaria pasar a los dos. El test
   * de `ADMIN_OPERATIVO` solo tapa uno de los tres.
   */
  it('ningun rol que no sea PROFESOR entra, ni siquiera los de mas arriba', async () => {
    for (const rol of ROLES_USUARIO) {
      if (rol === 'PROFESOR') continue;

      // El `cleanup()` global corre entre TESTS, no entre vueltas de un bucle:
      // sin esto la segunda vuelta encuentra dos pantallas montadas y falla
      // con «Found multiple elements», que apunta al rol equivocado.
      cleanup();
      leerRol.mockReset();
      conRol(rol);

      await montar();

      expect(
        screen.queryByText('la agenda de la profesora'),
        `con rol ${rol}`,
      ).not.toBeInTheDocument();
      expect(screen.getByText('Esta no es tu area'), `con rol ${rol}`).toBeInTheDocument();
    }
  });

  /**
   * EL FANTASMA NO TIENE ADONDE IR, Y ESO SE DICE CON UN BOTON Y NO CON UN
   * ENLACE.
   *
   * `destinoPorRol` lo manda al calendario porque es el respaldo de todo lo que
   * no es admin ni profesor, pero el calendario tambien lo rechaza: es un rol
   * tecnico, rango 0. Ofrecerle el enlace seria mandarlo a una puerta que ya
   * sabemos cerrada — que es exactamente el bug que esta fase arreglo para la
   * profesora, y repetirlo con otro rol seria no haber aprendido nada.
   */
  it('a un FANTASMA no se le ofrece ningun enlace, solo cerrar sesion', async () => {
    conRol('FANTASMA');

    await montar();

    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /cerrar sesion/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// La sesion
// ---------------------------------------------------------------------------

describe('sin sesion', () => {
  it('sin sesion se va al login conservando a donde queria ir', async () => {
    // El caso real: la profesora abre el enlace de UNA clase —el que se guardo
    // en el telefono— y la sesion esta vencida. Volver a la agenda la obliga a
    // buscar otra vez la clase que tiene delante, de pie y con gente esperando.
    estampar('/mi-gym/mis-clases/turno-de-las-nueve?x=1');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe('/mi-gym/mis-clases/turno-de-las-nueve?x=1');

    // Y VUELVE AHI: el destino pasa por la MISMA funcion que usa el formulario
    // de login al entrar. Que la puerta lo escriba no sirve de nada si el que
    // lo lee lo descarta.
    expect(rutaDeRetornoSegura(destinoDelLogin() ?? undefined, 'mi-gym')).toBe(
      '/mi-gym/mis-clases/turno-de-las-nueve?x=1',
    );

    // Y viaja CODIFICADO: sin codificar, el `?x=1` del destino se leeria como
    // un parametro MAS del login y el destino llegaria partido en dos.
    expect(redirigir.mock.calls[0]![0] as string).toContain('%3Fx%3D1');
  });

  it('sin cabecera —sin middleware— se cae a la entrada del area', async () => {
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    // Ni vacio, ni "null", ni "undefined" metidos en la URL.
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('con sesion de otro gimnasio manda al login', async () => {
    // Las cookies son del dominio pero los tokens son de un gimnasio: sin esto,
    // quien tiene sesion en /gym-a y abre /mi-gym/mis-clases veria la agenda de
    // A bajo la URL de B.
    leerSesion.mockResolvedValue({ access: 'tok', slug: 'otro-gimnasio' });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('si /auth/me falla, manda al login', async () => {
    // Un token caducado da 401 en /auth/me: eso SI se arregla volviendo a
    // entrar, al reves que el rol equivocado.
    leerSesion.mockResolvedValue({ access: 'caducado', slug: 'mi-gym' });
    leerRol.mockResolvedValue(null);

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');
    expect(redirigir).toHaveBeenCalledWith(alLogin(ENTRADA));
  });

  it('una cabecera falsificada hacia otro gimnasio cae al destino seguro', async () => {
    // El matcher del middleware no cubre todas las rutas, y en las que no cubre
    // una `x-ruta` escrita por el cliente llega al servidor tal cual.
    estampar('/otro-gimnasio/sus-datos');
    leerSesion.mockResolvedValue({ access: undefined, slug: undefined });

    await expect(montar()).rejects.toThrow('NEXT_REDIRECT');

    expect(destinoDelLogin()).toBe(ENTRADA);
    expect(destinoDelLogin()).not.toContain('otro-gimnasio');
  });
});

// ---------------------------------------------------------------------------
// La otra mitad de la reparacion
// ---------------------------------------------------------------------------

/**
 * EL LOGIN Y LA PUERTA, MEDIDOS JUNTOS.
 *
 * Hasta esta fase `destinoPorRol` mandaba a la profesora al calendario, cuyo
 * layout exige `rol === 'ALUMNO'`: entrar correctamente la echaba. Las dos
 * piezas estaban cada una bien por su cuenta y el sistema estaba roto EN EL
 * HUECO, que es el sitio donde ningun spec de una sola pieza mira.
 */
describe('el login manda a una profesora a SU area', () => {
  it('el destino del login es exactamente la ruta que esta puerta guarda', () => {
    expect(destinoPorRol('PROFESOR', 'mi-gym')).toBe(ENTRADA);
  });

  it('y esa puerta la deja entrar', async () => {
    // La mitad que falta, y la que convierte el test de arriba en algo mas que
    // dos cadenas iguales: se monta la puerta de la ruta QUE SALE de
    // `destinoPorRol` —no una escrita a mano— y se comprueba que no rebota.
    expect(destinoPorRol('PROFESOR', 'mi-gym')).toBe(ENTRADA);

    conRol('PROFESOR');
    await montar();

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.getByText('la agenda de la profesora')).toBeInTheDocument();
  });

  it('y NO la manda al calendario, que es de donde la echaban', async () => {
    // El caso ciego de los dos de arriba: una funcion que devolviera
    // `/mi-gym/mis-clases` para todo el mundo los pasaria. Esta linea dice
    // adonde NO va, y la siguiente que el sitio del que se la echaba sigue
    // siendo el del alumno.
    expect(destinoPorRol('PROFESOR', 'mi-gym')).not.toBe('/mi-gym/calendario');
    expect(destinoPorRol('ALUMNO', 'mi-gym')).toBe('/mi-gym/calendario');
  });
});

describe('la navegacion del area', () => {
  it('a la profesora se le da la navegacion, FUERA del main, con solo el slug', async () => {
    conRol('PROFESOR');

    await montar();

    const barra = screen.getByTestId('navegacion');
    expect(barra.closest('main')).toBeNull();
    // Y el juego de props es EXACTAMENTE el slug: ni id, ni email, ni tenant.
    expect(propsDeLaNavegacion.mock.calls).toEqual([[{ slug: 'mi-gym' }]]);
  });

  it('a quien no es profesora no se le da, para NINGUN otro rol', async () => {
    for (const rol of ROLES_USUARIO.filter((otro) => otro !== 'PROFESOR')) {
      conRol(rol);

      await montar();

      expect(screen.queryByTestId('navegacion'), rol).toBeNull();
      expect(propsDeLaNavegacion, rol).not.toHaveBeenCalled();
      cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Lo que la puerta no agrega de su cosecha
// ---------------------------------------------------------------------------

/**
 * LA AUDITORIA DE LO QUE SOBRA.
 *
 * Los tests de arriba son de presencia: miran que este lo que tiene que estar.
 * Ninguno ve que la puerta AÑADA algo sin quitar nada —un «Hola, Lucia», una
 * insignia con el gimnasio—, y la puerta es justo donde eso es facil: recibe el
 * `/auth/me` entero y solo necesita el rol.
 */
describe('la puerta no agrega nada de su cosecha', () => {
  it('lo que envuelve es la pagina y NADA MAS', async () => {
    conRol('PROFESOR');

    await montar();

    expect(screen.getByRole('main').textContent).toBe('la agenda de la profesora');
  });

  it('ni el id, ni el tenantId, ni el email llegan al DOM, para NINGUN rol', async () => {
    // Se barren TODOS los roles porque cada uno sale por una rama distinta
    // —entra, se le ofrece un enlace, se le ofrece salir— y un test de un solo
    // rol solo audita la rama de ese rol.
    for (const rol of ROLES_USUARIO) {
      cleanup();
      leerRol.mockReset();
      conRol(rol);

      await montar();

      for (const [nombre, centinela] of Object.entries(CENTINELAS)) {
        expect(document.body.innerHTML, `${nombre} con rol ${rol}`).not.toContain(centinela);
      }
    }
  });
});
