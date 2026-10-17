'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import type { TurnoLibre, UsuarioDetalle } from '@boxadmin/shared';
import { Tabla, type ColumnaDeTabla } from '@/componentes/tabla';
import { Aviso, Boton, Tarjeta } from '@/componentes/ui';
import { useTurnosLibres } from '@/hooks/use-stats';
import { Seleccion } from './controles';

/**
 * DONDE HAY LUGAR PARA ESTA PERSONA. `GET /stats/turnos-libres`.
 *
 * ===========================================================================
 * POR QUE VIVE EN LA FICHA DE UNA PERSONA Y NO EN UNA PANTALLA PROPIA
 * ===========================================================================
 *
 * La pregunta que este reporte contesta la escribio el propio DTO:
 * «"donde meto a este alumno los martes", que es una pregunta de una sala
 * concreta». Es una pregunta sobre ALGUIEN, y la unica pantalla del panel que
 * tiene a alguien delante es esta.
 *
 * 1. UNA PANTALLA NUEVA SERIA UNA COPIA PEOR DEL LISTADO DE TURNOS, QUE YA
 *    EXISTE. Medido, no supuesto: `GET /turnos` acepta `soloLibres` —hay un
 *    `ParseBoolPipe` para el en `turnos.controller.ts`—, `TurnoPublico` trae
 *    `lugaresLibres`, y `admin/turnos/filtros.tsx` ya dibuja el selector
 *    «Lugar: Solo los que tienen lugar» junto a los de sala, fecha y
 *    profesora. O sea que «la lista de turnos con lugar» ES una pantalla del
 *    panel desde la Fase 8, con MAS columnas que este reporte —el nombre de la
 *    clase y la profesora— y con los filtros en la URL. Montar otra al lado
 *    seria poner dos listas parecidas que no coinciden y dejar que recepcion
 *    adivine cual mirar.
 *
 * 2. Y TAMPOCO HACIA FALTA ALIMENTAR EL REASIGNAR DE LA FASE 9 CON ESTO, que
 *    era la hipotesis mas razonable y resulto falsa al medirla.
 *    `PanelDeReasignar` ya pinta sus destinos como «fecha hora · Flow (7/10)»,
 *    y ese «Flow» es `TurnoPublico.nombre`. `TurnoLibre` NO TRAE EL NOMBRE DEL
 *    TURNO: sus nueve campos son `turnoId`, `salaId`, `salaNombre`, `fecha`,
 *    `horaInicio`, `horaFin`, `cupo`, `reservados` y `libres`. Como los
 *    destinos del reasignar estan acotados a UNA sala, `salaNombre` alli es una
 *    constante y `nombre` es lo unico que distingue un destino de otro:
 *    cambiar una fuente por la otra cambiaria «18:00 · Flow (7/10)» por
 *    «18:00 · Pilates (7/10)» repetido ocho veces. Y la ocupacion escrita, que
 *    es lo que ese panel gana con el cambio, YA LA TIENE. Seria pagar una
 *    perdida de informacion por algo que ya esta resuelto.
 *
 * 3. AQUI, EN CAMBIO, NO HAY NADA QUE CONTESTE LA PREGUNTA. La ficha dice que
 *    dias viene (`BloqueDeDiasFijos`), cuando no viene (`BloqueDeVacaciones`) y
 *    a que salas tiene acceso (`BloqueDeSalas`), y no dice en ningun sitio
 *    donde cabe. Hoy eso se contesta saliendo de la ficha, armando a mano los
 *    filtros del listado de turnos y volviendo — que es exactamente la clase de
 *    viaje que la Tarea 5 quito de en medio llevando los pendientes a la
 *    portada.
 *
 * 4. Y EL `salaId` DEL REPORTE CAE JUSTO SOBRE UN DATO QUE LA FICHA YA TIENE.
 *    `UsuarioDetalle.salas` son las salas de esta persona, y son exactamente
 *    las que evitan el 403 «El usuario no tiene acceso a la sala del turno
 *    destino» que ya documenta `bloque-anotados.tsx`. El filtro del reporte no
 *    hay que inventarlo: ya estaba en la pantalla.
 *
 * NO HACE FALTA NI UNA ENTRADA DE NAVEGACION NI UNA RUTA NUEVA, y no se agrega
 * ninguna. `admin/usuarios/[id]` ya existe y se llega a ella desde el listado
 * de personas y desde la lista de a quien llamar de la portada.
 *
 * NO LLEVA PUERTA DE ROL, y es una decision y no un olvido: el mismo
 * razonamiento que `PagosPendientes`. `/stats/turnos-libres` pide
 * `ADMIN_OPERATIVO`, que es el rol MINIMO con el que `admin/layout.tsx` deja
 * entrar al panel, asi que cualquiera que vea esta ficha puede pedir este
 * reporte. Una comprobacion que nunca puede fallar es ruido que el proximo
 * lector confundiria con una defensa.
 *
 * TAMPOCO SE PIDE SOLO PARA LOS ALUMNOS. `reservas.controller.ts` no mira el
 * rol del perfil que se anota —se busco y no esta—, asi que una profesora que
 * ademas toma clases se anota igual que cualquiera. Esconder el bloque en su
 * ficha seria inventar una regla que la API no tiene.
 *
 * ===========================================================================
 * EL REPORTE SE PIDE AL ABRIRLO, NO AL MONTAR LA FICHA
 * ===========================================================================
 *
 * Es el patron que ya usa `FormularioDeAnotar` en la ficha de un turno, y por
 * el mismo motivo escrito alli: «un hook que no esta montado no pide nada, y
 * asi no hay ningun `enabled` que alguien pueda invertir sin querer». La ficha
 * de una persona se abre todo el dia —para cambiar un telefono, para cargar
 * unas vacaciones, para ver si pago— y en casi ninguna de esas visitas hace
 * falta saber donde hay lugar. Este reporte recorre los turnos de tres meses y
 * sus reservas; cobrarselo a cada visita de la ficha es cobrar una consulta
 * cara por una pregunta que nadie hizo.
 *
 * LA CONSECUENCIA BUENA, Y ES COMPROBABLE: la lista blanca de
 * `PETICIONES_AL_ABRIR_LA_FICHA` no cambia. Las cinco peticiones del montaje
 * siguen siendo cinco. Hay un test en este mismo spec que fija las DOS
 * mitades —que al montar no se pide, y que al abrir se pide exactamente una
 * vez—, porque la primera mitad sola tambien pasaria si el reporte no se
 * pidiera jamas.
 *
 * ===========================================================================
 * LOS FILTROS VIVEN EN `useState` Y NO EN LA URL
 * ===========================================================================
 *
 * Al reves que en el listado de turnos y en el de personas, y es a proposito.
 * Esta ficha declara por escrito que no tiene query —`destinoDeLoginDesde(ruta,
 * SIN_QUERY, slug)` en `page.tsx`, con el comentario «esta pantalla no tiene
 * query que conservar»— y ademas no monta la frontera de Suspense que
 * `useSearchParams` obliga a poner. Meter dos filtros en la URL desde aqui
 * romperia las dos cosas en silencio: el `volverA` del login se los comeria sin
 * avisar, y `next build` fallaria lejos de este archivo con el error
 * «missing-suspense-with-csr-bailout».
 */

