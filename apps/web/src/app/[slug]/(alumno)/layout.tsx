import { redirect } from 'next/navigation';
import { Navegacion } from '@/componentes/navegacion';
import { leerSesion, sesionValidaPara } from '@/lib/sesion';

/**
 * Puerta del area de alumno.
 *
 * Corre en el servidor y lee las cookies httpOnly, asi que la comprobacion no
 * se puede saltar desde el navegador. La segunda parte —que el slug de la URL
 * coincida con el de la sesion— es la que impide ver los datos de un gimnasio
 * bajo la URL de otro: el JWT lleva su propio tenantId y la API responderia
 * tan tranquila con los datos del gimnasio del token.
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

  if (!sesionValidaPara(sesion, slug)) {
    redirect(`/${slug}/login`);
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col bg-slate-50">
      <main className="flex-1 p-4 pb-24">{children}</main>
      <Navegacion slug={slug} />
    </div>
  );
}
