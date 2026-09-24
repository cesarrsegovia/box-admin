import { BotonDePush } from '@/componentes/boton-de-push';
import { BotonDeSalir } from './boton-de-salir';

export default async function PaginaDePerfil({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu perfil</h1>
      <p className="text-sm text-slate-600">Gimnasio: {slug}</p>
      <BotonDePush />
      <BotonDeSalir slug={slug} />
    </div>
  );
}
