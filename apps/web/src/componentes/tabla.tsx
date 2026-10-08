import Link from 'next/link';
import type { ReactNode } from 'react';

export interface ColumnaDeTabla<T> {
  /** Lo que va en el `<th>`. Es tambien la etiqueta de la celda en telefono. */
  encabezado: string;
  celda: (fila: T) => ReactNode;
}

/**
 * Tabla densa en escritorio, tarjetas en telefono.
 *
 * Es UN SOLO arbol de DOM que cambia de forma con CSS (`display`), no dos
 * marcados con un `hidden md:block` cada uno. Duplicar el marcado duplicaria
 * tambien los enlaces: cada persona tendria DOS `<a>` al mismo sitio, uno
 * invisible, y eso lo paga quien navega con teclado o con lector de pantalla,
 * que los recorre todos. Ademas haria falta mantener dos sitios donde pinta una
 * fila, y el segundo siempre se queda atras.
 *
 * El `<thead>` existe en los dos tamaños: en telefono esta oculto y cada celda
 * se pone su propio encabezado delante con un pseudoelemento que lee
 * `data-etiqueta`. Asi el texto del encabezado esta UNA vez en el DOM y no dos.
 */
export function Tabla<T>({
  columnas,
  filas,
  claveDeFila,
  enlaceDeFila,
  vacio,
}: {
  columnas: readonly ColumnaDeTabla<T>[];
  filas: readonly T[];
  claveDeFila: (fila: T) => string;
  /** Si se da, la fila entera lleva a ese destino. */
  enlaceDeFila?: (fila: T) => string;
  /**
   * Que pintar cuando no hay ni una fila.
   *
   * Es OBLIGATORIO y lo resuelve la tabla, no cada pantalla: una cabecera con
   * nada debajo se ve igual que una averia, y "se me olvido el caso vacio" es
   * precisamente lo que no puede quedar a criterio del llamador.
   */
  vacio: ReactNode;
}) {
  if (filas.length === 0) return <>{vacio}</>;

  return (
    <table className="w-full border-collapse text-sm">
      <thead className="hidden md:table-header-group">
        <tr className="border-b border-slate-200 text-left">
          {columnas.map((columna) => (
            <th
              key={columna.encabezado}
              scope="col"
              className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500"
            >
              {columna.encabezado}
            </th>
          ))}
        </tr>
      </thead>

      <tbody className="block md:table-row-group">
        {filas.map((fila) => (
          <tr
            key={claveDeFila(fila)}
            // `relative` para que el enlace estirado de la primera celda cubra
            // la fila entera y se pueda pinchar en cualquier punto.
            className={
              'relative mb-3 block rounded-xl border border-slate-200 bg-white p-2 shadow-sm ' +
              'md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0 md:shadow-none ' +
              'md:hover:bg-slate-50'
            }
          >
            {columnas.map((columna, indice) => {
              const contenido = columna.celda(fila);

              return (
                <td
                  key={columna.encabezado}
                  data-etiqueta={columna.encabezado}
                  className={
                    'flex justify-between gap-4 px-1 py-1 text-slate-700 ' +
                    'before:text-xs before:font-semibold before:uppercase before:tracking-wide before:text-slate-400 before:content-[attr(data-etiqueta)] ' +
                    'md:table-cell md:px-3 md:py-2 md:before:content-none'
                  }
                >
                  {indice === 0 && enlaceDeFila !== undefined ? (
                    <Link
                      href={enlaceDeFila(fila)}
                      className="font-medium text-slate-900 underline-offset-2 after:absolute after:inset-0 hover:underline"
                    >
                      {contenido}
                    </Link>
                  ) : (
                    contenido
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
