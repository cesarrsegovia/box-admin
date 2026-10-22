'use client';

import { Suspense, useEffect, type FormEvent } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { ClaseDelProfesor } from '@boxadmin/shared';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useAlumnosDeLaClase, useMisClases, type RangoDeClases } from '@/hooks/use-mis-clases';
import {
  conteoDeLaLista,
  MAX_CLASES_CON_DETALLE,
  rangoDeLaBusqueda,
  seDetallaLaAgenda,
  urlDelRango,
} from './filtros';

/**
 * LA AGENDA DE LA PROFESORA: QUE CLASES TIENE Y, DE CADA UNA, QUE LE FALTA.
 *
 * ===========================================================================
 * LO PRIMERO, PORQUE ES UNA DECISION Y NO UN DETALLE:
 * **`ClaseDelProfesor.listaPasada` NO SE DIBUJA EN NINGUN SITIO.**
 * ===========================================================================
 *
 * El contrato lo trae, seria gratis, y es exactamente el cartel que una agenda
 * de clases pediria a gritos —un tilde verde en las que ya estan—. No se usa
 * porque **MIENTE**, y la mentira no es una posibilidad teorica: esta escrita
 * en el service, verificada linea por linea y no deducida del nombre.
 *
 *     // mis-clases.service.ts
 *     listaPasada: turno.reservas.some((reserva) => reserva.asistio !== null)
 *
 * Y `Reserva.asistio` NO LO ESCRIBE SOLO LA PROFESORA. Lo escribe tambien el
 * check-in por QR, en `CheckinService.escribir`, dentro de la misma
 * transaccion que crea la fila de `Asistencia`:
 *
 *     await cliente.reserva.update({ where: {...}, data: { asistio: true } });
 *
 * O sea: **UN SOLO alumno que escanea el QR al entrar deja la clase entera
 * marcada como «lista pasada»** aunque la profesora no la haya tocado y aunque
 * los otros ocho sigan en `asistio: null`. El cartel que dice «esta hecha» se
 * enciende con el 11% del trabajo hecho, y la clase que se queda sin pasar es
 * justamente la que parecia resuelta.
 *
 * LO QUE LO VUELVE INDEFENDIBLE ES QUE **EL MISMO REPO YA RESOLVIO ESTO BIEN**
 * del otro lado del mostrador. `CheckinService.candidatas` calcula DOS campos
 * donde este contrato tiene uno, y su comentario dice por que:
 *
 *     yaMarcada: reserva.asistencia !== null,   // la fila de Asistencia
 *     listaPasada: reserva.asistio !== null,    // la marca de la reserva
 *     // «Van separados porque los dos bloquean el check-in pero con mensajes
 *     //  distintos, y porque fusionarlos le diria "ya marcaste" a alguien que
 *     //  no marco.»
 *
 * El contrato de la profesora los fusiona, y para ella la fusion dice lo
 * simetrico y peor: «ya pasaste lista» a quien no la paso. Un booleano que no
 * se puede corregir desde el front —el arreglo esta en la API, y esta tarea no
 * toca la API— se deja SIN DIBUJAR. Un dato que puede ser falso no mejora por
 * pintarse en gris.
 *
 * ===========================================================================
 * LO QUE SE DIBUJA EN SU LUGAR: **CUANTOS QUEDAN SIN MARCAR**.
 * ===========================================================================
 *
 * «Faltan 7 de 9» en vez de un si/no. Es mas informacion y ademas no se puede
 * malinterpretar: el QR que marco a uno mueve el 7 a un 6, que es la verdad.
 * Y distingue los dos extremos que el booleano confunde —ninguno marcado y
 * todos marcados— porque son numeros y no un color.
 *
 * SALE DE `GET /mis-clases/:id/alumnos`, que es el unico sitio donde esta el
 * `asistio` de cada reserva, **Y ESO CUESTA UNA PETICION POR CLASE**. El rango
 * por defecto —hoy— y el tope a partir del cual el detalle NO se pide estan
 * decididos y razonados en `filtros.ts`, que es donde viven los dos numeros.
 * Lo que importa aqui: cuando el detalle no se pide, **se dice**, y no se cae
 * al `listaPasada` gratis. La alternativa seria enseñar un si/no que puede ser
 * falso justo en los rangos largos, que es donde nadie va a ir a comprobarlo.
 *
 * ===========================================================================
 * Y NO ES UNA TABLA: ES UNA LISTA, EN UN TELEFONO.
 * ===========================================================================
 *
 * Quien mira esto esta de pie en la sala con nueve personas esperando. Cada
 * clase es una tarjeta entera pulsable que lleva a su lista —un objetivo de
 * dedo, no un enlace de cuatro palabras dentro de una celda— y el layout del
 * area la mantiene en `max-w-md`.
 */

