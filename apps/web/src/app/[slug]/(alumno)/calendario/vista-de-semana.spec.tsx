import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import { VistaDeSemana } from './vista-de-semana';

/**
 * SE DOBLAN LOS HOOKS Y NO `pedir`.
 *
 * Lo que se prueba es que pinta la semana con una accion fallida, no como se
 * reserva: eso ya lo cubre el hook. Las dos lecturas contestan una semana SIN
 * TURNOS, que es la forma mas pobre que la pantalla sabe dibujar; asi el unico
 * aviso de error posible es el de la accion.
 */
const { fallo } = vi.hoisted(() => ({ fallo: { current: null as Error | null } }));

const LECTURA_VACIA = {
  data: [],
  dataUpdatedAt: 0,
  isPending: false,
  isError: false,
  error: null,
};

function mutacion(error: Error | null) {
  return { mutate: vi.fn(), isPending: false, isError: error !== null, error };
}

vi.mock('@/hooks/use-calendario', () => ({
  useTurnosDisponibles: () => LECTURA_VACIA,
  useMisClases: () => LECTURA_VACIA,
}));

vi.mock('@/hooks/use-acciones-de-turno', () => ({
  useAccionesDeTurno: () => ({
    reservar: mutacion(fallo.current),
    cancelar: mutacion(null),
    anotarme: mutacion(null),
    salirme: mutacion(null),
  }),
}));

describe('VistaDeSemana', () => {
  it('un 401 en una accion dice que la sesion caduco, no «Unauthorized»', () => {
    fallo.current = new ErrorDeApi('Unauthorized', 401);
    render(<VistaDeSemana />);

    // `getByText` con una cadena compara el texto ENTERO del nodo.
    expect(screen.getByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
    expect(screen.queryByText(/unauthorized/i)).toBeNull();
  });

  it('otro fallo se lee tal cual', () => {
    fallo.current = new ErrorDeApi('El turno esta lleno', 409);
    render(<VistaDeSemana />);

    expect(screen.getByText('El turno esta lleno')).toBeInTheDocument();
  });
});
