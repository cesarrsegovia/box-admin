import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Confirmar } from './confirmar';

function montar(cambios: Partial<Parameters<typeof Confirmar>[0]> = {}) {
  const alConfirmar = vi.fn();
  const alCancelar = vi.fn();

  render(
    <Confirmar
      pregunta="Dar de baja a Ana Perez"
      textoDeConfirmar="Dar de baja"
      alConfirmar={alConfirmar}
      alCancelar={alCancelar}
      {...cambios}
    />,
  );

  return { alConfirmar, alCancelar };
}

async function pulsar(nombre: RegExp): Promise<void> {
  const usuario = userEvent.setup();
  await usuario.click(screen.getByRole('button', { name: nombre }));
}

describe('el dialogo de confirmar', () => {
  it('es un dialogo de verdad, no un div con botones', () => {
    montar();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /**
   * LA PREGUNTA ES LA PROP, Y ES OBLIGATORIA.
   *
   * No hay un texto por defecto: un componente que supiera decir "¿estas
   * seguro?" por su cuenta permitiria que una pantalla lo usara sin nombrar a
   * nadie y el error no se veria hasta que alguien diera de baja a quien no era.
   */
  it('dice lo que va a pasar, con el nombre dentro', () => {
    montar({ pregunta: 'Dar de baja a Beto Diaz' });

    expect(screen.getByText('Dar de baja a Beto Diaz')).toBeInTheDocument();
  });

  it('la pregunta es tambien el nombre accesible del dialogo', () => {
    // Quien usa lector de pantalla oye el nombre del dialogo al abrirse. Si el
    // nombre fuera "Confirmar", oiria "Confirmar" y nada mas.
    montar({ pregunta: 'Dar de baja a Beto Diaz' });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Dar de baja a Beto Diaz');
  });

  it('no hay ningun "estas seguro" generico escondido dentro', () => {
    montar();

    expect(document.body.textContent).not.toMatch(/segur/i);
  });

  it('confirmar llama a confirmar', async () => {
    const { alConfirmar, alCancelar } = montar();

    await pulsar(/dar de baja/i);

    expect(alConfirmar).toHaveBeenCalledTimes(1);
    expect(alCancelar).not.toHaveBeenCalled();
  });

  it('cancelar llama a cancelar y NO a confirmar', async () => {
    const { alConfirmar, alCancelar } = montar();

    await pulsar(/cancelar/i);

    expect(alCancelar).toHaveBeenCalledTimes(1);
    expect(alConfirmar).not.toHaveBeenCalled();
  });

  it('Escape cancela, que es lo que espera cualquiera', async () => {
    const { alConfirmar, alCancelar } = montar();

    await userEvent.setup().keyboard('{Escape}');

    expect(alCancelar).toHaveBeenCalledTimes(1);
    expect(alConfirmar).not.toHaveBeenCalled();
  });

  /**
   * El foco arranca en CANCELAR, no en la accion.
   *
   * Un dialogo destructivo cuyo boton peligroso tiene el foco se confirma con
   * un Enter de inercia: quien venia de pulsar "Dar de baja" con el teclado
   * todavia tiene el dedo encima.
   */
  it('el foco arranca en cancelar y no en la accion destructiva', () => {
    montar();

    expect(screen.getByRole('button', { name: /cancelar/i })).toHaveFocus();
  });

  it('mientras esta en curso no se puede confirmar dos veces', async () => {
    const { alConfirmar } = montar({ cargando: true });

    await pulsar(/dar de baja/i);

    expect(alConfirmar).not.toHaveBeenCalled();
  });

  it('el error de la accion se ve DENTRO del dialogo, que es donde esta mirando', () => {
    montar({ error: 'No tenes permiso para esto' });

    const dialogo = screen.getByRole('dialog');
    expect(dialogo).toHaveTextContent('No tenes permiso para esto');
  });

  it('sin error no hay hueco de error', () => {
    montar();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  /**
   * Los botones son `type="button"`.
   *
   * El dialogo se abre desde pantallas que son formularios. Un boton sin tipo
   * dentro de un `<form>` es `type="submit"`: cancelar enviaria el formulario
   * que hay detras, que es exactamente lo contrario de cancelar.
   */
  it('ningun boton del dialogo envia un formulario', () => {
    montar();

    for (const boton of screen.getAllByRole('button')) {
      expect(boton).toHaveAttribute('type', 'button');
    }
  });

  it('el detalle se muestra cuando lo hay', () => {
    montar({ detalle: 'Sus reservas futuras NO se cancelan.' });

    expect(screen.getByText(/sus reservas futuras/i)).toBeInTheDocument();
  });
});
