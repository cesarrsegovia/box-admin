'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SECCIONES = [
  { ruta: 'mis-clases', texto: 'Mis clases' },
  { ruta: 'mi-liquidacion', texto: 'Mi liquidación' },
] as const;

/**
 * Barra inferior fija, como la del alumno: el area se usa de pie y con una
 * mano.
 *
 * LA ACTIVA SE DECIDE POR PREFIJO Y NO POR IGUALDAD. El alumno compara con `===`
 * porque sus secciones no tienen subrutas; `mis-clases/[turnoId]` si, y dentro
 * de una clase la profesora sigue estando en «Mis clases». El prefijo lleva la
 * barra: `mis-clases-viejas` empieza igual y no es una subruta.
 */
export function NavegacionProfesora({ slug }: { slug: string }) {
  const rutaActual = usePathname();

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 mx-auto flex w-full max-w-md border-t border-slate-200 bg-white"
    >
      {SECCIONES.map((seccion) => {
        const href = `/${slug}/${seccion.ruta}`;
        const activa = rutaActual === href || rutaActual.startsWith(`${href}/`);

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
