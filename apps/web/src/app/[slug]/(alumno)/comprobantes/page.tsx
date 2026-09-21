'use client';

import type { EstadoComprobante } from '@boxadmin/shared';
import { Aviso, Tarjeta } from '@/componentes/ui';
import { useComprobantes } from '@/hooks/use-comprobantes';
import { SubirComprobante } from './subir-comprobante';

const TEXTO_DE_ESTADO: Record<EstadoComprobante, string> = {
  PENDIENTE: 'Pendiente de revision',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};

export default function PaginaDeComprobantes() {
  const { data, isPending, isError, error } = useComprobantes();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-slate-900">Tus pagos</h1>

      <SubirComprobante />

      {isPending && <p className="text-sm text-slate-500">Cargando…</p>}
      {isError && (
        <Aviso tono="error">
          {error instanceof Error ? error.message : 'No se pudieron cargar tus comprobantes'}
        </Aviso>
      )}

      {data?.length === 0 && <p className="text-sm text-slate-500">Todavia no subiste ninguno.</p>}

      {(data ?? []).map((comprobante) => (
        <Tarjeta key={comprobante.id}>
          <p className="font-medium text-slate-900">{comprobante.nombreOriginal}</p>
          <p className="text-xs text-slate-500">
            {TEXTO_DE_ESTADO[comprobante.estado]}
            {comprobante.subidoEn === null && ' · sin terminar de subir'}
          </p>
          {comprobante.nota !== null && (
            <p className="mt-1 text-xs text-slate-700">Nota del salon: {comprobante.nota}</p>
          )}
        </Tarjeta>
      ))}
    </div>
  );
}
