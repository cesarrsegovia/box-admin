import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MiPackPublico } from '@boxadmin/shared';
import { ResumenDelPack } from './resumen-del-pack';

function pack(cambios: Partial<MiPackPublico> = {}): MiPackPublico {
  return {
    pack: {
      id: 'pack-1',
      tenantId: 'gym-1',
      nombre: '8 clases',
      salaId: null,
      tipo: 'MENSUAL',
      precio: null,
      clasesPorMes: 8,
      clasesTotales: null,
      cancelacionesPermitidas: 2,
      activo: true,
    },
    tope: 8,
    consumidas: 3,
    restantes: 5,
    ventanaDesde: '2099-10-01',
    ventanaHasta: '2099-10-31',
    clasesExtra: 0,
    cancelacionesUsadas: 1,
    cancelacionesPermitidas: 2,
    pagoAlDia: true,
    vigenciaDesde: null,
    vigenciaHasta: null,
    ...cambios,
  };
}

describe('ResumenDelPack', () => {
  it('muestra el consumo y lo que queda', () => {
    render(<ResumenDelPack datos={pack()} />);

    expect(screen.getByText('8 clases')).toBeInTheDocument();
    expect(screen.getByText('3 de 8')).toBeInTheDocument();
    expect(screen.getByText(/quedan 5/i)).toBeInTheDocument();
  });

  it('pasarse del pack se avisa, no se presenta como un error', () => {
    render(<ResumenDelPack datos={pack({ consumidas: 10, restantes: 0 })} />);

    // Decision D3 de la Fase 1, que el backend mantiene: el pack avisa, no
    // bloquea. Un alumno con 10 de 8 tiene un estado real y legitimo, y la
    // pantalla no puede tratarlo como una falla.
    expect(screen.getByText('10 de 8')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sin pack lo dice, en vez de mostrar ceros', () => {
    render(<ResumenDelPack datos={pack({ pack: null, tope: null, restantes: null })} />);

    // "0 de 0" sugeriria que se gastaron todas las clases. No es lo mismo no
    // tener pack que haberlo agotado.
    expect(screen.getByText(/todavia no tenes un pack/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 de 0/)).toBeNull();
  });

  it('un pago pendiente se ve', () => {
    render(<ResumenDelPack datos={pack({ pagoAlDia: false })} />);

    expect(screen.getByText(/pendiente/i)).toBeInTheDocument();
  });

  it('muestra el periodo sobre el que se cuenta', () => {
    render(<ResumenDelPack datos={pack()} />);

    // Sin el periodo, "3 de 8" no se puede interpretar: el alumno no sabe si
    // son de este mes o de todo el año.
    expect(screen.getByText(/2099-10-01/)).toBeInTheDocument();
    expect(screen.getByText(/2099-10-31/)).toBeInTheDocument();
  });

  it('sin ventana acotada, no muestra un periodo inventado', () => {
    render(<ResumenDelPack datos={pack({ ventanaDesde: null, ventanaHasta: null })} />);

    expect(screen.queryByText(/periodo/i)).toBeNull();
  });

  it('las cancelaciones se muestran cuando el pack las limita', () => {
    render(<ResumenDelPack datos={pack()} />);

    expect(screen.getByText(/1\s*de 2/)).toBeInTheDocument();
  });

  it('sin limite de cancelaciones, no se inventa uno', () => {
    render(<ResumenDelPack datos={pack({ cancelacionesPermitidas: null })} />);

    expect(screen.queryByText(/de null/i)).toBeNull();
    expect(screen.getByText(/cancelaciones usadas/i)).toBeInTheDocument();
  });

  it('las clases extra se explican', () => {
    render(<ResumenDelPack datos={pack({ clasesExtra: 2, tope: 10, restantes: 7 })} />);

    expect(screen.getByText(/2 clases extra/i)).toBeInTheDocument();
  });

  it('un pack sin tope muestra infinito, no un cero', () => {
    render(<ResumenDelPack datos={pack({ tope: null, restantes: null })} />);

    expect(screen.getByText('3 de ∞')).toBeInTheDocument();
  });
});
