'use client';

import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LiquidacionLeida } from '@/componentes/liquidacion-leida';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { useLiquidacion } from '@/hooks/use-dinero';
import type { Mes } from '@/hooks/use-stats';
import { useUsuarios } from '@/hooks/use-usuarios';

/**
 * LA LIQUIDACION DE UNA PROFESORA: lo que cobra en un mes. Es el ultimo
 * endpoint de la API que no tenia pantalla.
 *
 * LA PUERTA DE ROL NO ESTA AQUI SINO EN `page.tsx`, como la de la caja y por el
 * mismo motivo: este componente pide la lista de profesoras en su primera
 * linea, asi que montarlo es pedir. `GET /liquidacion/:profesorId` pide
 * `ADMIN_SALON` —«esto ensena tarifas», dice el controller— y la pagina no lo
 * monta para nadie por debajo.
 *
 * ---------------------------------------------------------------------------
 * LA PROFESORA SE ELIGE POR SU `perfilId`, Y VIVE EN LA URL.
 *
 * `profesorId` es un PERFIL: `LiquidacionDatos` hace
 * `perfil.findFirst({ where: { id: profesorId } })` y exige que su usuario sea
 * `PROFESOR`. `UsuarioResumen` trae los dos ids, y el del usuario contra este
 * endpoint es un 404 —en la Fase 10 ese cruce costo una tarea entera—.
 *
 * En la URL (`?profesora=`) y no en `useState`, por lo mismo que el mes: se
 * comparte por chat, sobrevive al boton de atras y vuelve puesta del login.
 *
 * NO HAY UNA POR DEFECTO. Sin `?profesora=` no se pide ninguna liquidacion:
 * elegir la primera de la lista seria pedir el sueldo de alguien que nadie
 * busco, y dejarlo en la cache del navegador.
 *
 * LA LISTA LLEVA TAMBIEN A LAS DE BAJA. `GET /usuarios?tipo=profesor` sin
 * `activo` las devuelve todas —el service solo filtra si el filtro lo trae— y
 * tiene que ser asi: una profesora que se fue en febrero sigue cobrando enero.
 *
 * ---------------------------------------------------------------------------
 * ESTA PANTALLA NO CALCULA NADA, NI UNA SUMA.
 *
 * Todo lo que hay que saber de una liquidacion lo manda el servidor ya hecho:
 * los minutos y las horas de cada grupo, los cuatro importes y los minutos sin
 * tarifa. Lo que se pinta de un `Importe` es su `texto` —el campo hecho para
 * eso— y no hace falta ni un `centavos` porque no hay ninguna cuenta.
 *
 * `aPagar` ES DEL SERVIDOR. Hoy es exactamente `dictadas`, y aun asi se pinta
 * el que vino: el dia que la regla cambie —un ajuste, un adelanto—, una
 * pantalla que copie o sume por su cuenta sigue pagando lo de antes con cara
 * de exactitud.
 *
 * LAS HORAS TAMPOCO SE DERIVAN DE LOS MINUTOS: las dos vienen en el contrato, y
 * dos implementaciones del mismo numero acaban discrepando.
 */

/** Lo que se dice antes de elegir. No es un error: es la pregunta. */
const SIN_ELEGIR = 'Elegí una profesora para ver su liquidación.';

const PRINCIPIO_DEL_FALLO_DE_LA_LISTA = 'No se pudo leer la lista de profesoras: ';
const PRINCIPIO_DEL_FALLO = 'No se pudo leer la liquidacion: ';

/**
 * La profesora de la URL, o `null`.
 *
 * Un `?profesora=` vacio es lo que deja el selector en «Elegí una profesora» y
 * vale lo mismo que no tenerlo: para la API no es «ninguna» sino
 * `/liquidacion/?anio=…`, otra ruta.
 */
function profesoraDeLaBusqueda(parametros: URLSearchParams): string | null {
  const valor = parametros.get('profesora');
  return valor === null || valor === '' ? null : valor;
}

/**
 * LOS MINUTOS SIN TARIFA, DENTRO DE LA CIFRA DE LO QUE SE PAGA.
 *
 * El contrato explica por que viajan: «un importe al que le faltan horas y no
 * lo dice es un numero que parece completo y no lo esta. Mayor que cero
 * significa "falta configurar una tarifa", no "trabajo menos"». Cubren LOS
 * TRES grupos, asi que el aviso habla de «estos importes» y no solo del que lo
 * lleva.
 *
 * VA AL LADO DEL IMPORTE y con palabras: una nota al pie llega tarde, y un
 * `title` no lo lee nadie que no pase el raton por encima.
 *
 * Y DICE ADONDE IR: la tarifa de un horario se edita en `admin/horarios` desde
 * la Fase 10, y la general del gimnasio sale de la misma cuenta.
 */
