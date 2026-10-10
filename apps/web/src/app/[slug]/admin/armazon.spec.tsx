import { render, screen } from '@testing-library/react';
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
 * Los enlaces que hoy ve CUALQUIERA de los tres roles que entran al panel.
 *
 * Esta escrito a mano a proposito: es la lista blanca. Derivarlo de
 * `ENLACES_DEL_PANEL` haria que agregar una entrada cambiara a la vez lo que se
 * pinta y lo que se espera, y el test se quedaria sin dientes justo para la
 * familia de error que importa —agregar algo sin quitar nada—.
 */
const ENLACES_DE_HOY: [string, string][] = [
  ['Inicio', '/mi-gym/admin'],
  ['Calendario', '/mi-gym/admin/calendario'],
  ['Personas', '/mi-gym/admin/usuarios'],
  ['Invitaciones', '/mi-gym/admin/invitaciones'],
];

/** Los tres roles que entran al panel, y lo que le toca a cada uno. */
const ESPERADO_POR_ROL = {
  ADMIN_OPERATIVO: ENLACES_DE_HOY,
  ADMIN_SALON: ENLACES_DE_HOY,
  SUPERADMIN: ENLACES_DE_HOY,
} as const;

describe('la navegacion se dibuja desde el rol', () => {
  // LISTA BLANCA, no lista negra: se fija el conjunto ENTERO. Un enlace de mas
  // —el error que ningun test de presencia ve— rompe esto.
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
