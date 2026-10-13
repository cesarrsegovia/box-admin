'use client';

import { Suspense, useEffect } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useTurno } from '@/hooks/use-turnos';
import { BloqueDeAnotados } from './bloque-anotados';
import { BloqueDeBorrar } from './bloque-borrar';
import { BloqueDeDatos } from './bloque-datos';
import { BloqueDeProfesora } from './bloque-profesora';

/**
 * La ficha de un turno: todo lo de un turno en un sitio.
 *
 * CADA BLOQUE ES SU PROPIO COMPONENTE CON SU PROPIA MUTACION, como en la ficha
 * de una persona. Son tres endpoints distintos (`PATCH /turnos/:id`,
 * `PATCH /turnos/:id/profesor` y `DELETE /turnos/:id`) con tres reglas y tres
 * formas de fallar: juntarlos en un formulario unico convertiria tres fallos en
 * un unico "algo salio mal", y obligaria a guardar lo que nadie toco para poder
 * guardar lo que si.
 *
 * La consulta vive aqui y los bloques reciben el turno ya cargado: si cada
 * bloque llamara a `useTurno`, TanStack lo deduplicaria igual, pero el estado de
 * carga y el 401 habria que resolverlos tres veces.
 */
function FichaDelTurno() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const ruta = usePathname();
  const consulta = useSearchParams().toString();
  const router = useRouter();

  const { data: turno, isPending, error, refetch } = useTurno(id);

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel mira la sesion en el servidor, pero eso pasa una vez
    // al entrar: el token puede caducar con la ficha abierta.
    //
    // CON EL QUERY PUESTO, al reves que la ficha de una persona. Aquella eligio
    // `SIN_QUERY` porque no tiene ninguno, y para no pagar la frontera de
    // Suspense que `useSearchParams` obliga a poner. Aqui se paga a proposito:
    // a esta ficha se llega desde un listado CON FILTROS, y la forma natural de
    // volver a el con los filtros puestos es que la URL de la ficha los lleve.
    // Si el dia que eso pase el `volverA` los tirara, la persona vuelve del
    // login a un listado vacio y parece que funciona, que es peor que no estar.
    router.push(destinoDeLoginDesde(ruta, consulta, slug));
  }, [sesionCaducada, router, ruta, consulta, slug]);

  if (isPending) return <p className="text-sm text-slate-500">Cargando…</p>;

  if (error !== null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <Aviso tono="error">{error.message}</Aviso>
        {/* Sin sesion, reintentar es volver a fallar. */}
        {!sesionCaducada && (
          <Boton tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-slate-900">{turno.nombre}</h1>
        <p className="text-sm text-slate-600">
          {turno.fecha} de {turno.horaInicio} a {turno.horaFin}
        </p>
        <p className="text-sm text-slate-600">
          {turno.reservasActivas} de {turno.cupo} lugares ocupados
        </p>
      </header>

      <BloqueDeDatos turno={turno} />
      <BloqueDeProfesora turno={turno} />

      {/* ANTES DE BORRAR a proposito: el bloque de borrar manda a cancelar las
          reservas, y el sitio al que manda tiene que estar a la vista y no
          debajo del cartel que lo nombra. Recibe el turno ya cargado, igual que
          los demas, y pide sus reservas por su cuenta: por eso la lista blanca
          de peticiones de `page.spec.tsx` tiene DOS entradas y no una. */}
      <BloqueDeAnotados turno={turno} />

      <BloqueDeBorrar turno={turno} slug={slug} />
    </section>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. Es el mismo arreglo que el calendario.
 */
export default function PaginaDeFichaDeTurno() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
      <FichaDelTurno />
    </Suspense>
  );
}
