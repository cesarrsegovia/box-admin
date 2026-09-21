import type { MiPackPublico } from '@boxadmin/shared';
import { Aviso, Tarjeta } from '@/componentes/ui';

export function ResumenDelPack({ datos }: { datos: MiPackPublico }) {
  if (datos.pack === null) {
    return (
      <Tarjeta>
        {/* "0 de 0" sugeriria que se gastaron todas las clases. No es lo mismo
            no tener pack que haberlo agotado. */}
        <p className="text-sm text-slate-700">
          Todavia no tenes un pack asignado. Hablalo con tu gimnasio.
        </p>
      </Tarjeta>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Tarjeta>
        <h2 className="text-lg font-semibold text-slate-900">{datos.pack.nombre}</h2>

        <p className="mt-2 text-sm text-slate-700">
          Llevas{' '}
          <strong>
            {datos.consumidas} de {datos.tope ?? '∞'}
          </strong>{' '}
          clases
          {datos.restantes !== null && <> · quedan {datos.restantes}</>}
        </p>

        {/* Sin el periodo, "3 de 8" no se puede interpretar: podrian ser de
            este mes o de todo el año. */}
        {datos.ventanaDesde !== null && datos.ventanaHasta !== null && (
          <p className="mt-1 text-xs text-slate-500">
            Periodo: {datos.ventanaDesde} a {datos.ventanaHasta}
          </p>
        )}

        {datos.clasesExtra > 0 && (
          <p className="mt-1 text-xs text-slate-500">
            Incluye {datos.clasesExtra} clases extra que te dio el salon
          </p>
        )}
      </Tarjeta>

      <Tarjeta>
        <p className="text-sm text-slate-700">
          Cancelaciones usadas:{' '}
          <strong>
            {datos.cancelacionesUsadas}
            {datos.cancelacionesPermitidas !== null && <> de {datos.cancelacionesPermitidas}</>}
          </strong>
        </p>
      </Tarjeta>

      {/* Tono info y no error: un pago pendiente es un recordatorio, no un
          fallo del que haya que alarmar con role="alert". */}
      <Aviso tono={datos.pagoAlDia ? 'exito' : 'info'}>
        {datos.pagoAlDia ? 'Tu pago esta al dia' : 'Tenes un pago pendiente'}
      </Aviso>
    </div>
  );
}