function AvisoSinTarifa({ minutos, slug }: { minutos: number; slug: string }) {
  return (
    <p data-sin-tarifa className="text-xs font-semibold text-red-700">
      {`${minutos} minutos de este mes no tienen tarifa, así que estos importes están incompletos. `}
      <Link href={`/${slug}/admin/horarios`} className="underline underline-offset-2">
        Configurar la tarifa en Horarios
      </Link>
    </p>
  );
}

/**
 * La liquidacion de UNA profesora. Se monta solo con una elegida: no montarla
 * es no pedirla, sin un `enabled: false` a un refactor de distancia de salir.
 */
function LiquidacionDeUna({ perfilId, mes, slug }: { perfilId: string; mes: Mes; slug: string }) {
  const liquidacion = useLiquidacion(perfilId, mes);

  if (liquidacion.isPending) {
    return <p className="text-sm text-slate-500">Cargando la liquidacion…</p>;
  }

  /**
   * UN FALLO AL LEER NO SE PARECE A UN MES SIN FRANJAS. Un mes vacio son ceros
   * de verdad; esto es un no se sabe, y no pinta ni un numero.
   */
  if (liquidacion.data === undefined) {
    if (esSesionCaducada(liquidacion.error)) return null;

    return (
      <div className="flex flex-col items-start gap-2">
        <Aviso tono="error">
          {PRINCIPIO_DEL_FALLO}
          {liquidacion.error.message}
        </Aviso>
        <Boton tono="secundario" onClick={() => void liquidacion.refetch()}>
          Reintentar la liquidacion
        </Boton>
      </div>
    );
  }

  return (
    <LiquidacionLeida
      liquidacion={liquidacion.data}
      avisoSinTarifa={(minutos) => <AvisoSinTarifa minutos={minutos} slug={slug} />}
    />
  );
}

function esSesionCaducada(error: unknown): boolean {
  return error instanceof ErrorDeApi && error.esSesionCaducada;
}

/**
 * El bloque entero: el selector y, si hay una elegida, su liquidacion.
 *
 * UNA SESION CADUCADA NO SE DIBUJA AQUI. La pagina ya lo dice una vez y se esta
 * yendo al login, igual que con la caja.
 */
export function BloqueDeLiquidacion({ mes }: { mes: Mes }) {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  const profesoras = useUsuarios({ tipo: 'profesor' });
  const elegida = profesoraDeLaBusqueda(parametros);

  if (esSesionCaducada(profesoras.error)) return null;

  /**
   * Elegir escribe la URL y CONSERVA lo demas: el mes vive al lado. Volver a
   * «Elegí una profesora» QUITA la clave en vez de dejarla vacia.
   */
  function elegir(valor: string): void {
    const siguientes = new URLSearchParams(parametros.toString());
    if (valor === '') siguientes.delete('profesora');
    else siguientes.set('profesora', valor);

    const consulta = siguientes.toString();
    router.push(consulta === '' ? ruta : `${ruta}?${consulta}`);
  }

  return (
    <section data-bloque="liquidacion" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="liquidacion-profesora" className="text-xs font-medium text-slate-600">
          Profesora
        </label>
        <select
          id="liquidacion-profesora"
          value={elegida ?? ''}
          onChange={(evento) => elegir(evento.target.value)}
          className="max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        >
          <option value="">Elegí una profesora</option>
          {(profesoras.data ?? []).map((profesora) => (
            // EL `perfilId`, NO EL `id`: es lo que `/liquidacion/:profesorId` busca.
            <option key={profesora.perfilId} value={profesora.perfilId}>
              {profesora.activo
                ? profesora.nombreCompleto
                : `${profesora.nombreCompleto} (de baja)`}
            </option>
          ))}
        </select>
      </div>

      {profesoras.error !== null && (
        <Aviso tono="error">
          {PRINCIPIO_DEL_FALLO_DE_LA_LISTA}
          {profesoras.error.message}
        </Aviso>
      )}

      {elegida === null ? (
        <p className="text-sm text-slate-600">{SIN_ELEGIR}</p>
      ) : (
        <LiquidacionDeUna key={elegida} perfilId={elegida} mes={mes} slug={slug} />
      )}
    </section>
  );
}
