'use client';

import { useEffect, useState } from 'react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import type { AlumnoEnClase } from '@boxadmin/shared';
import { Confirmar } from '@/componentes/confirmar';
import { Aviso, Boton } from '@/componentes/ui';
import { ErrorDeApi } from '@/lib/cliente';
import { SIN_QUERY, destinoDeLoginDesde } from '@/lib/destino-de-login';
import { useAlumnosDeLaClase, usePasarLista } from '@/hooks/use-mis-clases';

/**
 * PASAR LISTA DE UNA CLASE. LA PANTALLA QUE ESCRIBE LA UNICA AUSENCIA DEL
 * SISTEMA.
 *
 * ===========================================================================
 * POR QUE ESTA PANTALLA IMPORTA MAS QUE SU TAMAÑO.
 * ===========================================================================
 *
 * `POST /mis-clases/:turnoId/asistencia` es EL UNICO SITIO de todo el producto
 * que escribe `asistio: false`. El check-in por QR escribe `true` y nunca otra
 * cosa. O sea que hasta hoy **nadie en ningun gimnasio podia marcar una
 * ausencia**, y el reporte de asistencia de la Fase 11 viene contando ausentes
 * que solo podian ser cero. Esta lista no es una pantalla mas: es la que deja
 * de hacer mentir a una que ya esta entregada.
 *
 * ===========================================================================
 * Y ES LA MAS PELIGROSA DE LA FASE, PORQUE EL ENDPOINT ES **REEMPLAZO TOTAL**.
 * ===========================================================================
 *
 * Leido en `mis-clases.service.ts`, no deducido del nombre: `pasarLista` marca
 * `asistio: true` a los `presentes` que le llegan **y `false` a todas las demas
 * reservas activas del turno**. Es una FOTO de la clase entera, no un
 * incremento. De ahi salen las tres consecuencias que mandan sobre cada
 * decision de este archivo:
 *
 * ---------------------------------------------------------------------------
 * 1. PASAR LISTA PUEDE PISAR UN CHECK-IN REAL, Y POR ESO **LOS PRESENTES
 *    LLEGAN YA TILDADOS**.
 * ---------------------------------------------------------------------------
 *
 * Alguien escaneo el QR al entrar —lo que escribe `asistio: true` en su
 * reserva—, la profesora abre esto al terminar y tilda a los que tiene
 * delante. Si la pantalla naciera con todo en blanco, esa persona **se iria
 * marcada como ausente aunque vino y lo registro ella misma**, y el dato
 * verdadero lo habria destruido el camino normal de la pantalla, no un fallo.
 *
 * Que los `asistio: true` lleguen tildados NO ES COMODIDAD: es lo unico que
 * impide ese estropicio. Es la decision que mas vale de este archivo.
 *
 * Y el tilde sigue siendo SUYO: destildar a quien tiene el QR es legitimo —se
 * fue a los cinco minutos, o escaneo y no entro— y se manda tal cual. Lo que
 * la pantalla no hace es decidirlo por ella en silencio.
 *
 * ---------------------------------------------------------------------------
 * 2. UNA LISTA VACIA MARCA AUSENTE A TODA LA CLASE. SE PUEDE, PERO NO DE UN
 *    CLIC.
 * ---------------------------------------------------------------------------
 *
 * `presentes: []` es un camino LEGITIMO del service —tiene una rama propia
 * para el, y «no vino nadie» es una tarde real de un gimnasio—, asi que la
 * pantalla no lo prohibe. Pero es tambien lo que produce un dedo que roza el
 * boton antes de tildar a nadie, y las dos cosas son el MISMO cuerpo.
 *
 * Lo que las separa es una confirmacion que NOMBRA lo que va a pasar y cuanta
 * gente abarca, con el mismo `Confirmar` que usan los borrados del panel. Y
 * **solo** en ese caso: una confirmacion en cada guardado es una confirmacion
 * que nadie lee, y a la tercera clase del dia se acepta sin mirar.
 *
 * ---------------------------------------------------------------------------
 * 3. VOLVER A PASAR LISTA REESCRIBE TODO. NO HAY CORREGIR A UNA SOLA PERSONA.
 * ---------------------------------------------------------------------------
 *
 * No hay endpoint para «marcar solo a Ana»: cada guardado manda la clase
 * entera. Eso se DICE arriba, con palabras, antes de que nadie toque nada —ver
 * `COMO_FUNCIONA`—, porque la alternativa es que se entienda a base de haberlo
 * roto una vez.
 *
 * ===========================================================================
 * LO QUE EL SERVIDOR YA IMPIDE, Y ESTA PANTALLA **NO REPITE**.
 * ===========================================================================
 *
 * - **No se pasa lista de una clase que todavia no empezo.** El service lo
 *   rechaza con `'Esa clase todavia no empezo'` (copiado de la fuente). Hacia
 *   atras NO hay limite, y esta razonado alli mismo: «una profesora que se
 *   olvido tres semanas puede ponerse al dia».
 * - **Un id sin reserva activa se rechaza**, nombrando a quien sobra: `'No
 *   tienen reserva activa en esta clase: ...'`. Aqui eso no es teorico: entre
 *   que se lee la lista y se guarda, un admin puede cancelarle la reserva a
 *   alguien que sigue tildado en esta pantalla.
 *
 * NINGUNA DE LAS DOS SE COMPRUEBA AQUI, y no es pereza. Seria una SEGUNDA
 * FUENTE DE VERDAD sobre una regla que ya vive en un sitio, y la copia es la
 * que se queda vieja. Ademas, la de «no empezo» esta pantalla **no la podria
 * comprobar aunque quisiera**: `GET /mis-clases/:turnoId/alumnos` devuelve
 * `AlumnoEnClase[]` y nada mas —ni fecha, ni hora, ni nombre de la clase—, asi
 * que para tener el reloj del turno habria que ir a buscar la agenda a un
 * rango inventado. Lo que se hace es MANDAR y pintar el motivo de la API
 * palabra por palabra.
 *
 * ===========================================================================
 * TRES COSAS QUE NO ESTAN, Y FALTAN A PROPOSITO.
 * ===========================================================================
 *
 * **EL NOMBRE DE LA CLASE EN EL TITULO.** Esta ruta no lo tiene: el endpoint
 * de la lista no lo trae. Sacarlo de la cache de la agenda funcionaria solo
 * cuando se llega desde la agenda —no al recargar, no desde un enlace— y
 * fallaria callado justo cuando mas se mira. Un titulo que a veces nombra la
 * clase y a veces no es peor que uno que nunca la nombra.
 *
 * **UN ENLACE DE «VOLVER».** El que vuelve es el boton de atras del telefono,
 * que es el gesto mas usado de todos y ademas el UNICO que devuelve la agenda
 * **con el rango que tenia**: el rango vive en la URL de la agenda (ver
 * `filtros.ts`) y los enlaces que traen aqui no lo arrastran. Un «Volver a mis
 * clases» cableado la devolveria a HOY despues de haber estado mirando el
 * martes pasado, y encima pareceria que funciona.
 *
 * **CUALQUIER DATO DE LA PERSONA QUE NO SEA SU NOMBRE.** `AlumnoEnClase` trae
 * `perfilId`, `nombreCompleto` y `asistio`, y es escueto a proposito: desde la
 * Fase 1 la ficha medica solo la ven ADMIN_SALON o la propia persona. Aqui no
 * hay telefono, ni ficha, ni un enlace a una ficha — que para este rol seria
 * ofrecer un 403.
 */

