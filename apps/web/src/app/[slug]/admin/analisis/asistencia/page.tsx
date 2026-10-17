'use client';

import { Suspense, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { AsistenciaDeAlumno, Porcentaje as PorcentajeDelContrato } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useAsistencia, type RangoDeAsistencia } from '@/hooks/use-stats';
import { textoDeLaFraccion, textoDelNumero } from '../porcentaje';
import {
  diasDelRango,
  elRangoVolvioRecortado,
  MAX_DIAS_DE_RANGO,
  rangoDeLaBusqueda,
  urlDelRango,
} from './filtros';

/**
 * ASISTENCIA POR ALUMNO: quien vino, quien falto y —sobre todo— de quien no se
 * sabe.
 *
 * ---------------------------------------------------------------------------
 * PANTALLA PROPIA Y NO UN BLOQUE MAS DE ANALISIS, POR UNA RAZON CONCRETA.
 *
 * **No se pide por mes.** Los otros tres reportes del panel comparten
 * `ConsultaMensualDto` y toman `anio` y `mes`; este toma `ConsultaRangoDto`
 * —un rango libre y un `perfilId` opcional— y lo dice el controller: la
 * conversacion con un alumno sobre su asistencia no empieza ni termina un dia
 * 1. Debajo del selector de mes de Analisis este reporte perderia las dos
 * cosas que lo hacen util: el rango que uno elige («desde que volvio de la
 * lesion») y el filtro por alumno, que ahi no tendria donde vivir.
 *
 * COMO SE LLEGA: por su propia entrada en `ENLACES_DEL_PANEL` («Asistencia»),
 * no desde un enlace dentro de Analisis. Es una decision y conviene que se lea
 * como tal: enterrarla un clic por dentro de la pantalla mensual significaria
 * que el unico sitio donde se dice que el denominador son las clases CON LISTA
 * PASADA solo lo encuentra quien ya fue a buscarlo — y quien no, se queda con
 * el porcentaje agregado del mes, que es justo el numero que esta pantalla
 * existe para desmenuzar. El enlace pide `ADMIN_OPERATIVO`, que es lo que pide
 * `/stats/asistencia`, igual que el de Analisis.
 *
 * ---------------------------------------------------------------------------
 * EL DENOMINADOR ES LA MITAD DE ESTA PANTALLA Y ESTA ESCRITO EN ELLA.
 *
 * Verificado en `StatsService.calcularAsistencia`, no deducido del nombre: se
 * recorren las reservas VIVAS del rango y se cuenta `presentes` con
 * `asistio === true` y `ausentes` con `asistio === false` —`=== false` y no un
 * `else`, para que el `null` no caiga en los ausentes—. El porcentaje sale de
 * `porcentajeDe(presentes, presentes + ausentes)`. O sea: **el denominador son
 * las reservas de turnos donde SE PASO LISTA**, no las reservas.
 *
 * Una profesora que no pasa lista no produce alumnos ausentes: produce alumnos
 * INVISIBLES. Sus clases no entran en el denominador, y un «94%» sin decir
 * sobre que invita a tomar una decision sobre alguien con un numero que a lo
 * mejor cubre tres clases de las doce que tomo. Por eso cada fila lleva su
 * fraccion al lado y la pantalla dice, arriba y en palabras, sobre que se
 * calcula.
 *
 * Y por eso `porcentaje: null` —que es lo que vuelve cuando no se le paso
 * lista NI UNA VEZ en el rango— se pinta como lo que es y nunca como un 0%. Un
 * cero es una respuesta —«no vino a ninguna»— y aqui no hay ninguna respuesta.
 *
 * ---------------------------------------------------------------------------
 * ESTA PANTALLA NO CALCULA EL PORCENTAJE. Pide y pinta.
 *
 * Lo unico que se suma aqui es `presentes + ausentes` para poder enseñar la
 * fraccion, y eso NO es el porcentaje: es la definicion literal del
 * denominador, que el contrato no manda como campo propio. El numero grande es
 * siempre `alumno.porcentaje`, tal cual llego, aunque no cuadre con su
 * fraccion. Dos implementaciones del mismo numero son la forma conocida de que
 * la tabla y el total acaben discrepando sin que nadie sepa cual creer.
 */

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * SOBRE QUE SE CALCULA, DICHO ARRIBA Y NO EN UNA NOTA AL PIE.
 *
 * Va fuera de la frontera de Suspense a proposito: se lee tambien mientras
 * carga y tambien cuando el reporte falla. La frase que explica un numero no
 * puede depender de que el numero haya llegado.
 */