/**
 * Los horizontes que se pueden pedir, Y EL DE 24 ESTA A PROPOSITO.
 *
 * `MAX_MESES_ADELANTE` vale 12 en `stats.service.ts` y el tope NO esta en el
 * DTO: pedir 24 no es un 400, es «te doy uno». Ofrecer la opcion es ofrecer la
 * pregunta completa —"¿y mas adelante?"— y dejar que el servidor conteste lo
 * que de verdad puede mirar, que es lo que la respuesta dice en
 * `mesesAdelante`. Quitarla no evitaria el recorte: lo escondería, porque el
 * tope sigue estando y nadie podria verlo funcionar.
 *
 * El piso es 1 y ese SI esta en el DTO (`@Min(1)`), asi que no hay opcion de 0:
 * seria un 400 pintado como una averia.
 */
const MESES_QUE_SE_PUEDEN_PEDIR: readonly number[] = [1, 3, 6, 12, 24];

/**
 * Tres, el mismo que el del servidor cuando no se lo dicen.
 *
 * `MESES_ADELANTE_POR_DEFECTO` en `stats.service.ts`, y el motivo esta escrito
 * alli: «Tres es el horizonte con el que el motor de recurrencia publica meses
 * desde la Fase 2». Se manda igualmente en vez de omitir el parametro, porque
 * esta pantalla ENSEÑA lo que pidio al lado de lo que se miro: sin pedirlo no
 * habria con que comparar, y el recorte dejaria de verse.
 */
