import Link from 'next/link';
import { redirect } from 'next/navigation';
import { rolAlcanza } from '@boxadmin/shared';
import { Navegacion } from '@/componentes/navegacion';
import { rutaPedida } from '@/lib/ruta-pedida';
import { leerRol, leerSesion, sesionValidaPara } from '@/lib/sesion';
import { BotonDeSalir } from './perfil/boton-de-salir';

/**
 * Puerta del area de alumno.
 *
 * Corre en el servidor y lee las cookies httpOnly, asi que la comprobacion no
 * se puede saltar desde el navegador. La segunda parte —que el slug de la URL
 * coincida con el de la sesion— es la que impide ver los datos de un gimnasio
 * bajo la URL de otro: el JWT lleva su propio tenantId y la API responderia
 * tan tranquila con los datos del gimnasio del token.
 *
 * La tercera —el rol— es la que cierra que un admin con sesion valida se
 * pasee por el area del alumno.
 */
export default async function LayoutDeAlumno({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sesion = await leerSesion();

  /**
   * El destino que se conserva es LA PAGINA DONDE ESTABA, no la entrada del
   * area: al alumno al que se le vence la sesion mirando `/mi-pack` el login
   * lo devuelve a `/mi-pack`.
   *
   * La ruta la trae `rutaPedida` de una cabecera que pone el middleware,
   * porque un layout del App Router no la recibe. Y la trae YA VALIDADA: esa
   * cabecera puede venir del cliente, asi que pasa por el mismo filtro que el
   * `volverA` del query. Si falta, el respaldo es el calendario.
   */
  const volverA = await rutaPedida(slug, `/${slug}/calendario`);
  const alLogin = `/${slug}/login?volverA=${encodeURIComponent(volverA)}`;

  if (!sesionValidaPara(sesion, slug)) {
    redirect(alLogin);
  }

  // `sesionValidaPara` ya garantizo que `access` existe.
  const yo = await leerRol(sesion.access as string);

  // Null es token invalido o caducado: eso SI se arregla volviendo a entrar.
  if (yo === null) redirect(alLogin);

  /**
   * El area del alumno es del alumno, y aqui la jerarquia NO vale: con
   * `rolAlcanza(rol, 'ALUMNO')` entraria todo el mundo, que es justo el
   * agujero que esto viene a tapar. Un admin no es "un alumno con mas
   * permisos", es otra persona.
   *
   * A quien no es alumno no se lo manda al login: volver a autenticarse no
   * cambia el rol, asi que seria un bucle. Se le muestra una pantalla, igual
   * que hace la puerta del panel y por el mismo motivo.
   */
  if (yo.rol !== 'ALUMNO') {
    // Solo se ofrece el panel a quien el panel va a dejar pasar. Al profesor
    // —que no llega a ADMIN_OPERATIVO y todavia no tiene pantalla propia— se
    // le ofrece lo unico que de verdad lo saca de aqui: cerrar sesion.
    const tienePanel = rolAlcanza(yo.rol, 'ADMIN_OPERATIVO');

    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">Esta no es tu area</h1>
        <p className="text-slate-600">Tu cuenta no es de alumno, asi que aca no hay nada tuyo.</p>
        {tienePanel ? (
          <Link href={`/${slug}/admin`} className="font-medium text-slate-900 underline">
            Ir al panel
          </Link>
        ) : (
          <BotonDeSalir slug={slug} />
        )}
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col bg-slate-50">
      <main className="flex-1 p-4 pb-24">{children}</main>
      <Navegacion slug={slug} />
    </div>
  );
}
