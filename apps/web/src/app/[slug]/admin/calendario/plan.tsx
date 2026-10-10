'use client';

import type {
  Conflicto,
  Exclusion,
  PlanDeMes,
  ReservaPlanificada,
  ResumenDelPlan,
  TipoConflicto,
  TipoExclusion,
  TurnoPlanificado,
  UsuarioResumen,
} from '@boxadmin/shared';
import { Tabla } from '@/componentes/tabla';
import { Aviso } from '@/componentes/ui';
import { type FiltrosDeUsuarios, useUsuarios } from '@/hooks/use-usuarios';

/**
 * LO QUE EL PLAN DICE, Y CON QUE JERARQUIA SE DICE.
 *
 * El orden de esta pantalla no es decorativo: arriba los cuatro numeros, debajo
 * los CONFLICTOS en abierto, despues las exclusiones, y al final —plegadas— las
 * listas largas. Es el orden de lo que exige una decision a lo que solo informa.
 *
 * NINGUN IDENTIFICADOR DE ALUMNO SE PINTA. El plan trae `reservasACrear` con el
 * `perfilId` de cada persona y `turnosACrear` con el `profesorId`, pero esta
 * pantalla solo necesita CONTARLOS. Un id en el DOM no lo lee nadie y se lleva
 * por delante la misma frontera que la Fase 0 se ocupo de cerrar con el
 * `tenantId` de las salas: lo que cruza al navegador queda en el codigo fuente
 * de la pagina, en cualquier captura y en el inspector del mostrador. Hay un
 * test que lo fija sobre el marcado entero.
 */

// ---------------------------------------------------------------------------
// Los nombres de los enums, que son del contrato y no de la pantalla
// ---------------------------------------------------------------------------

/**
 * El orden es el de la lista, y es deliberado: de lo mas accionable a lo menos.
 * Un cupo lleno lo resuelve el admin moviendo a alguien; que la sala no tenga
 * cupo base es un dato de configuracion que afecta al mes entero.
 */
const ORDEN_DE_CONFLICTOS: readonly TipoConflicto[] = [
  'CUPO_LLENO',
  'FUERA_DE_PACK',
  'SALA_SIN_CUPO_BASE',
];

const CONFLICTOS_LEGIBLES: Record<TipoConflicto, string> = {
  CUPO_LLENO: 'Cupo lleno',
  FUERA_DE_PACK: 'Fuera del pack',
  SALA_SIN_CUPO_BASE: 'La sala no tiene cupo base',
};

const ORDEN_DE_EXCLUSIONES: readonly TipoExclusion[] = ['AUSENCIA_SALA', 'VACACION_ALUMNO'];

const EXCLUSIONES_LEGIBLES: Record<TipoExclusion, string> = {
  AUSENCIA_SALA: 'Ausencia de la sala',
  VACACION_ALUMNO: 'Vacaciones del alumno',
};

// ---------------------------------------------------------------------------
// El resumen
// ---------------------------------------------------------------------------

function Numero({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{etiqueta}</dt>
      <dd className="text-xl font-semibold text-slate-900">{valor}</dd>
    </div>
  );
}

/**
 * Los cuatro numeros salen de `resumen` y NO de contar las listas.
 *
 * Es el recuento que el planificador emitio junto con el plan que se va a
 * publicar. Contarlo aqui por nuestra cuenta abriria la puerta a que la
 * pantalla ensene un numero y la API aplique otro, que es la misma razon por la
 * que esta pantalla no pide `GET .../conflictos`.
 */