const MESES_POR_DEFECTO = 3;

/** Lo que se lee cuando el reporte contesto y no hay ni un turno con lugar. */
export const NO_HAY_DONDE_METERLA =
  'No hay ningun turno con lugar en el horizonte que miramos. La pregunta se contesto y la ' +
  'respuesta esta vacia: no es que no hayamos podido mirar.';

/**
 * LA ADVERTENCIA DE LA SALA AJENA, que es la unica forma de 403 que esta
 * pantalla puede ver venir.
 *
 * Con «Todas las salas del gimnasio» puesto, el reporte contesta por el
 * gimnasio entero y puede nombrar salas a las que ESTA persona no tiene acceso.
 * Anotarla alli es el 403 «El usuario no tiene acceso a la sala del turno
 * destino» que documenta `bloque-anotados.tsx`.
 *
 * SE MARCA Y NO SE ESCONDE. Escondiendo esas filas, «no hay lugar en ningun
 * lado» y «hay lugar pero antes hay que darle la sala» se leerian igual, y la
 * segunda tiene arreglo a dos bloques de distancia: `BloqueDeSalas`, en esta
 * misma ficha.
 */
export const NO_TIENE_ESTA_SALA = 'No tiene acceso a esta sala';

/** Lo que se lee cuando la lectura del reporte falla. */
export const NO_SE_PUDO_MIRAR = 'No se pudo mirar donde hay lugar: ';

/**
 * QUE ES ESTA LISTA, dicho antes de la tabla.
 *
 * Importa decir que empieza HOY porque el reporte no acepta un `desde`: el
 * service arranca en `comienzoDeHoyUtc()` y no hay forma de pedirle el mes que
 * viene a secas. Sin la frase, una lista que no enseña el martes pasado se lee
 * como un hueco del gimnasio y no como el limite de la pregunta.
 */
export const DE_HOY_EN_ADELANTE =
  'Son los turnos con lugar de hoy en adelante. No se puede pedir una fecha de arranque ' +
  'distinta: el reporte siempre empieza hoy.';

/**
 * CUANTOS LUGARES QUEDAN, Y SALE DE `libres` TAL CUAL LO MANDA EL SERVIDOR.
 *
 * NUNCA `cupo - reservados`. Hoy las dos cuentas dan lo mismo porque el service
 * las hace juntas, y justamente por eso recalcular aqui no se notaria: el dia
 * que difieran —un cupo bajado entre dos lecturas, un cambio en que reservas
 * cuentan como vivas— la pantalla estaria enseñando un numero inventado por el
 * navegador con la misma cara de exactitud que el del servidor. Quien sabe si
 * una cancelacion recuperable libera el lugar es la API, no esta funcion. Hay
 * un test que siembra los dos valores desalineados a proposito y fija cual se
 * pinta.
 */
function lugaresQueQuedan(turno: TurnoLibre): number {
  return turno.libres;
}

/**
 * SOLO LOS QUE TIENEN LUGAR, Y ES UNA SEGUNDA LINEA Y NO UNA DUPLICACION.
 *
 * El service ya los filtra —«Un turno lleno no es un turno libre»— y aun asi se
 * filtra aqui, porque lo que esta pantalla AFIRMA es más fuerte que lo que el
 * endpoint promete: cada fila dice «quedan N lugares» debajo de un titulo que
 * dice donde hay lugar. Una fila con «quedan 0» seria una mentira escrita, y la
 * respuesta viaja por un cache de cinco minutos y por un contrato que esta fase
 * no controla.
 *
 * `> 0` y no `!== 0`, igual que el `<= 0` del service y por el mismo motivo que
 * el comentario de alli: un cupo bajado por debajo de las reservas ya hechas da
 * un resto negativo, y «quedan -2 lugares» tampoco es un turno con lugar.
 */