const SOBRE_QUE_SE_CALCULA =
  'La asistencia se calcula sobre las reservas de turnos donde SE PASO LISTA, no sobre todas ' +
  'las reservas. Una clase sin lista pasada no produce ausentes: produce alumnos invisibles, ' +
  'porque esa clase no entra en la cuenta.';

/** Lo que se lee en la fila de quien no tiene ni una lista pasada en el rango. */
const SIN_LISTA_PASADA =
  'No se le paso lista ni una vez en este rango: no es un 0%, es que no se sabe.';

/**
 * La fraccion de un alumno, con el denominador que el contrato no manda.
 *
 * `AsistenciaDeAlumno` trae `presentes`, `ausentes` y `porcentaje`, y no un
 * `Porcentaje` entero como las cinco metricas del operativo. El denominador se
 * arma aqui con la MISMA suma que hace el service —`presentes + ausentes`, las
 * reservas con lista pasada— para poder reusar `textoDelNumero` y
 * `textoDeLaFraccion` tal cual, que son los dos sitios donde esta fase decidio
 * como se pinta un porcentaje sin mentir.
 *
 * EL `porcentaje` SE COPIA, NO SE CALCULA. Es el unico campo que importa de
 * esta conversion: va tal como llego, y con el va su `null`.
 */
function comoPorcentaje(alumno: AsistenciaDeAlumno): PorcentajeDelContrato {
  return {
    numerador: alumno.presentes,
    denominador: alumno.presentes + alumno.ausentes,
    porcentaje: alumno.porcentaje,
  };
}

/**
 * EL RANGO ESCRIBE LA URL, NUNCA `useState`, y se manda CON UN BOTON.
 *
 * Lo segundo es la diferencia con el selector de mes de Analisis y con los
 * filtros de Cierres, que navegan en cada `onChange`. Un mes es UN valor: se
 * elige de un `<select>` y el cambio esta completo en cuanto se suelta. Un
 * rango son DOS, y se escriben a mano: navegar en cada tecla mandaria una
 * peticion por caracter, casi todas de rangos que nadie pidio —`2026-0`,
 * `2026-01-0`— que la API contesta con un 400 por el formato, y dejaria una
 * entrada de historial por cada una. Peor: entre teclear el `desde` nuevo y el
 * `hasta` nuevo hay un momento en el que el rango esta invertido, y la
 * pantalla enseñaria el error de un rango que la persona nunca quiso ver.
 *
 * Los campos van sin estado: el valor inicial sale de la URL y el `key` del
 * formulario hace que una navegacion los vuelva a sembrar. Un `useState`
 * espejo de la URL es un segundo sitio donde vive lo mismo, y el dia que se
 * desincronizan la barra de direcciones y los controles dicen cosas distintas.
 *
 * EL `perfilId` NO SE ESCRIBE A MANO Y POR ESO NO ESTA AQUI. Ver `ElReporte`.
 */
function FiltrosDelRango({ rango }: { rango: RangoDeAsistencia }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  function enviar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();

    const datos = new FormData(evento.currentTarget);
    const desde = String(datos.get('desde') ?? '');
    const hasta = String(datos.get('hasta') ?? '');

    // El `perfilId` que hubiera sigue puesto: cambiar el rango mientras se
    // mira a un alumno es seguir mirando a ESE alumno en otro rango, no volver
    // a la lista entera sin haberlo pedido.
    //
    // UNA sola navegacion por envio: un `push` de cortesia antes del bueno deja
    // una entrada basura en el historial y un parpadeo en la pantalla.
    router.push(urlDelRango(ruta, parametros, { ...rango, desde, hasta }));
  }

  return (
    // «Filtros» y no «Rango»: con `aria-label="Rango"` el formulario y sus
    // campos competirian por el mismo nombre accesible, y entonces son
    // indistinguibles para quien navega con lector de pantalla —y para quien
    // escribe un test—.
    <form
      key={`${rango.desde}|${rango.hasta}`}
      aria-label="Filtros"
      onSubmit={enviar}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1">
        {/* `htmlFor` y no una etiqueta que envuelva al control. */}
        <label htmlFor="asistencia-desde" className="text-xs font-medium text-slate-600">
          Desde
        </label>
        <input
          id="asistencia-desde"
          name="desde"
          placeholder="YYYY-MM-DD"
          defaultValue={rango.desde}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="asistencia-hasta" className="text-xs font-medium text-slate-600">
          Hasta
        </label>
        <input
          id="asistencia-hasta"
          name="hasta"
          placeholder="YYYY-MM-DD"
          defaultValue={rango.hasta}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <Boton type="submit">Ver el rango</Boton>
    </form>
  );
}

