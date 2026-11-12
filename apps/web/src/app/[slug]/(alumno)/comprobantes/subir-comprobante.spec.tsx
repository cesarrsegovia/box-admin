import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import { SubirComprobante } from './subir-comprobante';

/**
 * SE DOBLA EL HOOK Y NO `pedir`.
 *
 * Lo que se prueba es que pinta el componente con una subida fallida, no como
 * se sube un archivo: eso ya lo cubre el hook. Doblando `pedir` habria que
 * fingir tambien el `PUT` firmado al almacen, que va por `fetch` y no por
 * `pedir`, para llegar al mismo cartel.
 */
const { subirDoble } = vi.hoisted(() => ({
  subirDoble: { current: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/use-comprobantes', () => ({
  useSubirComprobante: () => subirDoble.current,
}));

/** Una subida que ya fallo con ese error, y nada mas en vuelo. */
function conFallo(error: ErrorDeApi): void {
  subirDoble.current = {
    mutate: vi.fn(),
    isError: true,
    isSuccess: false,
    isPending: false,
    error,
  };
}

describe('SubirComprobante', () => {
  it('un 401 dice que la sesion caduco, no «Unauthorized»', () => {
    conFallo(new ErrorDeApi('Unauthorized', 401));
    render(<SubirComprobante />);

    // `getByText` con una cadena compara el texto ENTERO del nodo.
    expect(screen.getByText(TEXTO_DE_SESION_CADUCADA)).toBeInTheDocument();
    expect(screen.queryByText(/unauthorized/i)).toBeNull();
  });

  /** Y el resto, tal cual: el tipo de archivo rechazado se explica solo. */
  it('otro fallo se lee como lo dijo quien fallo', () => {
    conFallo(new ErrorDeApi('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).', 0));
    render(<SubirComprobante />);

    expect(
      screen.getByText('Solo se aceptan PDF o imagenes (JPEG, PNG o WebP).'),
    ).toBeInTheDocument();
  });
});
