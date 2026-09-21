'use client';

import { useRef } from 'react';
import { Aviso, Boton } from '@/componentes/ui';
import { useSubirComprobante } from '@/hooks/use-comprobantes';

export function SubirComprobante() {
  const entrada = useRef<HTMLInputElement>(null);
  const subir = useSubirComprobante();

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={entrada}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        aria-label="Comprobante de pago"
        className="text-sm"
        onChange={(evento) => {
          const archivo = evento.target.files?.[0];
          if (archivo !== undefined) subir.mutate(archivo);
        }}
      />

      {subir.isError && <Aviso tono="error">{subir.error.message}</Aviso>}
      {subir.isSuccess && (
        <Aviso tono="exito">Comprobante subido. Queda pendiente de revision.</Aviso>
      )}
      {subir.isPending && <p className="text-xs text-slate-500">Subiendo…</p>}
    </div>
  );
}
