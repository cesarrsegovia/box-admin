import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavegacionProfesora } from './navegacion-profesora';

// La ruta en la que esta la profesora, mutable a proposito: `usePathname` se
// llama en cada render y tiene que devolver lo que el test de turno puso.
const { ruta } = vi.hoisted(() => ({ ruta: { valor: '' } }));

vi.mock('next/navigation', () => ({
  usePathname: () => ruta.valor,
}));

beforeEach(() => {
  ruta.valor = '/mi-gym/mis-clases';
});

/** Las secciones que la barra ofrece, en orden, como [texto, href]. */
function secciones(): [string | null, string | null][] {
  return screen
    .getAllByRole('link')
    .map((enlace) => [enlace.textContent, enlace.getAttribute('href')]);
}

/** Los textos de los enlaces marcados como pagina actual. */
function activas(): (string | null)[] {
  return screen
    .getAllByRole('link')
    .filter((enlace) => enlace.getAttribute('aria-current') === 'page')
    .map((enlace) => enlace.textContent);
}

describe('la navegacion de la profesora', () => {
  it('ofrece sus dos secciones, con el slug en cada enlace', () => {
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(secciones()).toEqual([
      ['Mis clases', '/mi-gym/mis-clases'],
      ['Mi liquidación', '/mi-gym/mi-liquidacion'],
    ]);
  });

  it('en la agenda, la activa es Mis clases y nada mas', () => {
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(activas()).toEqual(['Mis clases']);
  });

  it('en su liquidacion, la activa es Mi liquidación y nada mas', () => {
    ruta.valor = '/mi-gym/mi-liquidacion';
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(activas()).toEqual(['Mi liquidación']);
  });

  it('dentro de una clase, la activa sigue siendo Mis clases', () => {
    // `mis-clases/[turnoId]` es una subruta: la profesora si las tiene, a
    // diferencia del alumno, y una igualdad a secas la dejaria sin activa.
    ruta.valor = '/mi-gym/mis-clases/turno-de-las-nueve';
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(activas()).toEqual(['Mis clases']);
  });

  it('una ruta que solo COMIENZA igual no cuenta como la seccion', () => {
    // `mis-clases-viejas` empieza por `mis-clases` y no es una subruta suya:
    // el prefijo se compara con la barra, no a ojo.
    ruta.valor = '/mi-gym/mis-clases-viejas';
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(activas()).toEqual([]);
  });

  it('en una ruta ajena al area, ninguna esta activa', () => {
    ruta.valor = '/mi-gym/calendario';
    render(<NavegacionProfesora slug="mi-gym" />);

    expect(activas()).toEqual([]);
  });

  it('la barra va fija abajo, como la del alumno', () => {
    render(<NavegacionProfesora slug="mi-gym" />);

    const barra = screen.getByRole('navigation', { name: 'Secciones' });
    expect(barra.className).toContain('fixed');
    expect(barra.className).toContain('bottom-0');
  });
});
