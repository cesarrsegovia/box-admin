import Link from 'next/link';
import type { RolUsuario } from '@boxadmin/shared';

const NOMBRE_DEL_ROL: Record<RolUsuario, string> = {
  SUPERADMIN: 'superadministrador',
  ADMIN_SALON: 'administrador del salon',
  ADMIN_OPERATIVO: 'administrador operativo',
  PROFESOR: 'profesor',
  ALUMNO: 'alumno',
  FANTASMA: 'sin acceso',
};

/**
 * El 403 del panel.
 *
 * NO es un redirect al login, y eso es lo unico importante de este archivo:
 * mandar aqui al login seria un bucle sin salida, porque volver a autenticarse
 * no cambia el rol. Se dice que rol hace falta, que es lo que convierte un
 * reclamo en una conversacion con el dueño.
 */
export function SinPermiso({ rol, slug }: { rol: RolUsuario; slug: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">No tenes permiso para entrar aca</h1>
      <p className="text-slate-600">
        El panel pide ser <strong>administrador operativo</strong> como minimo, y tu cuenta es de{' '}
        <strong>{NOMBRE_DEL_ROL[rol]}</strong>. Si creés que es un error, hablalo con quien
        administra el gimnasio.
      </p>
      <Link href={`/${slug}/calendario`} className="font-medium text-slate-900 underline">
        Ir a tu calendario
      </Link>
    </main>
  );
}
