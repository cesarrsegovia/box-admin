import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Aviso, Boton } from './ui';

describe('Boton', () => {
  it('se desactiva y explica por que', () => {
    render(
      <Boton disabled title="Ya paso el plazo para anotarse">
        Reservar
      </Boton>,
    );

    const boton = screen.getByRole('button', { name: 'Reservar' });
    expect(boton).toBeDisabled();
    // Un boton apagado sin explicacion es el defecto que esta fase viene a
    // evitar: el `motivo` de la API existe justamente para poder decirlo.
    expect(boton).toHaveAttribute('title', 'Ya paso el plazo para anotarse');
  });

  it('muestra un estado de cargando accesible', () => {
    render(<Boton cargando>Reservar</Boton>);

    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button')).toBeDisabled();
  });
});

describe('Aviso', () => {
  it('un error se anuncia a los lectores de pantalla', () => {
    render(<Aviso tono="error">No hay conexion</Aviso>);

    expect(screen.getByRole('alert')).toHaveTextContent('No hay conexion');
  });

  it('un aviso informativo no interrumpe', () => {
    render(<Aviso tono="info">Datos de hace 3 minutos</Aviso>);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Datos de hace 3 minutos')).toBeInTheDocument();
  });

  it('un aviso que sustituye a un control SI se anuncia, aunque no sea un error', () => {
    // El caso: se pulsa un boton, el boton desaparece y en su sitio queda una
    // explicacion. Sin esto, quien usa lector de pantalla pierde el foco y no
    // oye nada.
    render(
      <Aviso tono="info" alerta>
        Bloqueaste las notificaciones
      </Aviso>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Bloqueaste las notificaciones');
  });
});