/**
 * LO QUE SE DICE ANTES DE QUE NADIE TOQUE NADA.
 *
 * Las tres consecuencias del reemplazo total, en el orden en que muerden. Va
 * FUERA de cualquier rama: se lee tambien mientras carga y tambien cuando la
 * lectura falla, porque la frase que explica que significa guardar no puede
 * depender de que la lista haya llegado.
 */
const COMO_FUNCIONA =
  'Lo que guardes reemplaza la lista entera: quien no quede tildado queda marcado como ' +
  'ausente. Por eso llegan ya tildados los que figuran como presentes, incluidos los que se ' +
  'marcaron solos escaneando el QR al entrar. Podes guardar las veces que haga falta, pero ' +
  'cada vez se reescribe la clase completa, nunca una sola persona.';

/** Lo que se lee cuando la clase no tiene a nadie anotado. */
const NO_HAY_ANOTADOS =
  'No hay nadie anotado en esta clase. La pregunta se contesto y la respuesta esta vacia: no ' +
  'es un fallo al leer, y no hay ninguna lista que pasar.';

/**
 * EL ESTADO CON EL QUE **LLEGO** CADA PERSONA, EN UN ATRIBUTO Y NO EN LA
 * FRASE.
 *
 * `null` y `false` se dibujan igual —los dos sin tildar— y es correcto que asi
 * sea: lo que la profesora tiene que decidir es quien vino, no de donde salia
 * el dato. Pero vienen de sitios DISTINTOS —`false` lo escribio un pasar lista
 * anterior, `null` es que nadie dijo nada todavia— y un test que no pueda
 * distinguirlos no puede probar que los dos llegan sin tildar.
 *
 * Por eso el estado previo viaja en un atributo propio: las afirmaciones son
 * de igualdad exacta y no de subcadena, que es como `not.toContain('0%')` pasa
 * en verde sobre un `100%`.
 */
