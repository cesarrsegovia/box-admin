import Link from 'next/link';
import { FormularioDeRegistro } from './formulario-de-registro';

export default async function PaginaDeRegistro({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold text-slate-900">Crear tu cuenta</h1>
      <FormularioDeRegistro slug={slug} />
      <p className="text-sm text-slate-500">
        ¿Ya tenes cuenta?{' '}
        <Link href={`/${slug}/login`} className="font-medium text-slate-900 underline">
          Entrar
        </Link>
      </p>
    </main>
  );
}