const CLASES_DE_CONTROL =
  'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';

/**
 * POR QUE NO HAY UN TILDE DE «YA ESTA», DICHO ARRIBA Y NO EN UNA NOTA AL PIE.
 *
 * Va FUERA de la frontera de Suspense, igual que la frase que explica el
 * denominador en el reporte de asistencia: se lee tambien mientras carga y
 * tambien cuando la agenda falla. La frase que explica que significa un numero
 * no puede depender de que el numero haya llegado.
 */
const POR_QUE_NO_HAY_TILDE =
  'Aca no vas a ver «lista pasada» en ninguna clase, y es a proposito: esa marca se enciende ' +
  'en cuanto UNA sola persona escanea el QR al entrar, aunque vos no hayas tocado la clase. ' +
  'En su lugar se dice cuantos de los anotados siguen sin marcar.';

/** Lo que se lee donde iria la cuenta cuando el rango trae demasiadas clases. */
const NO_SE_PIDIO_EL_DETALLE =
  'No se miro quien falta: este rango trae mas de ' +
  `${MAX_CLASES_CON_DETALLE} clases y preguntarlo una por una es una peticion por clase. ` +
  'Abri la clase para verlo, o pedi menos dias.';

/**
 * EL RANGO ESCRIBE LA URL, NUNCA `useState`, Y SE MANDA CON UN BOTON.
 *
 * Lo segundo no es gratis: un rango son DOS valores que se escriben a mano, y
 * navegar en cada tecla mandaria una peticion por caracter —`2026-1`,
 * `2026-10-` — que la API contesta con el 400 del formato, dejaria una entrada
 * de historial por cada una, y entre teclear el `desde` nuevo y el `hasta`
 * nuevo habria un momento con el rango invertido en el que la pantalla
 * enseñaria un error que nadie pidio ver. Es la misma decision, y por los
 * mismos motivos, que los filtros del reporte de asistencia.
 *
 * Los campos van SIN ESTADO: el valor inicial sale de la URL y el `key` del
 * formulario los vuelve a sembrar en cada navegacion. Un `useState` espejo de
 * la URL es un segundo sitio donde vive lo mismo, y el dia que se desincronizan
 * la barra de direcciones y los controles dicen cosas distintas — que es
 * exactamente lo que rompe el boton de atras.
 */
