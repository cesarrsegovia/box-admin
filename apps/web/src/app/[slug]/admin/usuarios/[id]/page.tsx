'use client';

import { useEffect } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { SIN_QUERY, destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useUsuario } from '@/hooks/use-usuarios';
import { useRolDeQuienMira } from '../../rol-del-panel';
import { BloqueDeAcciones } from './bloque-acciones';
import { BloqueDeDatos } from './bloque-datos';
import { BloqueDeDiasFijos } from './bloque-dias-fijos';
import { BloqueDeEstadoDePago } from './bloque-estado-pago';
import { BloqueDePagos } from './bloque-pagos';
import { BloqueDeSalas } from './bloque-salas';
import { BloqueDeTurnosLibres } from './bloque-turnos-libres';
import { BloqueDeVacaciones } from './bloque-vacaciones';

/**
 * La ficha de una persona: todo lo de alguien en un sitio.
 *
 * CADA BLOQUE ES SU PROPIO COMPONENTE CON SU PROPIA MUTACION. Son cinco
 * endpoints de escritura mas los de rutinas; juntarlos en un formulario unico
 * convertiria nueve fallos distintos en un unico "algo salio mal", y obligaria a
 * guardar cosas que nadie toco para poder guardar la que si.
 *
 * La consulta vive aqui y los bloques reciben el usuario ya cargado: si cada
 * bloque llamara a `useUsuario`, TanStack lo deduplicaria igual, pero el estado
 * de carga y el 401 habria que resolverlos cinco veces.
 *
 * El rol de quien mira sale del CONTEXTO del panel, que lo puso el armazon con
 * el que la puerta ya habia resuelto. Ni se deduce del JWT en el navegador —un
 * dato que el cliente pudo tocar— ni se vuelve a pedir `/auth/me`.
 */
export default function PaginaDeFicha() {
  const { slug, id } = useParams<{ slug: string; id: string }>();
  const ruta = usePathname();
  const router = useRouter();
  const rolDeQuienMira = useRolDeQuienMira();

  const { data: usuario, isPending, error, refetch } = useUsuario(id);

  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel mira la sesion en el servidor, pero eso pasa una vez
    // al entrar: el token puede caducar con la ficha abierta.
    // El destino se arma en `lib/destino-de-login` y no aqui, para que la
    // forma del `volverA` viva en un solo sitio. `SIN_QUERY` es una decision
    // con nombre: esta pantalla no tiene query que conservar.
    router.push(destinoDeLoginDesde(ruta, SIN_QUERY, slug));
  }, [sesionCaducada, router, ruta, slug]);

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
        <h1 className="text-2xl font-semibold text-slate-900">{usuario.nombreCompleto}</h1>
        {/* El email NO es editable: `ActualizarUsuarioDto` no lo acepta. */}
        <p className="text-sm text-slate-600">{usuario.email}</p>
        {!usuario.activo && <p className="text-sm text-red-700">Ya esta dado de baja.</p>}
      </header>

      <BloqueDeDatos usuario={usuario} />
      <BloqueDeSalas usuario={usuario} />
      <BloqueDeEstadoDePago usuario={usuario} />
      {/* PEGADO AL ESTADO DE PAGO Y NO EN UNA PANTALLA PROPIA: un pago es DE
          ALGUIEN, igual que las vacaciones en la Fase 10. Y va JUSTO DEBAJO
          porque `pagoAlDia` —el «hoy: al dia / debe» del bloque de arriba— es
          DERIVADO de estas filas desde la Fase 5A: leer el estado sin ver los
          pagos que lo producen es leer una conclusion sin sus premisas. El
          orden tambien importa para la seña: el bloque de arriba dice «debe» y
          este explica por que, cuando lo ultimo que se cobro fue una seña.
          El motivo entero de que no haya un listado global, en el docblock de
          `bloque-pagos.tsx`. */}
      <BloqueDePagos usuario={usuario} />
      <BloqueDeDiasFijos usuario={usuario} />
      {/* Las vacaciones van PEGADAS a los dias fijos: «que dias viene» y
          «cuando no viene» son la misma pregunta por los dos lados, y leerlas
          separadas por el bloque de acciones seria tener que acordarse de una
          mientras se lee la otra. */}
      <BloqueDeVacaciones usuario={usuario} />
      {/* DETRAS DE LOS DOS ANTERIORES Y NO DELANTE: «que dias viene» y «cuando
          no viene» son lo que esta persona YA tiene, y esto es lo que se le
          puede ofrecer. Leerlo antes seria ofrecer horarios sin saber cuales ya
          ocupa. Y delante del bloque de acciones, que es el final destructivo
          de la ficha.
          No pide nada al montar: el reporte se pide al abrirlo. Ver el
          docblock de `bloque-turnos-libres.tsx`. */}
      <BloqueDeTurnosLibres usuario={usuario} />
      <BloqueDeAcciones usuario={usuario} rolDeQuienMira={rolDeQuienMira} />
    </section>
  );
}
