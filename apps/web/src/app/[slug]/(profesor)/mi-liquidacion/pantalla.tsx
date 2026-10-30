'use client';

import { Suspense, useEffect } from 'react';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LiquidacionLeida } from '@/componentes/liquidacion-leida';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { mesDelValor, mesDeLaBusqueda, mesesOfrecidos, textoDelMes, valorDelMes } from '@/lib/mes';
import { useMiLiquidacion } from '@/hooks/use-dinero';
import type { Mes } from '@/hooks/use-stats';

/**
 * LO QUE COBRO YO: la liquidacion de quien mira, de un mes.
 *
 * NO HAY PROFESORA QUE ELEGIR NI ID QUE MANDAR. `GET /mi-liquidacion` saca el
 * perfil del token, asi que lo unico que viaja es el mes. Y el mes vive en la
 * URL —se comparte por chat, sobrevive al boton de atras y vuelve puesto del
 * login—, igual que en Analisis, de donde sale el selector: ya existe, ya esta
 * probado y ofrece los ultimos doce meses.
 *
 * ESTA PANTALLA NO CALCULA NADA, NI UNA SUMA. Todo lo que se pinta lo manda el
 * servidor ya hecho, y la vista es la MISMA que ve el admin
 * (`LiquidacionLeida`): lo unico que cambia es el aviso de los minutos sin
 * tarifa, porque la profesora no puede configurarla.
 *
 * La puerta de rol es la del layout de `(profesor)`, que corre en el servidor.
 *
 * VIVE AQUI Y NO EN `page.tsx` porque es de cliente y una pagina de cliente no
 * puede exportar `metadata`: sin el, la pestaña seguiria diciendo «Mis clases».
 */

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

const PRINCIPIO_DEL_FALLO = 'No se pudo leer tu liquidación: ';

/**
 * El aviso de los minutos sin tarifa, SIN ENLACE.
 *
 * La tarifa se edita en Horarios, que es del admin: un enlace aqui llevaria a
 * una profesora a una puerta cerrada. Se le dice a quien si puede.
 */
function AvisoSinTarifaParaLaProfesora({ minutos }: { minutos: number }) {
  return (
    <p data-sin-tarifa className="text-xs font-semibold text-red-700">
      {`${minutos} minutos de este mes no tienen tarifa, así que estos importes están incompletos. Avisale a la administración.`}
    </p>
  );
}

function SelectorDeMes({ elegido, ahora }: { elegido: Mes; ahora: Date }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  function cambiar(valor: string): void {
    const mes = mesDelValor(valor);
    if (mes === null) return;

    // Se conserva todo lo demas de la URL: solo se escriben el anio y el mes.
    const siguientes = new URLSearchParams(parametros.toString());
    siguientes.set('anio', String(mes.anio));
    siguientes.set('mes', String(mes.mes));

    router.push(`${ruta}?${siguientes.toString()}`);
  }

  return (
    <form aria-label="Filtros" className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al control: envolviendolo,
            el nombre accesible se lleva por delante el texto de las opciones. */}
        <label htmlFor="mi-liquidacion-mes" className="text-xs font-medium text-slate-600">
          Mes
        </label>
        <select
          id="mi-liquidacion-mes"
          value={valorDelMes(elegido)}
          onChange={(evento) => cambiar(evento.target.value)}
          className={CLASES_DE_CONTROL}
        >
          {mesesOfrecidos(ahora, elegido).map((mes) => (
            <option key={valorDelMes(mes)} value={valorDelMes(mes)}>
              {textoDelMes(mes)}
            </option>
          ))}
        </select>
      </div>
    </form>
  );
}

function PanelDeMiLiquidacion() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const ahora = new Date();
  const mes = mesDeLaBusqueda(parametros, ahora);

  const liquidacion = useMiLiquidacion(mes);
  const error = liquidacion.error;
  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  return (
    <div className="flex flex-col gap-4">
      <SelectorDeMes elegido={mes} ahora={ahora} />

      {/* Sin sesion no se enseña el «Unauthorized» crudo ni se ofrece reintentar:
          seria volver a fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {liquidacion.isPending && <p className="text-sm text-slate-500">Cargando tu liquidación…</p>}

      {/* UN FALLO AL LEER NO SE PARECE A UN MES SIN FRANJAS: un mes vacio son
          ceros de verdad; esto es un no se sabe, y no pinta ni un numero. */}
      {error !== null && !sesionCaducada && (
        <div className="flex flex-col items-start gap-2">
          <Aviso tono="error">
            {PRINCIPIO_DEL_FALLO}
            {error.message}
          </Aviso>
          <Boton tono="secundario" onClick={() => void liquidacion.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {liquidacion.data !== undefined && (
        <section data-bloque="mi-liquidacion" className="flex flex-col gap-3">
          <LiquidacionLeida
            liquidacion={liquidacion.data}
            avisoSinTarifa={(minutos) => <AvisoSinTarifaParaLaProfesora minutos={minutos} />}
          />
        </section>
      )}
    </div>
  );
}

export function PantallaDeMiLiquidacion() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Mi liquidación</h1>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PanelDeMiLiquidacion />
      </Suspense>
    </section>
  );
}
