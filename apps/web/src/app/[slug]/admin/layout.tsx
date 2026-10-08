import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { rolAlcanza } from '@boxadmin/shared';
import { rutaPedida } from '@/lib/ruta-pedida';
import { leerRol, leerSesion, sesionValidaPara } from '@/lib/sesion';
import { Armazon } from './armazon';
import { SinPermiso } from './sin-permiso';

// El layout raiz dice "Tus clases, en tu bolsillo", que es del alumno.
export const metadata: Metadata = { title: 'Panel · BoxAdmin' };

/**
 * La puerta del panel.
 *
 * Corre en el SERVIDOR y lee las cookies httpOnly, asi que no se puede saltar
 * desde el navegador. Rechaza en tres casos, y el tercero NO de la misma
 * manera que los otros dos: ver `SinPermiso`.
 */
export default async function LayoutDeAdmin({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sesion = await leerSesion();
  /**
   * La pagina donde estaba, no la entrada del panel.
   *
   * Cableado a `/${slug}/admin`, este `volverA` NO CONSERVABA NADA: para un
   * admin `destinoPorRol` devuelve esa misma URL, asi que el parametro no
   * cambiaba el aterrizaje de nadie y a quien se le vencia la sesion en
   * `/admin/usuarios` lo dejaba igualmente en la portada del panel. Parecia
   * que funcionaba, que es peor que no estar.
   *
   * La cabecera la pone el middleware y `rutaPedida` la valida antes de
   * devolverla: puede venir del cliente.
   */
  const alLogin = `/${slug}/login?volverA=${encodeURIComponent(await rutaPedida(slug, `/${slug}/admin`))}`;

  if (!sesionValidaPara(sesion, slug)) redirect(alLogin);

  // `sesionValidaPara` ya garantizo que `access` existe.
  const yo = await leerRol(sesion.access as string);

  // Null es token invalido o caducado: eso SI se arregla volviendo a entrar.
  if (yo === null) redirect(alLogin);

  if (!rolAlcanza(yo.rol, 'ADMIN_OPERATIVO')) return <SinPermiso rol={yo.rol} slug={slug} />;

  return (
    <Armazon slug={slug} rol={yo.rol} nombre={yo.nombreCompleto}>
      {children}
    </Armazon>
  );
}
