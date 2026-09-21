import { VistaDeSemana } from './vista-de-semana';

export default function PaginaDeCalendario() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu semana</h1>
      <VistaDeSemana />
    </div>
  );
}
