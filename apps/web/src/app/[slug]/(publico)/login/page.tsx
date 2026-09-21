import Link from 'next/link';
import { FormularioDeLogin } from './formulario-de-login';

export default async function PaginaDeLogin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Entrar</h1>
      <FormularioDeLogin slug={slug} />
      <p className="text-sm text-slate-500">
        ¿No tenes cuenta?{' '}
        <Link href={`/${slug}/registro`} className="font-medium text-slate-900 underline">
          Crear una con tu clave de invitacion
        </Link>
      </p>
    </main>
  );
}
