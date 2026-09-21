'use client';

import { Aviso } from '@/componentes/ui';
import { useMiPack } from '@/hooks/use-calendario';
import { ResumenDelPack } from './resumen-del-pack';

export default function PaginaDeMiPack() {
  const { data, isPending, isError, error } = useMiPack();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tu pack</h1>

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {isError && (
        <Aviso tono="error">
          {error instanceof Error ? error.message : 'No se pudo cargar tu pack'}
        </Aviso>
      )}
      {data !== undefined && <ResumenDelPack datos={data} />}
    </div>
  );
}