function FiltrosDelRango({ rango }: { rango: RangoDeClases }) {
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  function enviar(evento: FormEvent<HTMLFormElement>): void {
    evento.preventDefault();

    const datos = new FormData(evento.currentTarget);
    const desde = String(datos.get('desde') ?? '');
    const hasta = String(datos.get('hasta') ?? '');

    // UNA sola navegacion por envio: un `push` de cortesia antes del bueno deja
    // una entrada basura en el historial, y en un telefono eso son dos toques
    // del boton de atras para volver a donde estabas.
    router.push(urlDelRango(ruta, parametros, { desde, hasta }));
  }

  return (
    // «Filtros» y no «Rango»: con `aria-label="Rango"` el formulario y sus
    // campos competirian por el mismo nombre accesible y serian
    // indistinguibles para quien navega con lector de pantalla.
    <form
      key={`${rango.desde}|${rango.hasta}`}
      aria-label="Filtros"
      onSubmit={enviar}
      className="flex flex-wrap items-end gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="agenda-desde" className="text-xs font-medium text-slate-600">
          Desde
        </label>
        <input
          id="agenda-desde"
          name="desde"
          placeholder="YYYY-MM-DD"
          defaultValue={rango.desde}
          className={CLASES_DE_CONTROL}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="agenda-hasta" className="text-xs font-medium text-slate-600">
          Hasta
        </label>
        <input
          id="agenda-hasta"
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

/**
 * LA CUENTA DE UNA CLASE. Un componente propio, y eso NO es cosmetica.
 *
 * `useAlumnosDeLaClase` es un hook, asi que no se puede llamar dentro de un
 * `.map`: tiene que haber un componente por clase. Y como hay uno por clase,
 * el tope del detalle se aplica DONDE SE DECIDE —pasandole `''` como
 * `turnoId`, que es lo que apaga la consulta por el `enabled` que el hook ya
 * trae—. Nada de un `if` alrededor del hook, que es el error que React
 * castiga con un «rendered fewer hooks than expected» en cuanto una clase
 * entra o sale de la lista.
 *
 * LOS CUATRO ESTADOS VAN EN UN ATRIBUTO PROPIO Y NO SOLO EN LA FRASE, por lo
 * mismo que el `data-rango-mirado` del reporte de asistencia: un test que
 * busque subcadenas se cuelga de la casualidad ortografica —`'0'` esta dentro
 * de `'10'`, y un `not.toContain('0 de')` pasa en verde sobre un «10 de 12»—.
 * Con atributos, las afirmaciones son de igualdad exacta.
 *
 * «NO SE PUDO PREGUNTAR» NO SE PARECE A «NO FALTA NADIE». Si la peticion del
 * detalle falla, la tarjeta lo dice y no se queda en blanco: una tarjeta sin
 * cuenta se lee como una clase sin nadie anotado, que es la lectura mas cara
 * de las dos —«no tengo que pasar lista aca»—.
 */
function CuentaDeLaClase({ turnoId, sePide }: { turnoId: string; sePide: boolean }) {
  // `''` apaga la consulta: es el `enabled: turnoId !== ''` del hook.
  const alumnos = useAlumnosDeLaClase(sePide ? turnoId : '');

  if (!sePide) {
    return (
      <span data-cuenta data-estado="no-pedido" className="text-xs text-amber-700">
        {NO_SE_PIDIO_EL_DETALLE}
      </span>
    );
  }

  if (alumnos.error !== null) {
    return (
      <span data-cuenta data-estado="no-se-pudo" className="text-xs text-red-700">
        No se pudo mirar quien falta en esta clase.
      </span>
    );
  }

  if (alumnos.data === undefined) {
    return (
      <span data-cuenta data-estado="cargando" className="text-xs text-slate-500">
        Mirando quien falta…
      </span>
    );
  }

  const cuenta = conteoDeLaLista(alumnos.data);

  return (
    <span
      data-cuenta
      data-estado="listo"
      data-anotados={cuenta.anotados}
      data-marcados={cuenta.marcados}
      data-faltan={cuenta.faltan}
      className={
        cuenta.faltan > 0 ? 'text-sm font-medium text-slate-900' : 'text-sm text-slate-500'
      }
    >
      {textoDeLaCuenta(cuenta.faltan, cuenta.anotados)}
    </span>
  );
}

/**
 * LAS TRES FRASES, Y LAS TRES SON DISTINTAS A PROPOSITO.
 *
 * «Faltan 0 de 9» seria gramaticalmente correcto y practicamente invisible:
 * en una lista de clases, lo que se busca de un vistazo es cual TIENE trabajo
 * pendiente, y un cero metido en la misma frase que un siete no se distingue
 * de reojo. Y «no se anoto nadie» no es «ya estan todos»: una clase vacia no
 * es una clase resuelta, es una clase a la que no fue nadie.
 */
function textoDeLaCuenta(faltan: number, anotados: number): string {
  if (anotados === 0) return 'No se anoto nadie en esta clase.';
  if (faltan === 0) return `Ya estan los ${anotados} marcados.`;

  return `Faltan ${faltan} de ${anotados} por marcar.`;
}

/**
 * UNA CLASE DE LA AGENDA. La tarjeta ENTERA lleva a su lista.
 *
 * El `href` se arma con el `turnoId` DE ESTA CLASE y no con una variable de
 * fuera del `map`: enlazar todas a la primera es un fallo que no se ve
 * mirando la pantalla —los nueve enlaces parecen nueve enlaces— y que deja a
 * la profesora pasando lista de la clase equivocada.
 *
 * El `data-clase` existe para que el spec encuentre la tarjeta POR SU ID y no
 * por el nombre de la clase, que se repite entre dias.
 */
function FilaDeClase({
  clase,
  slug,
  sePideElDetalle,
}: {
  clase: ClaseDelProfesor;
  slug: string;
  sePideElDetalle: boolean;
}) {
  return (
    <li>
      <Link
        data-clase={clase.turnoId}
        href={`/${slug}/mis-clases/${clase.turnoId}`}
        className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      >
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span data-nombre className="text-base font-semibold text-slate-900">
            {clase.nombre}
          </span>
          <span data-cuando className="text-sm text-slate-600">
            {clase.fecha} · {clase.horaInicio}–{clase.horaFin}
          </span>
        </span>

        <span data-sala className="text-xs text-slate-500">
          {clase.salaNombre}
        </span>

        <CuentaDeLaClase turnoId={clase.turnoId} sePide={sePideElDetalle} />
      </Link>
    </li>
  );
}

/**
 * LA AGENDA. Tres salidas que NO se parecen entre si.
 *
 * UN FALLO AL LEER NO ES UNA AGENDA VACIA, y es la distincion mas cara de esta
 * pantalla. Un 400 —el rango invertido, una fecha rota— o un 500 dibujados
 * como «no tenes clases» le dirian a la profesora que hoy no trabaja. Se dice
 * QUE paso, con el mensaje de la API palabra por palabra —que para el rango
 * invertido ES el motivo: «desde no puede ser posterior a hasta»— y se ofrece
 * volver a intentarlo. Ni una tarjeta se pinta.
 *
 * Y UNA AGENDA VACIA SE DICE COMO LO QUE ES: la pregunta se contesto y la
 * respuesta esta vacia.
 */
function Agenda({
  rango,
  slug,
  clases,
  error,
  cargando,
  reintentar,
}: {
  rango: RangoDeClases;
  slug: string;
  clases: ClaseDelProfesor[] | undefined;
  /** Lo que devuelve TanStack, sin estrechar: la rama del 401 usa `instanceof`. */
  error: Error | null;
  cargando: boolean;
  reintentar: () => void;
}) {
  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  return (
    <div data-bloque="agenda" className="flex flex-col gap-3">
      <p
        data-rango-pedido
        data-desde={rango.desde}
        data-hasta={rango.hasta}
        className="text-sm text-slate-700"
      >
        Del {rango.desde} al {rango.hasta}.
      </p>

      {cargando && <p className="text-sm text-slate-500">Cargando…</p>}

      {error !== null && !sesionCaducada && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">No se pudo leer tu agenda: {error.message}</Aviso>
          <Boton tono="secundario" onClick={reintentar}>
            Reintentar
          </Boton>
        </div>
      )}

      {clases !== undefined && clases.length === 0 && (
        <div data-sin-clases>
          <Aviso>
            No tenes ninguna clase en este rango. La pregunta se contesto y la respuesta esta vacia:
            no es un fallo al leer.
          </Aviso>
        </div>
      )}

      {clases !== undefined && clases.length > 0 && (
        <>
          {!seDetallaLaAgenda(clases.length) && (
            <div data-sin-detalle>
              <Aviso tono="info">{NO_SE_PIDIO_EL_DETALLE}</Aviso>
            </div>
          )}

          <ul className="flex flex-col gap-3">
            {clases.map((clase) => (
              <FilaDeClase
                key={clase.turnoId}
                clase={clase}
                slug={slug}
                sePideElDetalle={seDetallaLaAgenda(clases.length)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PanelDeMisClases() {
  const { slug } = useParams<{ slug: string }>();
  const parametros = useSearchParams();
  const ruta = usePathname();
  const router = useRouter();

  /**
   * El reloj se lee UNA vez y se reparte. Dos lecturas a caballo entre dos dias
   * —una a las 23:59:59.9 y otra un instante despues— darian un rango por
   * defecto distinto al que se pide y al que se dibuja en los controles, y en
   * esta pantalla el rango por defecto es UN SOLO DIA: la diferencia no seria
   * un borde, seria la agenda entera.
   */
  const ahora = new Date();
  const rango = rangoDeLaBusqueda(parametros, ahora);

  const agenda = useMisClases(rango);
  const error = agenda.error;
  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useEffect(() => {
    if (!sesionCaducada) return;

    // La puerta del area mira la sesion en el servidor UNA vez, al entrar: el
    // token puede caducar con la pantalla abierta, y en esta pantalla eso es lo
    // normal y no lo raro —se abre al empezar la clase y se usa al terminarla—.
    // El destino conserva el query porque el rango vive ahi.
    router.push(destinoDeLoginDesde(ruta, parametros.toString(), slug));
  }, [sesionCaducada, router, ruta, parametros, slug]);

  return (
    <div className="flex flex-col gap-4">
      <FiltrosDelRango rango={rango} />

      {/* Sin sesion no se enseña el «Unauthorized» crudo de la API, y tampoco se
          ofrece reintentar: seria volver a fallar mientras la pantalla ya se
          esta yendo al login. */}
      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      <Agenda
        rango={rango}
        slug={slug}
        clases={agenda.data}
        error={error}
        cargando={agenda.isPending}
        reintentar={() => void agenda.refetch()}
      />
    </div>
  );
}

/**
 * `useSearchParams` obliga a una frontera de Suspense.
 *
 * Sin ella, `next build` falla en cuanto algo deje esta ruta prerenderizable, y
 * el error («missing-suspense-with-csr-bailout») aparece lejos de aqui y cuesta
 * de ubicar.
 *
 * Y ESTE ARCHIVO NO EXPORTA NADA MAS QUE ESTO. Next 15 prohibe que un
 * `page.tsx` exporte cualquier otra cosa; lo demas vive en `filtros.ts`. Ver el
 * comentario de ese archivo: el error que da es sobre `OmitWithTag` y no se
 * parece en nada a la causa.
 */
export default function PaginaDeMisClases() {
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Mis clases</h1>

      <p data-por-que-no-hay-tilde className="text-sm text-slate-600">
        {POR_QUE_NO_HAY_TILDE}
      </p>

      <Suspense fallback={<p className="text-sm text-slate-500">Cargando…</p>}>
        <PanelDeMisClases />
      </Suspense>
    </section>
  );
}
