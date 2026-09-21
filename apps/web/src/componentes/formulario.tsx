import type { InputHTMLAttributes } from 'react';

interface PropsDeCampo extends InputHTMLAttributes<HTMLInputElement> {
  etiqueta: string;
  error?: string | undefined;
}

export function Campo({ etiqueta, error, id, ...resto }: PropsDeCampo) {
  const idCampo = id ?? etiqueta.toLowerCase().replace(/\s+/g, '-');
  const idError = `${idCampo}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idCampo} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <input
        id={idCampo}
        // `aria-describedby` y `aria-invalid` son lo que hace que un lector de
        // pantalla lea el error junto al campo, en vez de dejarlo suelto.
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : idError}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
        {...resto}
      />
      {error !== undefined && (
        <p id={idError} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
