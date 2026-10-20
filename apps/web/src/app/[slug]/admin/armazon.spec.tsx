import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Armazon } from './armazon';
import { enlacesPara } from './navegacion-admin';

vi.mock('next/navigation', () => ({ usePathname: () => '/mi-gym/admin' }));

function enlacesDelDocumento(): [string, string][] {
  return [...document.querySelectorAll('a')].map((a) => [
    a.textContent?.trim() ?? '',
    a.getAttribute('href') ?? '',
  ]);
}

/**
 * Los enlaces que hoy ve un ADMIN_OPERATIVO, que es el rol MINIMO del panel.
 *
 * Esta escrito a mano a proposito: es la lista blanca. Derivarlo de
 * `ENLACES_DEL_PANEL` haria que agregar una entrada cambiara a la vez lo que se
 * pinta y lo que se espera, y el test se quedaria sin dientes justo para la
 * familia de error que importa —agregar algo sin quitar nada—.
 *
 * HASTA LA FASE 12 ESTA LISTA ERA TAMBIEN LA DE LOS OTROS DOS ROLES, y eso
 * hacia que `ESPERADO_POR_ROL` fueran tres referencias al mismo arreglo: el
 * `it.each` de abajo barria tres roles y afirmaba tres veces lo mismo. La
 * jerarquia de `rolAlcanza` solo se habia ejercitado en la direccion de la
 * lista VACIA (`ALUMNO`, `PROFESOR`); que un rol que SI entra vea MENOS que
 * otro no habia pasado nunca, porque las once entradas pedian
 * `ADMIN_OPERATIVO`. Con «Configuracion» ahi abajo, ya pasa.
 */
const ENLACES_DE_HOY: [string, string][] = [
  ['Inicio', '/mi-gym/admin'],
  ['Calendario', '/mi-gym/admin/calendario'],
  ['Turnos', '/mi-gym/admin/turnos'],
  ['Personas', '/mi-gym/admin/usuarios'],
  ['Invitaciones', '/mi-gym/admin/invitaciones'],
  ['Salas', '/mi-gym/admin/salas'],
  ['Horarios', '/mi-gym/admin/horarios'],
  ['Cierres', '/mi-gym/admin/ausencias'],
  ['Analisis', '/mi-gym/admin/analisis'],
  // La asistencia por alumno es la unica entrada con una ruta ANIDADA, y esta
  // escrita entera a mano como el resto: si el armazon dejara de componer el
  // `href` con la ruta tal cual —recortandola al primer segmento, por
  // ejemplo— este par dejaria de cuadrar.
  ['Asistencia', '/mi-gym/admin/analisis/asistencia'],
];

/**
 * LA ENTRADA DE CONFIGURACION, LA PRIMERA DEL PANEL QUE PIDE `ADMIN_SALON`.
 *
 * Los catorce endpoints de configuracion lo piden, asi que la puerta es del
 * area entera. Va escrita a mano como el resto de la lista blanca.
 */
const CONFIGURACION: [string, string] = ['Configuracion', '/mi-gym/admin/configuracion'];

/**
 * Lo que ve un rol que alcanza `ADMIN_SALON`: TODO lo del operativo Y ADEMAS
 * la configuracion.
 *
 * Se compone del arreglo de arriba en vez de reescribir las once lineas, y eso
 * NO es derivarlo de la funcion que se audita: las dos piezas siguen escritas
 * a mano y la relacion que expresa el `...` —«un rol alto ve todo lo del bajo y
 * algo mas»— es justamente la propiedad de `rolAlcanza` que esta fase estrena.
 * Lo que no se puede hacer es construirlo con `enlacesPara`, que es el autor de
 * lo que se compara.
 */
const ENLACES_DE_UN_ADMIN_SALON: [string, string][] = [...ENLACES_DE_HOY, CONFIGURACION];

/**
 * Los tres roles que entran al panel, y lo que le toca a cada uno.
 *
 * YA NO SON TRES VECES LO MISMO: el operativo ve una entrada MENOS, que es la
 * primera vez que este test distingue un rol de otro.
 */
const ESPERADO_POR_ROL = {
  ADMIN_OPERATIVO: ENLACES_DE_HOY,
  ADMIN_SALON: ENLACES_DE_UN_ADMIN_SALON,
  SUPERADMIN: ENLACES_DE_UN_ADMIN_SALON,
} as const;