function soloConLugar(turnos: readonly TurnoLibre[]): TurnoLibre[] {
  return turnos.filter((turno) => lugaresQueQuedan(turno) > 0);
}

/**
 * Las columnas, declaradas y cerradas.
 *
 * `TurnoLibre` trae ademas `turnoId` y `salaId`. El primero no se pinta: es el
 * destino del enlace de la fila. El segundo tampoco: lo unico que se hace con
 * el es decidir si esta persona tiene acceso a esa sala, y un identificador
 * delante del mostrador no le sirve a nadie.
 *
 * LO QUE NO ESTA PORQUE NO EXISTE: el nombre de la clase. `TurnoLibre` no lo
 * trae —el listado de turnos si, via `TurnoPublico.nombre`— y no se va a buscar
 * a un segundo endpoint para rellenarlo. Por eso cada fila lleva a la ficha del
 * turno, donde el nombre esta.
 */
function columnas(salasDeLaPersona: ReadonlySet<string>): readonly ColumnaDeTabla<TurnoLibre>[] {
  return [
    {
      encabezado: 'Sala',
      celda: (turno) => (
        // `data-turno` con el `turnoId`: es el enganche con el que el spec
        // encuentra LA fila de un turno sin buscarla por su hora ni por su
        // posicion. Una busqueda por texto ata el test a la ortografia y un
        // indice ata el test al orden.
        <span data-turno={turno.turnoId} className="flex flex-col">
          <span data-sala>{turno.salaNombre}</span>
          {!salasDeLaPersona.has(turno.salaId) && (
            <span data-sala-ajena className="text-xs text-amber-700">
              {NO_TIENE_ESTA_SALA}
            </span>
          )}
        </span>
      ),
    },
    { encabezado: 'Fecha', celda: (turno) => <span data-fecha>{turno.fecha}</span> },
    {
      encabezado: 'Hora',
      celda: (turno) => (
        <span data-hora>
          {turno.horaInicio} a {turno.horaFin}
        </span>
      ),
    },
    {
      encabezado: 'Lugares que quedan',
      // En un atributo propio y como numero exacto: «1» esta dentro de «11» y
      // un `toContain` pasaria en verde sobre la fila equivocada.
      celda: (turno) => <span data-libres>{lugaresQueQuedan(turno)}</span>,
    },
    {
      // Las DOS cifras y no solo el resto: el admin necesita saber de cuanto es
      // el turno para decidir si mete a alguien mas. Es la misma lectura que la
      // columna «Ocupación» del listado de turnos.
      encabezado: 'Ocupación',
      celda: (turno) => (
        <span data-ocupacion>
          {turno.reservados}/{turno.cupo}
        </span>
      ),
    },
  ];
}

