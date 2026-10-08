import type { SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * Los dos controles que `componentes/formulario.tsx` todavia no tiene.
 *
 * `Campo` cubre `<input>`, que es lo unico que necesitaba el login. La ficha
 * necesita ademas un `<select>` (pack, sala, dia de la semana) y un
 * `<textarea>` (la ficha medica, que admite 2000 caracteres y en una linea no se
 * lee). Viven aqui y no en el componente compartido a proposito: el dia que una
 * segunda pantalla los pida, se suben, y entonces se sube UNA version probada y
 * no la primera que alguien escribio.
 *
 * El cableado de accesibilidad es el MISMO que el de `Campo` —`aria-invalid` y
 * `aria-describedby` apuntando al parrafo del error— porque es lo que hace que
 * un lector de pantalla lea el error junto al control y no suelto al final.
 */

function idDe(etiqueta: string, id?: string): string {
  return id ?? etiqueta.toLowerCase().replace(/\s+/g, '-');
}

interface PropsDeSeleccion extends SelectHTMLAttributes<HTMLSelectElement> {
  etiqueta: string;
  error?: string | undefined;
  opciones: readonly { valor: string; texto: string }[];
}

export function Seleccion({ etiqueta, error, id, opciones, ...resto }: PropsDeSeleccion) {
  const idControl = idDe(etiqueta, id);
  const idError = `${idControl}-error`;

  return (
    <div className="flex flex-col gap-1">
      {/* `htmlFor` y no una etiqueta que envuelva al select: envolviendolo, el
          nombre accesible se lleva por delante el texto de las opciones. */}
      <label htmlFor={idControl} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <select
        id={idControl}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : idError}
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        {...resto}
      >
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.texto}
          </option>
        ))}
      </select>
      {error !== undefined && (
        <p id={idError} className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

interface PropsDeAreaDeTexto extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  etiqueta: string;
  error?: string | undefined;
}

export function AreaDeTexto({ etiqueta, error, id, ...resto }: PropsDeAreaDeTexto) {
  const idControl = idDe(etiqueta, id);
  const idError = `${idControl}-error`;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={idControl} className="text-sm font-medium text-slate-700">
        {etiqueta}
      </label>
      <textarea
        id={idControl}
        rows={4}
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