/** Las cuatro columnas. El alumno primero: la fila entera lleva a su filtro. */
function columnasDeLaTabla(): readonly ColumnaDeTabla<AsistenciaDeAlumno>[] {
  return [
    {
      encabezado: 'Alumno',
      celda: (fila) => <span data-alumno={fila.perfilId}>{fila.nombreCompleto}</span>,
    },
    {
      encabezado: 'Asistencia',
      celda: (fila) => {
        const dato = comoPorcentaje(fila);
        const sinLista = fila.porcentaje === null;

        return (
          <span className="flex flex-col">
            <span
              data-porcentaje
              className={sinLista ? 'text-slate-400' : 'font-medium text-slate-900'}
            >
              {textoDelNumero(dato)}
            </span>

            {/* La fraccion va SIEMPRE, tambien cuando es «0 de 0»: es la mitad
                del dato. Sin ella el numero grande no se puede juzgar, y «94%»
                sobre tres clases y sobre doce se leen igual. */}
            <span data-fraccion className="text-xs text-slate-500">
              {textoDeLaFraccion(dato)}
            </span>

            {sinLista && (
              <span data-sin-lista className="text-xs text-amber-700">
                {SIN_LISTA_PASADA}
              </span>
            )}
          </span>
        );
      },
    },
    {
      encabezado: 'Presentes',
      celda: (fila) => <span data-presentes>{fila.presentes}</span>,
    },
    {
      encabezado: 'Ausentes',
      celda: (fila) => <span data-ausentes>{fila.ausentes}</span>,
    },
  ];
}

/**
 * EL REPORTE: el rango QUE SE MIRO, y una fila por alumno.
 *
 * EL `hasta` QUE SE PINTA ES EL DE LA RESPUESTA Y NO EL DE LA PETICION, y no
 * son el mismo valor: el service recorta a `MAX_DIAS_DE_RANGO` dias y contesta
 * —«recortar y contestar es mejor respuesta que un 400»—. Pintar el pedido
 * seria afirmar que se miro un año que no se miro, y entonces un alumno que no
 * aparece se lee como «no vino en todo el año» cuando lo cierto es que de los
 * ultimos meses no se miro nada. Es la misma leccion que el `mesesAdelante`
 * recortado de los turnos libres, que el contrato manda por escrito.
 *
 * EL `perfilId` NO SE ESCRIBE A MANO: SE PINCHA UNA FILA.
 *
 * No hay un campo donde teclear un id —nadie se sabe un `cuid` de memoria— ni
 * un `<select>` de alumnos, que seria una SEPTIMA peticion a un endpoint que
 * esta pantalla no necesita. Cada fila lleva al mismo rango filtrado a ese
 * alumno, y eso alcanza para todo lo que la API puede contestar: el reporte
 * sin filtro lista a TODOS los que tuvieron una reserva viva en el rango, y
 * quien no tuvo ninguna no tiene una asistencia que reportar —el service no lo
 * lista, a proposito—. O sea que no hay ningun alumno al que haga falta llegar
 * y al que la tabla no lleve.
 */
