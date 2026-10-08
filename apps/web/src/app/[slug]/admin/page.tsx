import Link from 'next/link';

export default async function InicioDelPanel({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Panel</h1>
      <p className="text-slate-600">
        Desde aca se administran las personas del gimnasio y las claves de invitacion.
      </p>
      <Link href={`/${slug}/admin/usuarios`} className="w-fit font-medium text-slate-900 underline">
        Ver las personas
      </Link>
    </section>
  );
}
