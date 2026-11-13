import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import PaginaDeComprobantes from './page';

/**
 * SE DOBLAN LOS HOOKS Y NO `pedir`.
 *
 * Lo que se prueba es lo que la pagina pinta con una lectura fallida, no como
 * se leen los comprobantes: eso ya lo cubre el hook. La subida queda quieta,
 * sin fallo, asi que el unico aviso de error posible es el de la lectura.
 */
const { lectura } = vi.hoisted(() => ({
  lectura: { current: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/use-comprobantes', () => ({
  useComprobantes: () => lectura.current,
  useSubirComprobante: () => ({
    mutate: vi.fn(),
    isError: false,
    isSuccess: false,
    isPending: false,
    error: null,
  }),
}));

/** Una lectura que ya fallo con ese error. */
function conFallo(error: ErrorDeApi): void {
  lectura.current = { data: undefined, isPending: false, isError: true, error };
}

describe('PaginaDeComprobantes', () => {
  it('un 401 al leer los comprobantes dice que la sesion caduco, no «Unauthorized»', () => {
    conFallo(new ErrorDeApi('Unauthorized', 401));
    render(<PaginaDeComprobantes />);

    expect(screen.getByRole('alert').textContent).toBe(TEXTO_DE_SESION_CADUCADA);
    expect(document.body.textContent).not.toContain('Unauthorized');
  });

  it('otro fallo se lee tal cual', () => {
    conFallo(new ErrorDeApi('Se cayo la base', 500));
    render(<PaginaDeComprobantes />);

    expect(screen.getByRole('alert').textContent).toBe('Se cayo la base');
  });
});