function ElReporte({ rango }: { rango: RangoDeAsistencia }) {
  const parametros = useSearchParams();
  const ruta = usePathname();

  const asistencia = useAsistencia(rango);
  const sesionCaducada =
    asistencia.error instanceof ErrorDeApi && asistencia.error.esSesionCaducada;

  const datos = asistencia.data;

  return (
    <div data-bloque="asistencia" className="flex flex-col gap-3">
      {rango.perfilId !== undefined && (
        <p data-filtrado className="text-sm text-slate-600">
          Mirando a un solo alumno (<code data-perfil-filtrado>{rango.perfilId}</code>).{' '}
          <Link
            data-ver-a-todos
            href={urlDelRango(ruta, parametros, { desde: rango.desde, hasta: rango.hasta })}
            className="font-medium text-slate-900 underline underline-offset-2"
          >
            Ver a todos
          </Link>
        </p>
      )}

      {asistencia.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {/* UN FALLO AL LEER NO SE PARECE A UN RANGO SIN ALUMNOS, y es la
          distincion mas cara de esta pantalla despues del `porcentaje: null`.
          Un 400 o un 500 dibujados como una tabla vacia dirian que nadie se
          anoto a nada, no que no se pudo preguntar. Se dice QUE paso —con el
          mensaje de la API, que para el rango invertido explica el motivo— y
          se ofrece volver a intentarlo; ni una fila se pinta. */}
      {asistencia.error !== null && !sesionCaducada && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">No se pudo leer la asistencia: {asistencia.error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void asistencia.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {datos !== undefined && (
        <>
          {/* Los dos extremos, EN ATRIBUTOS PROPIOS y no solo dentro de una
              frase: asi un test puede afirmar la igualdad exacta del `hasta`
              que volvio en vez de buscar una subcadena —«2026» esta dentro de
              «2026-12-31» y de «2026-01-01»—. */}
          <p
            data-rango-mirado
            data-desde={datos.desde}
            data-hasta={datos.hasta}
            className="text-sm text-slate-700"
          >
            Se miro del {datos.desde} al {datos.hasta}.
          </p>

          {elRangoVolvioRecortado(rango, datos) && (
            <div data-recorte>
              <Aviso tono="info">
                Pediste hasta {rango.hasta} y se miro hasta {datos.hasta}: el rango maximo es de{' '}
                {MAX_DIAS_DE_RANGO} dias contando el primero. Lo que no aparece aqui no es «no
                vino»: es que no se miro.
              </Aviso>
            </div>
          )}

          <Tabla
            etiqueta="Asistencia por alumno"
            columnas={columnasDeLaTabla()}
            filas={datos.alumnos}
            claveDeFila={(fila) => fila.perfilId}
            enlaceDeFila={(fila) =>
              urlDelRango(ruta, parametros, { ...rango, perfilId: fila.perfilId })
            }
            vacio={
              <div data-sin-alumnos>
                <Aviso>
                  Nadie tuvo una reserva viva en este rango. La pregunta se contesto y la respuesta
                  esta vacia: no es un fallo al leer.
                </Aviso>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

function PanelDeAsistencia() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  /**
   * El reloj se lee UNA vez y se reparte. Dos lecturas a caballo entre dos
   * dias —una a las 23:59:59.9 y otra un instante despues— darian un rango por
   * defecto distinto al que se pide y al que se dibuja en los controles.
   */
  const ahora = new Date();
  const rango = rangoDeLaBusqueda(parametros, ahora);

  const asistencia = useAsistencia(rango);
  const sesionCaducada =
    asistencia.error instanceof ErrorDeApi && asistencia.error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del panel mira la sesion en el servidor una vez, al entrar: el
    // token puede caducar con la pantalla abierta. El destino conserva el
    // query porque el rango vive ahi: volver del login a los ultimos treinta
    // dias es perder el rango que la persona acababa de elegir.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDelRango rango={rango} />

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, que no le
          dice nada a nadie, y tampoco se ofrece reintentar: seria volver a
          fallar mientras la pantalla ya se esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {/* `ElReporte` vuelve a llamar a `useAsistencia` con el MISMO rango: es
          la misma clave de TanStack, o sea la misma consulta y una sola
          peticion. Se hace asi —y no pasando el resultado por props— para que
          la redireccion del 401 viva arriba, fuera del bloque que ella misma
          tiene que dejar de pintar. */}
      <ElReporte rango={rango} />
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error («missing-suspense-with-csr-bailout») aparece lejos de aqui y cuesta
 * de ubicar. El encabezado queda FUERA para que no parpadee — y con el, la
 * frase que dice sobre que se calcula.
 *
 * Y ESTE ARCHIVO NO EXPORTA NADA MAS QUE ESTO. Next 15 prohibe que un
 * `page.tsx` exporte cualquier otra cosa; lo demas vive en `filtros.ts`. Ver el
 * comentario de ese archivo.
 */
export default function PaginaDeAsistencia() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Asistencia por alumno</h1>

      <p className="text-sm text-slate-600">
        Un rango libre, no un mes: la conversacion con un alumno sobre su asistencia no empieza ni
        termina un dia 1. Se listan los alumnos que tuvieron al menos una reserva viva en el rango.
      </p>

      <p data-sobre-que className="text-sm text-slate-600">
        {SOBRE_QUE_SE_CALCULA}
      </p>

      <p className="text-sm text-slate-600">
        Los numeros pueden tener hasta cinco minutos: el servidor los guarda ese rato. Esto no es un
        tablero en vivo.
      </p>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PanelDeAsistencia />
      </Suspense>
    </section>
  );
}