describe('la navegacion se dibuja desde el rol', () => {
  // LISTA BLANCA, no lista negra: se fija el conjunto ENTERO. Un enlace de mas
  // —el error que ningun test de presencia ve— rompe esto. Y desde la Fase 12
  // el «solo estos» tiene un caso real que excluir: «Configuracion».
  it('un ADMIN_OPERATIVO ve ESTOS enlaces y solo estos', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(enlacesDelDocumento()).toEqual(ESPERADO_POR_ROL.ADMIN_OPERATIVO);
  });

  // La lista blanca de arriba mira UN rol, y al panel entran tres. Un enlace
  // cableado en el JSX debajo de un `if` de rol alto —agregar algo sin quitar
  // nada, que es la familia de error que ningun test de presencia ve— se cuela
  // entero por ese hueco. Esto ata el DOM a la lista declarativa para TODOS los
  // roles que entran, no solo para el de abajo.
  //
  // Y la segunda afirmacion ata la lista declarativa a lo ESCRITO A MANO. Hace
  // falta porque la primera, sola, se compara contra si misma: agregar una
  // entrada a `ENLACES_DEL_PANEL` mueve los dos lados a la vez y el test sigue
  // verde. Se midio — la Tarea 3 agrego Calendario y este test no se entero.
  it.each(['ADMIN_OPERATIVO', 'ADMIN_SALON', 'SUPERADMIN'] as const)(
    'un %s no ve ni un enlace que no este en la lista declarativa',
    (rol) => {
      render(
        <Armazon slug="mi-gym" rol={rol} nombre="Ana">
          <p>contenido</p>
        </Armazon>,
      );

      const deLaLista: [string, string][] = enlacesPara(rol).map((enlace) => [
        enlace.texto,
        enlace.ruta === '' ? '/mi-gym/admin' : `/mi-gym/admin/${enlace.ruta}`,
      ]);

      expect(enlacesDelDocumento()).toEqual(deLaLista);
      expect(deLaLista).toEqual(ESPERADO_POR_ROL[rol]);
    },
  );

  it('enlacesPara no devuelve nada que el rol no alcance', () => {
    expect(enlacesPara('ALUMNO')).toEqual([]);
    expect(enlacesPara('PROFESOR')).toEqual([]);
  });

  /**
   * LA DIRECCION DE LA JERARQUIA QUE NUNCA SE HABIA EJERCITADO.
   *
   * Las dos afirmaciones juntas y en el mismo test: por separado, la primera
   * pasaria tambien con la entrada borrada de `ENLACES_DEL_PANEL` y la segunda
   * tambien con un `minimo: 'ADMIN_OPERATIVO'`. Lo que se fija es la
   * DIFERENCIA entre los dos roles, que es lo nuevo.
   *
   * Se mira el marcado CRUDO —`document.querySelectorAll('a')`— y no un
   * `queryByRole('link')`: el arbol de accesibilidad ya excluye lo que lleva
   * `hidden`, asi que un `null` ahi no distingue «no esta» de «esta oculto».
   */
  it('la Configuracion la ve un ADMIN_SALON y NO un ADMIN_OPERATIVO', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(enlacesDelDocumento().filter(([, href]) => href === CONFIGURACION[1])).toEqual([]);

    cleanup();

    render(
      <Armazon slug="mi-gym" rol="ADMIN_SALON" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(enlacesDelDocumento().filter(([, href]) => href === CONFIGURACION[1])).toEqual([
      CONFIGURACION,
    ]);
  });

  it('el armazon dice quien sos', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana Perez">
        <p>contenido</p>
      </Armazon>,
    );

    expect(screen.getByText('Ana Perez')).toBeInTheDocument();
  });

  it('pinta el contenido que le pasan', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  // Tambien por totales: no basta con que el enlace activo lo lleve, hace falta
  // que sea el UNICO. Marcarlos todos se ve igual de bien en un test de
  // presencia y deja al lector de pantalla sin saber donde esta.
  it('solo el enlace de la ruta actual lleva aria-current', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    const marcados = [...document.querySelectorAll('a[aria-current]')].map((a) => [
      a.textContent?.trim() ?? '',
      a.getAttribute('aria-current'),
    ]);

    expect(marcados).toEqual([['Inicio', 'page']]);
  });
});