function estadoPrevio(asistio: boolean | null): string {
  if (asistio === true) return 'vino';
  if (asistio === false) return 'falto';

  return 'sin-marcar';
}

/**
 * CON QUE TILDES NACE LA PANTALLA: con los que YA figuran como presentes.
 *
 * `=== true` y no `!== null`: un `asistio: false` es una respuesta —«no vino»—
 * y tildarlo seria inventar su presencia. Lo que se hereda es la marca de
 * quien consta que vino, que es justamente la que el reemplazo total borraria
 * si naciera en blanco.
 */
function presentesIniciales(alumnos: readonly AlumnoEnClase[]): Set<string> {
  return new Set(alumnos.filter((alumno) => alumno.asistio === true).map((a) => a.perfilId));
}

/**
 * AL LOGIN CUANDO EL TOKEN SE MUERE CON LA PANTALLA ABIERTA.
 *
 * Aqui eso es lo NORMAL y no lo raro: la lista se abre al empezar la clase y
 * se guarda al terminarla, con una hora de por medio. Enseñar el
 * «Unauthorized» crudo de la API seria mandar a mirar la red a alguien que lo
 * unico que tiene que hacer es volver a entrar.
 *
 * `SIN_QUERY` y no el query actual: esta pantalla no lee NADA de la barra de
 * direcciones —el turno va en el camino— asi que no hay estado que conservar,
 * y el nombre existe justamente para que eso sea una decision y no un `''`
 * copiado sin pensar.
 *
 * Es un hook y no una funcion suelta porque lo llaman los dos lados —el fallo
 * al LEER la lista y el fallo al GUARDARLA— y los dos tienen que ir al mismo
 * sitio. Sin exportarlo: Next 15 no deja que un `page.tsx` exporte nada que no
 * sea el `default`, y el error que da habla de `OmitWithTag` y no se parece en
 * nada a la causa.
 */
function useAlLoginSiCaduco(sesionCaducada: boolean, slug: string): void {
  const ruta = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!sesionCaducada) return;

    router.push(destinoDeLoginDesde(ruta, SIN_QUERY, slug));
  }, [sesionCaducada, router, ruta, slug]);
}

/**
 * LA LISTA CON LOS TILDES, Y VIVE EN UN COMPONENTE APARTE A PROPOSITO.
 *
 * Recibe los alumnos YA CARGADOS, asi que su estado inicial se siembra en el
 * primer render con la lista de verdad y no con un `undefined` que haya que
 * rellenar despues en un `useEffect`.
 *
 * ⚠️ Y SE SIEMBRA **UNA SOLA VEZ**, QUE ES LO QUE PROTEGE EL TRABAJO A MEDIO
 * HACER. Guardar invalida la consulta de alumnos (lo hace `usePasarLista`), y
 * TanStack puede traer la lista de nuevo con la pantalla abierta. Si cada
 * respuesta volviera a sembrar los tildes, un refetch en mitad del repaso
 * —mientras la profesora va tildando de pie en la sala— le borraria lo que
 * lleva hecho y lo dejaria como estaba en el servidor. El `key={turnoId}` de
 * quien lo monta es lo unico que la vuelve a sembrar, y solo cuando de verdad
 * es otra clase.
 */
