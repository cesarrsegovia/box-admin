import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabla, type ColumnaDeTabla } from './tabla';

interface Persona {
  id: string;
  nombre: string;
  email: string;
}

const COLUMNAS: readonly ColumnaDeTabla<Persona>[] = [
  { encabezado: 'Nombre', celda: (fila) => fila.nombre },
  { encabezado: 'Email', celda: (fila) => fila.email },
];

const ANA: Persona = { id: 'u1', nombre: 'Ana', email: 'ana@gym.test' };
const BETO: Persona = { id: 'u2', nombre: 'Beto', email: 'beto@gym.test' };

function pintar(filas: Persona[], enlaceDeFila?: (fila: Persona) => string) {
  return render(
    <Tabla
      columnas={COLUMNAS}
      filas={filas}
      claveDeFila={(fila) => fila.id}
      enlaceDeFila={enlaceDeFila}
      vacio={<p>Aca no hay nadie</p>}
    />,
  );
}

describe('Tabla', () => {
  it('los encabezados van en <th>, que es de donde se agarra quien audita', () => {
    pintar([ANA]);

    expect([...document.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Nombre',
      'Email',
    ]);
  });

  it('cada <th> dice que encabeza una columna', () => {
    // Sin `scope`, un lector de pantalla lee una fila de celdas sueltas y la
    // persona que lo usa no sabe de que columna le estan hablando.
    pintar([ANA]);

    for (const th of document.querySelectorAll('th')) {
      expect(th.getAttribute('scope')).toBe('col');
    }
  });

  it('una fila por dato, y una celda por columna', () => {
    pintar([ANA, BETO]);

    const filas = [...document.querySelectorAll('tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].map((td) => td.textContent),
    );

    expect(filas).toEqual([
      ['Ana', 'ana@gym.test'],
      ['Beto', 'beto@gym.test'],
    ]);
  });

  /**
   * El vacio lo resuelve la tabla y no cada pantalla que la usa.
   *
   * Si fuera responsabilidad del llamador, la pantalla numero tres se olvidaria
   * y dejaria una cabecera con nada debajo: desde la calle eso se ve igual que
   * "se rompio algo", no como "no hay nadie".
   */
  it('sin filas no pinta una tabla con la cabecera sola', () => {
    pintar([]);

    expect(document.querySelector('table')).toBeNull();
    expect(screen.getByText('Aca no hay nadie')).toBeInTheDocument();
  });

  it('sin filas tampoco queda ningun <th> suelto', () => {
    pintar([]);

    expect(document.querySelectorAll('th')).toHaveLength(0);
  });

  it('con enlace, UN solo enlace por fila y al destino de ESA fila', () => {
    pintar([ANA, BETO], (fila) => `/fichas/${fila.id}`);

    expect([...document.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/fichas/u1',
      '/fichas/u2',
    ]);
  });

  it('sin enlace no hay ni un <a> en la tabla', () => {
    pintar([ANA, BETO]);

    expect(document.querySelectorAll('a')).toHaveLength(0);
  });

  it('el enlace de la fila dice a quien lleva, no "ver"', () => {
    // El texto del enlace es lo unico que oye quien navega por la lista de
    // enlaces de un lector de pantalla. Dos filas con "Ver" son dos destinos
    // indistinguibles.
    pintar([ANA, BETO], (fila) => `/fichas/${fila.id}`);

    expect(screen.getByRole('link', { name: 'Ana' })).toHaveAttribute('href', '/fichas/u1');
    expect(screen.getByRole('link', { name: 'Beto' })).toHaveAttribute('href', '/fichas/u2');
  });

  /**
   * En telefono la tabla se convierte en tarjetas por CSS, con el encabezado de
   * cada celda delante. Ese encabezado viaja en un atributo y se pinta con un
   * pseudoelemento: si se pintara como texto de verdad, estaria DOS veces en el
   * DOM —una en el `<th>` y otra en cada celda— y lo leeria dos veces un lector
   * de pantalla.
   */
  it('en telefono el encabezado de cada celda va en un atributo, no en el texto', () => {
    pintar([ANA]);

    const celdas = [...document.querySelectorAll('tbody td')];
    expect(celdas.map((td) => td.getAttribute('data-etiqueta'))).toEqual(['Nombre', 'Email']);
    expect(celdas.map((td) => td.textContent)).toEqual(['Ana', 'ana@gym.test']);
  });
});