function Resumen({ resumen }: { resumen: ResumenDelPlan }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Numero etiqueta="Turnos" valor={resumen.turnos} />
      <Numero etiqueta="Reservas" valor={resumen.reservas} />
      <Numero etiqueta="Conflictos" valor={resumen.conflictos} />
      <Numero etiqueta="Exclusiones" valor={resumen.exclusiones} />
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Los conflictos
// ---------------------------------------------------------------------------

/** Lo que comparten un conflicto y una exclusion a la hora de pintarlos. */
interface Ficha {
  perfilId: string | null;
  fecha: string;
  detalle: string;
}

/**
 * EL NOMBRE DE QUIEN, cuando lo hay.
 *
 * Un conflicto que no nombra a quien afecta no se puede accionar: el contrato
 * dice que los conflictos son las unicas situaciones que EXIGEN una decision
 * humana, y sin saber de quien se trata el humano no puede decidir. El nombre
 * sale de `GET /usuarios`, que ya existe y ya esta en `useUsuarios`.
 *
 * Tres casos, y los tres importan:
 *
 *  - `perfilId: null` —el caso de `SALA_SIN_CUPO_BASE`, que es de la sala y no
 *    de nadie—: no hay nombre que poner y NO SE INVENTA uno.
 *  - El id no esta en la lista —un alumno dado de baja, por ejemplo—: la ficha
 *    se pinta IGUAL, sin nombre. Que alguien se de de baja no puede hacer
 *    desaparecer un conflicto de la pantalla.
 *  - Esta: se pinta el nombre.
 *
 * Lo que se pinta es el NOMBRE, nunca el id. El id es la clave de busqueda y se
 * queda en memoria: hay un test de centinelas que lo fija sobre el marcado.
 */
function ListaDeFichas({
  fichas,
  nombres,
}: {
  fichas: readonly Ficha[];
  nombres: ReadonlyMap<string, string>;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {fichas.map((ficha, indice) => {
        const nombre = ficha.perfilId === null ? undefined : nombres.get(ficha.perfilId);

        return (
          // Ni los conflictos ni las exclusiones tienen id en el contrato: no son
          // filas de una tabla, son hallazgos de un calculo. La clave es la
          // posicion, y la lista no se reordena ni se filtra en el cliente.
          <li key={`${ficha.fecha}-${indice}`} className="text-sm text-slate-700">
            <span className="font-mono text-xs text-slate-500">{ficha.fecha}</span>{' '}
            {nombre !== undefined && <span className="font-medium text-slate-900">{nombre}: </span>}
            {ficha.detalle}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * LOS CONFLICTOS, EN ABIERTO Y AGRUPADOS POR TIPO.
 *
 * En abierto porque un conflicto EXIGE una decision humana antes de publicar:
 * detras de un "ver detalles" es algo que nadie ve, y el mes se publica con dos
 * alumnos fuera sin que nadie lo haya decidido.
 *
 * Agrupados porque "14 conflictos" no dice nada y "12 de cupo lleno y 2 fuera
 * de pack" son dos problemas distintos con dos soluciones distintas.
 */
function Conflictos({
  conflictos,
  nombres,
}: {
  conflictos: readonly Conflicto[];
  nombres: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-label="Conflictos" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-900">Conflictos</h2>

      {conflictos.length === 0 ? (
        // El hueco en blanco se lee igual que "todavia no cargo". Decirlo es
        // parte de la respuesta.
        <Aviso tono="exito">Sin conflictos: no hay ninguna decision pendiente.</Aviso>
      ) : (
        ORDEN_DE_CONFLICTOS.map((tipo) => {
          const delTipo = conflictos.filter((cada) => cada.tipo === tipo);
          if (delTipo.length === 0) return null;

          return (
            <div key={tipo} className="flex flex-col gap-1">
              <h3 className="text-sm font-medium text-red-800">
                {CONFLICTOS_LEGIBLES[tipo]} ({delTipo.length})
              </h3>
              <ListaDeFichas fichas={delTipo} nombres={nombres} />
            </div>
          );
        })
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Las exclusiones
// ---------------------------------------------------------------------------

/**
 * LAS EXCLUSIONES VAN APARTE, y esa es toda la razon de que exista esta seccion.
 *
 * El contrato las separa de los conflictos a proposito: «un mes con tres
 * alumnos de vacaciones produciria decenas de "conflictos" que nadie tiene que
 * resolver y que esconderian los dos que si». Mezclarlas aqui seria deshacer
 * esa decision en la ultima capa.
 *
 * Plegadas, y con el recuento en el titulo: son informativas y suelen ser
 * muchas. Lo que no pueden hacer es empujar los conflictos fuera de pantalla.
 */
function Exclusiones({
  exclusiones,
  nombres,
}: {
  exclusiones: readonly Exclusion[];
  nombres: ReadonlyMap<string, string>;
}) {
  return (
    <section aria-label="Exclusiones" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-slate-900">Exclusiones</h2>

      <p className="text-sm text-slate-600">
        Fechas que no generan reserva porque alguien cargo un dato a proposito —una ausencia de la
        sala o las vacaciones de un alumno—. Son informativas: no hay nada que decidir.
      </p>

      {exclusiones.length === 0 ? (
        <p className="text-sm text-slate-500">Ninguna fecha quedo excluida.</p>
      ) : (
        <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium text-slate-800">
            Ver las {exclusiones.length} fechas excluidas
          </summary>

          <div className="flex flex-col gap-2 pt-2">
            {ORDEN_DE_EXCLUSIONES.map((tipo) => {
              const delTipo = exclusiones.filter((cada) => cada.tipo === tipo);
              if (delTipo.length === 0) return null;

              return (
                <div key={tipo} className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium text-slate-700">
                    {EXCLUSIONES_LEGIBLES[tipo]} ({delTipo.length})
                  </h3>
                  <ListaDeFichas fichas={delTipo} nombres={nombres} />
                </div>
              );
            })}
          </div>
        </details>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Las listas largas
// ---------------------------------------------------------------------------

const COLUMNAS_DE_TURNOS = [
  { encabezado: 'Fecha', celda: (turno: TurnoPlanificado) => turno.fecha },
  { encabezado: 'Turno', celda: (turno: TurnoPlanificado) => turno.nombre },
  {
    encabezado: 'Horario',
    celda: (turno: TurnoPlanificado) => `${turno.horaInicio}–${turno.horaFin}`,
  },
  { encabezado: 'Cupo', celda: (turno: TurnoPlanificado) => turno.cupo },
  {
    encabezado: 'Profesora',
    // El `profesorId` NO se pinta: es un identificador, y lo que el admin
    // necesita saber de un vistazo es si el turno queda cubierto o huerfano.
    celda: (turno: TurnoPlanificado) => (turno.profesorId === null ? 'Sin asignar' : 'Asignada'),
  },
];

interface FranjaDeReservas {
  clave: string;
  fecha: string;
  horaInicio: string;
  cuantas: number;
}

/**
 * Las reservas, CONTADAS POR FRANJA y no una por alumno.
 *
 * Una fila por reserva serian cientos de filas y, sobre todo, obligaria a
 * pintar algo que identifique a cada alumno para que la fila signifique algo:
 * justo el dato que no tiene por que viajar al DOM. Agrupadas por fecha y hora,
 * la lista dice lo unico que el admin mira antes de publicar —cuanta gente
 * entra en cada turno— y no dice quien.
 */
function porFranja(reservas: readonly ReservaPlanificada[]): FranjaDeReservas[] {
  const cuenta = new Map<string, FranjaDeReservas>();

  for (const reserva of reservas) {
    const clave = `${reserva.fecha} ${reserva.horaInicio}`;
    const franja = cuenta.get(clave);

    if (franja === undefined)
      cuenta.set(clave, {
        clave,
        fecha: reserva.fecha,
        horaInicio: reserva.horaInicio,
        cuantas: 1,
      });
    else franja.cuantas += 1;
  }

  return [...cuenta.values()].sort((a, b) => a.clave.localeCompare(b.clave));
}

const COLUMNAS_DE_RESERVAS = [
  { encabezado: 'Fecha', celda: (franja: FranjaDeReservas) => franja.fecha },
  { encabezado: 'Hora', celda: (franja: FranjaDeReservas) => franja.horaInicio },
  { encabezado: 'Reservas', celda: (franja: FranjaDeReservas) => franja.cuantas },
];

/**
 * PLEGADAS DE ENTRADA.
 *
 * Un mes de una sala son decenas de turnos y cientos de reservas. Desplegadas,
 * empujan los conflictos —lo unico que exige una decision— fuera de la pantalla,
 * y el recuento que de verdad se mira ya esta arriba, en el resumen.
 *
 * `<details>` y no un `useState`: el plegado es estado de la pagina, no de la
 * aplicacion, y el navegador ya sabe hacerlo con teclado y con lector de
 * pantalla sin que nadie escriba un `aria-expanded`.
 */
function Listas({ plan }: { plan: PlanDeMes }) {
  const franjas = porFranja(plan.reservasACrear);

  return (
    <div className="flex flex-col gap-2">
      <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">
          Turnos a crear ({plan.turnosACrear.length})
        </summary>
        <div className="pt-2">
          <Tabla
            columnas={COLUMNAS_DE_TURNOS}
            filas={plan.turnosACrear}
            claveDeFila={(turno) => `${turno.fecha} ${turno.horaInicio} ${turno.nombre}`}
            vacio={<p className="text-sm text-slate-500">No hay ningun turno nuevo que crear.</p>}
          />
        </div>
      </details>

      <details className="rounded-xl border border-slate-200 bg-white px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">
          Reservas a crear ({plan.reservasACrear.length})
        </summary>
        <div className="pt-2">
          <Tabla
            columnas={COLUMNAS_DE_RESERVAS}
            filas={franjas}
            claveDeFila={(franja) => franja.clave}
            vacio={<p className="text-sm text-slate-500">No hay ninguna reserva que anotar.</p>}
          />
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * SIN FILTROS, y es deliberado.
 *
 * Hay que poder nombrar a CUALQUIER perfil que aparezca en un conflicto, y un
 * filtro por sala o por `activo` dejaria fuera justo los casos raros: el alumno
 * que acaban de dar de baja sigue teniendo rutinas que generan conflictos, y
 * ese conflicto hay que resolverlo igual.
 *
 * Constante de modulo y no `{}` en linea: es la clave de la consulta.
 */
const TODAS_LAS_PERSONAS: FiltrosDeUsuarios = {};

/** `perfilId` -> nombre. Los que no estan, no estan: no se inventa nada. */
function nombresPorPerfil(usuarios: readonly UsuarioResumen[] | undefined): Map<string, string> {
  const mapa = new Map<string, string>();

  for (const usuario of usuarios ?? []) mapa.set(usuario.perfilId, usuario.nombreCompleto);

  return mapa;
}

export function PlanDelMes({ plan }: { plan: PlanDeMes }) {
  /**
   * La cuarta peticion de la pantalla, y la unica que no es del calendario.
   *
   * No se espera a que llegue para pintar: los conflictos salen igual sin
   * nombre y el nombre aparece cuando la lista responde. Un conflicto que no se
   * ve hasta que carga otra cosa es un conflicto que alguien se pierde.
   *
   * No se pide el detalle de cada perfil uno a uno: serian N peticiones para un
   * dato que la lista ya trae entero, y la lista ya esta en la cache del panel.
   */
  const { data: usuarios } = useUsuarios(TODAS_LAS_PERSONAS);
  const nombres = nombresPorPerfil(usuarios);

  return (
    <div className="flex flex-col gap-4">
      <Resumen resumen={plan.resumen} />
      <Conflictos conflictos={plan.conflictos} nombres={nombres} />
      <Exclusiones exclusiones={plan.exclusiones} nombres={nombres} />
      <Listas plan={plan} />
    </div>
  );
}
