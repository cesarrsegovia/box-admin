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

describe('la navegacion se dibuja desde el rol', () => {
  // LISTA BLANCA, no lista negra: se fija el conjunto ENTERO. Un enlace de mas
  // —el error que ningun test de presencia ve— rompe esto.
  it('un ADMIN_OPERATIVO ve ESTOS enlaces y solo estos', () => {
    render(
      <Armazon slug="mi-gym" rol="ADMIN_OPERATIVO" nombre="Ana">
        <p>contenido</p>
      </Armazon>,
    );

    expect(enlacesDelDocumento()).toEqual([
      ['Inicio', '/mi-gym/admin'],
      ['Personas', '/mi-gym/admin/usuarios'],
      ['Invitaciones', '/mi-gym/admin/invitaciones'],
    ]);
  });

  // La lista blanca de arriba mira UN rol, y al panel entran tres. Un enlace
  // cableado en el JSX debajo de un `if` de rol alto —agregar algo sin quitar
  // nada, que es la familia de error que ningun test de presencia ve— se cuela
  // entero por ese hueco. Esto ata el DOM a la lista declarativa para TODOS los
  // roles que entran, no solo para el de abajo.
  it.each(['ADMIN_OPERATIVO', 'ADMIN_SALON', 'SUPERADMIN'] as const)(
    'un %s no ve ni un enlace que no este en la lista declarativa',
    (rol) => {
      render(
        <Armazon slug="mi-gym" rol={rol} nombre="Ana">
          <p>contenido</p>
        </Armazon>,
      );

      expect(enlacesDelDocumento()).toEqual(
        enlacesPara(rol).map((enlace) => [
          enlace.texto,
          enlace.ruta === '' ? '/mi-gym/admin' : `/mi-gym/admin/${enlace.ruta}`,
        ]),
      );
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