/** El reporte ya pedido: los dos filtros, el horizonte y la tabla. */
function DondeHayLugar({ usuario }: { usuario: UsuarioDetalle }) {
  const { slug } = useParams<{ slug: string }>();

  const [salaId, setSalaId] = useState('');
  const [mesesPedidos, setMesesPedidos] = useState(String(MESES_POR_DEFECTO));

  const pedidos = Number(mesesPedidos);

  /**
   * EL `salaId` VIAJA TAL CUAL, incluida la cadena vacia.
   *
   * `useTurnosLibres` ya sabe que una cadena vacia no es un filtro: la pasa por
   * `sinVacio`, que decide a la vez si el parametro sale en la URL y bajo que
   * clave se cachea. Un `salaId === '' ? undefined : salaId` escrito aqui
   * seria una SEGUNDA decision sobre lo mismo, y el dia que las dos no
   * coincidieran la pantalla pediria una cosa y guardaria otra.
   */
  const { data, isPending, error, refetch } = useTurnosLibres(salaId, pedidos);

  const salasDeLaPersona = new Set(usuario.salas.map((sala) => sala.id));

  const opcionesDeSala = [
    // «Del gimnasio» y no «Todas»: las de abajo son las de ESTA persona, y sin
    // esa palabra la opcion vacia se leeria como «todas las suyas», que es otra
    // consulta y otra respuesta.
    { valor: '', texto: 'Todas las salas del gimnasio' },
    ...usuario.salas.map((sala) => ({ valor: sala.id, texto: sala.nombre })),
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Seleccion
          etiqueta="Sala"
          id="turnos-libres-sala"
          opciones={opcionesDeSala}
          value={salaId}
          onChange={(evento) => setSalaId(evento.target.value)}
        />
        <Seleccion
          etiqueta="Meses a mirar"
          id="turnos-libres-meses"
          opciones={MESES_QUE_SE_PUEDEN_PEDIR.map((meses) => ({
            valor: String(meses),
            texto: `${meses}`,
          }))}
          value={mesesPedidos}
          onChange={(evento) => setMesesPedidos(evento.target.value)}
        />
      </div>

      {/* Fuera de todas las ramas: la frase que explica de cuando es la lista
          no puede depender de que la lista haya llegado. */}
      <p data-de-hoy-en-adelante className="text-sm text-slate-600">
        {DE_HOY_EN_ADELANTE}
      </p>

      {isPending && <p className="text-sm text-slate-500">Buscando donde hay lugar…</p>}

      {error !== null && (
        <div data-fallo-al-leer className="flex flex-col items-start gap-2">
          <Aviso tono="error">
            {NO_SE_PUDO_MIRAR}
            {error.message}
          </Aviso>
          {/* Un fallo de red se arregla solo cuando vuelve la red, y el admin
              esta al telefono: tiene que poder reintentar sin perder la ficha. */}
          <Boton type="button" tono="secundario" onClick={() => void refetch()}>
            Reintentar
          </Boton>
        </div>
      )}

      {data !== undefined && (
        <>
          {/* LOS MESES QUE SE MIRARON, QUE SALEN DE LA RESPUESTA Y NUNCA DEL
              PEDIDO. `mesesAdelante` vuelve YA RECORTADO contra el tope de 12
              del service, asi que pintar `pedidos` aqui le diria a quien pidio
              dos anos que miramos dos anos, y su lista corta se leeria como «no
              hay mas turnos» en vez de como «no miramos mas alla». */}
          <p className="text-sm text-slate-700">
            Miramos los proximos <span data-meses-mirados>{data.mesesAdelante}</span> meses.
          </p>

          {pedidos > data.mesesAdelante && (
            // La otra mitad de lo mismo, y la que de verdad cambia una
            // decision: sin ella, el recorte es invisible para quien no se
            // acuerde de que pidio.
            <p data-recorte className="text-sm text-amber-700">
              Pediste {pedidos} meses y se miraron {data.mesesAdelante}: es el maximo que el reporte
              mira de una vez. Mas alla de ahi no sabemos si hay lugar o no.
            </p>
          )}

          <Tabla
            etiqueta="Donde hay lugar"
            columnas={columnas(salasDeLaPersona)}
            filas={soloConLugar(data.turnos)}
            claveDeFila={(turno) => turno.turnoId}
            /* LA FILA ENTERA LLEVA A LA FICHA DEL TURNO, y aqui se puede
               —al reves que en la lista de a quien llamar de la portada, que
               no podia—. `TurnoLibre.turnoId` es el id de `Turno`, que es
               exactamente lo que la ruta `admin/turnos/[id]` le pasa a
               `useTurno` → `GET /turnos/:id`. No hace falta traducir ningun
               identificador ni pedir una segunda lista. Y es el sitio al que
               hay que ir: alli esta «Anotar a alguien», y alli esta tambien el
               nombre de la clase, que este reporte no trae. */
            enlaceDeFila={(turno) => `/${slug}/admin/turnos/${turno.turnoId}`}
            vacio={
              <div data-sin-turnos>
                <Aviso>{NO_HAY_DONDE_METERLA}</Aviso>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}

export function BloqueDeTurnosLibres({ usuario }: { usuario: UsuarioDetalle }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <Tarjeta>
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Donde hay lugar
        </h2>

        {abierto ? (
          <DondeHayLugar usuario={usuario} />
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-sm text-slate-600">
              Los turnos con lugar de hoy en adelante, para saber donde se puede anotar a{' '}
              {usuario.nombreCompleto}.
            </p>
            <Boton type="button" onClick={() => setAbierto(true)}>
              Buscar donde hay lugar
            </Boton>
          </div>
        )}
      </div>
    </Tarjeta>
  );
}
