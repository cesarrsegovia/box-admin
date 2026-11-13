import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorDeApi } from '@/lib/cliente';
import { TEXTO_DE_SESION_CADUCADA } from '@/lib/sesion-caducada';
import PaginaDeMiPack from './page';

/**
 * SE DOBLA EL HOOK Y NO `pedir`.
 *
 * Lo que se prueba es lo que la pagina pinta con una lectura fallida, no como
 * se lee el pack: eso ya lo cubre el hook.
 */
const { lectura } = vi.hoisted(() => ({
  lectura: { current: {} as Record<string, unknown> },
}));

vi.mock('@/hooks/use-calendario', () => ({
  useMiPack: () => lectura.current,
}));

/** Una lectura que ya fallo con ese error. */
function conFallo(error: ErrorDeApi): void {
  lectura.current = { data: undefined, isPending: false, isError: true, error };
}

describe('PaginaDeMiPack', () => {
  it('un 401 al leer el pack dice que la sesion caduco, no «Unauthorized»', () => {
    conFallo(new ErrorDeApi('Unauthorized', 401));
    render(<PaginaDeMiPack />);

    expect(screen.getByRole('alert').textContent).toBe(TEXTO_DE_SESION_CADUCADA);
    expect(document.body.textContent).not.toContain('Unauthorized');
  });

  it('otro fallo se lee tal cual', () => {
    conFallo(new ErrorDeApi('Se cayo la base', 500));
    render(<PaginaDeMiPack />);

    expect(screen.getByRole('alert').textContent).toBe('Se cayo la base');
  });
});
