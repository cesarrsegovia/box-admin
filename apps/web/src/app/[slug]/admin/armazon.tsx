'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { RolUsuario } from '@boxadmin/shared';
import { enlacesPara } from './navegacion-admin';
import { ProveedorDeRol } from './rol-del-panel';

/**
 * Barra lateral en escritorio, tira horizontal en telefono.
 *
 * Al reves que la PWA del alumno, que es una barra inferior pensada para usarse
 * de pie y con una mano. Son dos usos distintos: el admin trabaja en un
 * mostrador y sus pantallas son densas.
 *
 * Recibe CUATRO props y ninguna mas. El objeto de `/auth/me` entero no cruza
 * esta frontera: esto es cliente, y lo que cruza se serializa en el payload RSC
 * que viaja al navegador, legible con "ver codigo fuente" aunque nadie lo
 * dibuje. Hay un test en `layout.spec.tsx` que fija ese conjunto exacto.
 */
export function Armazon({
  slug,
  rol,
  nombre,
  children,
}: {
  slug: string;
  rol: RolUsuario;
  nombre: string;
  children: React.ReactNode;
}) {
  const rutaActual = usePathname();
  const enlaces = enlacesPara(rol);

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 border-b border-slate-200 bg-white p-3 md:w-56 md:border-b-0 md:border-r">
        <p className="px-2 pb-2 text-sm font-medium text-slate-900">{nombre}</p>

        <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {enlaces.map((enlace) => {
            const href = enlace.ruta === '' ? `/${slug}/admin` : `/${slug}/admin/${enlace.ruta}`;
            const activa = rutaActual === href;

            return (
              <Link
                key={enlace.ruta}
                href={href}
                aria-current={activa ? 'page' : undefined}
                className={
                  'whitespace-nowrap rounded px-3 py-2 text-sm font-medium ' +
                  (activa ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                {enlace.texto}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* El rol se reparte a las pantallas por contexto y no por props: un
          layout no le puede pasar props a sus `children`, pero si envolverlos.
          Asi la ficha sabe si dibujar el reset sin volver a pedir `/auth/me`,
          que es la segunda llamada por pantalla que esto evita. */}
      <main className="flex-1 bg-slate-50 p-4 md:p-6">
        <ProveedorDeRol rol={rol}>{children}</ProveedorDeRol>
      </main>
    </div>
  );
}
