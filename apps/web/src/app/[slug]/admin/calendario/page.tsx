'use client';

import { Suspense, useEffect } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Aviso } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useMesDelCalendario, usePlanDelMes } from '@/hooks/use-calendario-admin';
import { mesesOfrecidos } from './meses';
import { PlanDelMes } from './plan';
import { AccionDePublicar, EstadoDelMes, useRefrescarElPlanAlTerminar } from './publicar';
import { SelectoresDelCalendario, mesElegidoDeLaBusqueda } from './selectores';

/**
 * La pantalla que publica el mes de un salon.
 *
 * NO TIENE ESTADO PROPIO, y es la decision que gobierna todo lo demas: la sala,
 * el ano y el mes viven en la URL. `previsualizar` es de solo lectura y funcion
 * pura de esos tres parametros —el servidor ya tiene el resto del estado—, asi
 * que no hace falta un asistente con memoria ni un `useState` que se pierda al
 * navegar. Recargar, compartir el enlace y volver con el boton de atras dan
 * exactamente lo mismo.
 *
 * NO SE PIDE `GET .../conflictos`. Ese endpoint devuelve exactamente
 * `plan.conflictos`, que la previsualizacion ya trae dentro: seria una segunda
 * peticion para un dato que ya esta, y dos respuestas que pueden discrepar.
 * De los cuatro endpoints del modulo, esta pantalla usa tres.
 *
 * LA UNICA NAVEGACION QUE SALE DE AQUI ES LA DEL 401. Montar la pantalla no
 * navega nunca, pase lo que pase en la URL: ver el bloque de tests «montar la
 * pantalla no navega sola».
 */
function PantallaDelCalendario() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  /**
   * UN SOLO reloj por pintado, y la MISMA lista para las dos cosas.
   *
   * Con el selector dibujado de una lista y la URL validada contra otra, basta
   * un segundo a caballo entre dos meses para que la pantalla ofrezca algo que
   * ella misma rechaza. Pasandola de aqui para abajo, las dos cosas no pueden
   * discrepar por construccion.
   */
  const ofrecidos = mesesOfrecidos(new Date());
  const elegido = mesElegidoDeLaBusqueda(parametros, ofrecidos);

  const plan = usePlanDelMes(elegido);
  const mes = useMesDelCalendario(elegido);

  // Cuando el worker termina de escribir, el plan que se esta viendo envejece:
  // lo que "falta por crear" ya se creo. Ver el comentario del hook.
  useRefrescarElPlanAlTerminar(elegido, mes.data);

  /**
   * LAS DOS consultas pueden traer el 401, no solo la del plan.
   *
   * Un solo booleano y un solo efecto: si cada consulta empujara por su cuenta,
   * una sesion caducada con las dos fallando mandaria al login dos veces y
   * dejaria una entrada de mas en el historial.
   */
  const sesionCaducada =
    (plan.error instanceof ErrorDeApi && plan.error.esSesionCaducada) ||
    (mes.error instanceof ErrorDeApi && mes.error.esSesionCaducada);

  useEffect(() => {
    if (!sesionCaducada) return;

    // El layout del panel ya mira la sesion en el servidor, pero eso pasa una
    // vez al entrar: el token puede caducar con la pantalla abierta, y entonces
    // el unico que se entera es este 401.
    // El destino se arma en `lib/destino-de-login` y no aqui: conserva la sala
    // y el mes, que en esta pantalla SON el estado. Volver del login a un
    // calendario vacio es perder justo lo que la persona estaba mirando.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  return (
    <div className="flex flex-col gap-4">
      <SelectoresDelCalendario ofrecidos={ofrecidos} />

      {elegido === null && <Aviso>Elegi una sala y un mes para ver el plan.</Aviso>}

      {elegido !== null && (
        <>
          {/* El estado del mes y la accion, ANTES del plan: lo primero es que
              paso con este mes y que se puede hacer; el plan es el detalle. */}
          {mes.data !== undefined && <EstadoDelMes mes={mes.data} />}

          {mes.data !== undefined && <AccionDePublicar elegido={elegido} mes={mes.data} />}

          {plan.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

          {/* Sin sesion no se enseña el mensaje crudo de la API: «Unauthorized»
              delante del mostrador no le dice nada a nadie, y encima la
              pantalla ya se esta yendo al login. */}
          {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

          {plan.error !== null && !sesionCaducada && (
            <Aviso tono="error">{plan.error.message}</Aviso>
          )}

          {plan.data !== undefined && <PlanDelMes plan={plan.data} />}
        </>
      )}
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error ("missing-suspense-with-csr-bailout") aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee.
 */
export default function PaginaDeCalendario() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Calendario</h1>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PantallaDelCalendario />
      </Suspense>
    </section>
  );
}