function ListaParaMarcar({
  alumnos,
  turnoId,
  slug,
}: {
  alumnos: readonly AlumnoEnClase[];
  turnoId: string;
  slug: string;
}) {
  const guardar = usePasarLista(turnoId);
  const [tildados, setTildados] = useState(() => presentesIniciales(alumnos));
  const [confirmando, setConfirmando] = useState(false);

  const sesionCaducada = guardar.error !== null && guardar.error.esSesionCaducada;
  useAlLoginSiCaduco(sesionCaducada, slug);

  /**
   * LOS PRESENTES EN EL ORDEN DE LA LISTA, no en el de los toques.
   *
   * Recorrer el `Set` daria el orden en que la profesora fue tildando, que no
   * significa nada y cambia entre dos repasos identicos. Se recorre la lista
   * —que la API devuelve ordenada por nombre— y se filtra: el mismo repaso da
   * siempre el mismo cuerpo.
   */
  function presentesAMandar(): string[] {
    return alumnos.filter((alumno) => tildados.has(alumno.perfilId)).map((a) => a.perfilId);
  }

  function alternar(perfilId: string): void {
    // El cartel de «guardada» y el de un fallo hablan de la lista que se
    // mando: en cuanto se toca un tilde dejan de ser verdad. Quedarse ahi
    // diria «ya esta» encima de una lista que ya no es la guardada.
    guardar.reset();

    setTildados((antes) => {
      const siguiente = new Set(antes);
      if (siguiente.has(perfilId)) siguiente.delete(perfilId);
      else siguiente.add(perfilId);

      return siguiente;
    });
  }

  /**
   * EL BOTON DE GUARDAR, Y LA UNICA BIFURCACION DE LA PANTALLA.
   *
   * Con alguien tildado se manda y punto. Sin nadie tildado se PREGUNTA, por
   * lo dicho arriba: el cuerpo de «no vino nadie» y el de un dedo que roza el
   * boton son identicos, y lo unico que los distingue es que alguien conteste
   * una pregunta que dice en voz alta a cuanta gente abarca.
   */
  function intentarGuardar(): void {
    if (tildados.size === 0) {
      setConfirmando(true);
      return;
    }

    guardar.mutate(presentesAMandar());
  }

  const guardado = guardar.data;

  return (
    <div data-bloque="lista" className="flex flex-col gap-4">
      {/* Los dos numeros en atributos propios: «0 de 10» y «10 de 10» son la
          misma frase con un digito cambiado, y de reojo no se distinguen. */}
      <p
        data-resumen
        data-anotados={alumnos.length}
        data-tildados={tildados.size}
        className="text-sm text-slate-700"
      >
        Tildados {tildados.size} de {alumnos.length} anotados.
      </p>

      <ul className="flex flex-col gap-2">
        {alumnos.map((alumno) => (
          <li key={alumno.perfilId}>
            {/* La etiqueta ENVUELVE la casilla: el area pulsable es la fila
                entera y no un cuadradito de 13 pixeles, que es lo que se toca
                de pie, con el telefono en una mano y la gente esperando. */}
            <label
              data-alumno={alumno.perfilId}
              data-estado-previo={estadoPrevio(alumno.asistio)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <input
                type="checkbox"
                checked={tildados.has(alumno.perfilId)}
                onChange={() => alternar(alumno.perfilId)}
                className="h-5 w-5"
              />
              <span className="text-base text-slate-900">{alumno.nombreCompleto}</span>
            </label>
          </li>
        ))}
      </ul>

      {confirmando ? (
        <Confirmar
          /* La pregunta NOMBRA lo que va a pasar y A CUANTOS: «¿estas seguro?»
             no es una pregunta, es un tramite. */
          pregunta={`Marcar ausentes a los ${alumnos.length} anotados de esta clase`}
          detalle={
            'No tildaste a nadie, asi que se va a guardar que no vino ninguno. Es un resultado ' +
            'posible, pero reemplaza cualquier marca anterior, incluidos los check-in por QR.'
          }
          textoDeConfirmar="Marcar a todos ausentes"
          cargando={guardar.isPending}
          error={
            guardar.error === null ? undefined : `No se pudo pasar lista: ${guardar.error.message}`
          }
          alConfirmar={() => guardar.mutate([])}
          alCancelar={() => {
            setConfirmando(false);
            guardar.reset();
          }}
        />
      ) : (
        <div>
          {/* `cargando` deshabilita el boton: dos toques seguidos en un telefono
              con la red del gimnasio son dos peticiones, y la segunda reescribe
              la clase entera otra vez. */}
          <Boton type="button" cargando={guardar.isPending} onClick={intentarGuardar}>
            Guardar la lista
          </Boton>
        </div>
      )}

      {guardar.error !== null && !sesionCaducada && !confirmando && (
        <div data-fallo-al-guardar>
          {/* EL MOTIVO DE LA API, PALABRA POR PALABRA. Los dos rechazos que
              llegan aqui explican algo que esta pantalla no sabe —que la clase
              no empezo, o a quien le cancelaron la reserva mientras miraba— y
              cambiarlos por un «no se pudo» tira justo la parte util. */}
          <Aviso tono="error">No se pudo pasar lista: {guardar.error.message}</Aviso>
        </div>
      )}

      {guardado !== undefined && guardar.error === null && (
        /**
         * EL CARTEL DE GUARDADA SALE DE LA **RESPUESTA**, NO DE LO QUE SE
         * TILDO.
         *
         * El `POST` devuelve `AlumnoEnClase[]`: la clase entera ya marcada. No
         * es un 204. Contar sobre lo tildado seria repetirle a la profesora lo
         * que ella acaba de hacer; contar sobre la respuesta es decirle lo que
         * quedo escrito — y los dos numeros se separan de verdad el dia que a
         * alguien le cancelan la reserva entre que se leyo la lista y se
         * guardo.
         */
        <Aviso tono="exito" alerta>
          <span
            data-guardado
            data-presentes={guardado.filter((a) => a.asistio === true).length}
            data-ausentes={guardado.filter((a) => a.asistio === false).length}
          >
            Lista guardada: {guardado.filter((a) => a.asistio === true).length} presentes y{' '}
            {guardado.filter((a) => a.asistio === false).length} ausentes.
          </span>
        </Aviso>
      )}
    </div>
  );
}

export default function PaginaDePasarLista() {
  const { slug, turnoId } = useParams<{ slug: string; turnoId: string }>();

  const alumnos = useAlumnosDeLaClase(turnoId);
  const error = alumnos.error;
  const sesionCaducada = error instanceof ErrorDeApi && error.esSesionCaducada;

  useAlLoginSiCaduco(sesionCaducada, slug);

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Pasar lista</h1>

      <p data-como-funciona className="text-sm text-slate-600">
        {COMO_FUNCIONA}
      </p>

      {sesionCaducada && <Aviso tono="error">Tu sesion caduco. Te llevamos al login.</Aviso>}

      {alumnos.isPending && <p className="text-sm text-slate-500">Cargando…</p>}

      {error !== null && !sesionCaducada && (
        /* UN FALLO AL LEER NO ES UNA CLASE VACIA, y es la distincion mas cara
           de esta pantalla: un 404 dibujado como «no hay nadie anotado» le
           diria a la profesora que no tiene lista que pasar, y se iria. */
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">No se pudo leer la lista: {error.message}</Aviso>
          <Boton tono="secundario" onClick={() => void alumnos.refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {alumnos.data !== undefined && alumnos.data.length === 0 && (
        <div data-sin-anotados>
          <Aviso>{NO_HAY_ANOTADOS}</Aviso>
        </div>
      )}

      {alumnos.data !== undefined && alumnos.data.length > 0 && (
        // `key` por turno: es lo unico que vuelve a sembrar los tildes, y solo
        // cuando de verdad se esta mirando otra clase.
        <ListaParaMarcar key={turnoId} alumnos={alumnos.data} turnoId={turnoId} slug={slug} />
      )}
    </section>
  );
}
