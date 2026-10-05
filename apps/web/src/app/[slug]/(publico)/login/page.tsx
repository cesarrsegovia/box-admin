import Link from 'next/link';
import { FormularioDeLogin } from './formulario-de-login';

export default async function PaginaDeLogin({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ volverA?: string | string[] }>;
}) {
  const { slug } = await params;
  // A donde iba el alumno antes de que lo mandaran aqui (lo pone la pantalla
  // de check-in). Se pasa crudo: quien decide si es un destino aceptable es
  // `rutaDeRetornoSegura`, dentro del formulario.
  const { volverA } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Entrar</h1>
      {/* `?volverA=a&volverA=b` llega como array: dos destinos no son un
          destino, y el formulario cae a su valor por defecto. */}
      <FormularioDeLogin slug={slug} volverA={typeof volverA === 'string' ? volverA : undefined} />
      <p className="text-sm text-slate-500">
        ¿No tenes cuenta?{' '}
        <Link href={`/${slug}/registro`} className="font-medium text-slate-900 underline">
          Crear una con tu clave de invitacion
        </Link>
      </p>
    </main>
  );
}
