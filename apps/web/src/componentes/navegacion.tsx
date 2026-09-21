'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECCIONES = [
  { ruta: 'calendario', texto: 'Calendario' },
  { ruta: 'mi-pack', texto: 'Mi pack' },
  { ruta: 'comprobantes', texto: 'Pagos' },
  { ruta: 'perfil', texto: 'Perfil' },
] as const;

/**
 * Barra inferior fija, no lateral: esta aplicacion se usa desde el telefono,
 * de pie y con una mano.
 */
export function Navegacion({ slug }: { slug: string }) {
  const rutaActual = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-2xl border-t border-slate-200 bg-white">
      {SECCIONES.map((seccion) => {
        const href = `/${slug}/${seccion.ruta}`;
        const activa = rutaActual === href;

        return (
          <Link
            key={seccion.ruta}
            href={href}
            aria-current={activa ? 'page' : undefined}
            className={
              `flex-1 py-3 text-center text-xs font-medium ` +
              (activa ? 'text-slate-900' : 'text-slate-400')
            }
          >
            {seccion.texto}
          </Link>
        );
      })}
    </nav>
  );
}
