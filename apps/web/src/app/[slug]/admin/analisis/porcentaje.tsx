import type { MetricasOperativas, Porcentaje as PorcentajeDelContrato } from '@boxadmin/shared';

/**
 * COMO SE PINTA UN PORCENTAJE SIN MENTIR. Es el corazon de esta fase.
 *
 * `Porcentaje` manda SIEMPRE el numerador y el denominador, y el contrato dice
 * por escrito por que:
 *
 * > Sin ellos, un 0% y un "no hay datos" se ven igual, y son cosas distintas:
 * > `denominador: 0` significa que la pregunta no se puede contestar, no que la
 * > respuesta sea cero.
 *
 * Una ocupacion pintada como **0%** le dice al dueño que no vino nadie; la
 * verdad puede ser que **no hubo nada a lo que venir** —un mes sin turnos, un
 * mes que todavia no empezo—. Los dos casos se ven igual en cuanto alguien
 * escribe `porcentaje ?? 0`, y a partir de ahi el panel entero es un
 * generador de conclusiones falsas: el admin ve una columna de ceros y cree
 * que se le esta yendo la gente.
 *
 * POR ESO LOS TRES NUMEROS ESTAN A LA VISTA Y NO SOLO EL GRANDE. No es
 * decoracion: es la unica forma de que quien mira pueda ver que «50%» son dos
 * reservas de cuatro y no cien de doscientas, que son dos hechos muy
 * distintos para decidir algo.
 *
 * Y POR ESO NO HAY LIBRERIA DE GRAFICOS. `div`s y Tailwind. Es una decision
 * cerrada de la spec, y la razon principal es justamente esta: una libreria
 * empuja a esconder la fraccion detras del numero grande, que es el error que
 * esta pantalla existe para no cometer.
 *
 * EL PORCENTAJE ES EL DEL SERVIDOR, SIEMPRE. Esta pantalla no divide. El
 * `porcentaje` que llega es el que se pinta aunque no cuadre con su fraccion:
 * quien calcula es `porcentajeDe` en `stats.service.ts`, y dos
 * implementaciones del mismo numero son la forma conocida de que la columna de
 * septiembre y el numero grande de septiembre acaben discrepando sin que nadie
 * sepa cual de las dos creer.
 */

/** Lo que se lee cuando la pregunta no se puede contestar. */
export const SIN_DATOS = 'Sin datos';

/**
 * El numero grande: el porcentaje DEL SERVIDOR, o que no se puede calcular.
 *
 * Se ramifica por `porcentaje === null` y NO por `denominador === 0`, aunque
 * el contrato los ate («`null` cuando el denominador es cero»): el campo que
 * se pinta es el que decide si se puede pintar. Preguntar por el denominador
 * seria recalcular desde este lado la decision que el servidor ya tomo, que es
 * la misma puerta por la que entra el `porcentaje ?? 0`.
 */
export function textoDelNumero(dato: PorcentajeDelContrato): string {
  return dato.porcentaje === null ? SIN_DATOS : `${dato.porcentaje}%`;
}

/** La fraccion, tal cual: «3 de 4». Va siempre, tambien con el cero. */
export function textoDeLaFraccion(dato: PorcentajeDelContrato): string {
  return `${dato.numerador} de ${dato.denominador}`;
}

/** Las cinco, y ni una mas. La clave es la del contrato. */
export type ClaveDeMetrica = keyof Pick<
  MetricasOperativas,
  'ocupacion' | 'asistencia' | 'cobranza' | 'cancelacionRecuperable' | 'cancelacionDefinitiva'
>;

export interface DescripcionDeMetrica {
  clave: ClaveDeMetrica;
  titulo: string;
  /** SOBRE QUE se calcula: el denominador, dicho con palabras. */
  sobre: string;
  /** Lo que hay que saber ademas para no leer mal el numero. */
  nota?: string;
}

/**
 * LAS CINCO METRICAS DEL OPERATIVO, con lo que mide cada una ESCRITO AL LADO.
 *
 * Los textos salen de `StatsService.metricasDelMes`, leidos uno por uno, no
 * del nombre del campo:
 *
 * - OCUPACION: reservas vivas sobre la suma de los cupos DE LOS TURNOS (no el
 *   `cupoBase` de la sala, que es solo el valor con el que se crea un turno).
 * - ASISTENCIA: presentes sobre las reservas vivas QUE FUERON MARCADAS. El
 *   denominador NO son todas las reservas: ver `nota`.
 * - COBRANZA: alumnos con pack al dia AL CERRAR ESE MES —no hoy— sobre los que
 *   tienen pack.
 * - LAS DOS CANCELACIONES: cada tipo sobre TODAS las reservas del mes, vivas y
 *   canceladas. Comparten denominador, y nunca se suman entre si: la
 *   recuperable es alguien que reprograma y la definitiva es alguien que se
 *   esta yendo, y mezclarlas esconde lo unico accionable que tienen.
 *
 * LA NOTA DE LA ASISTENCIA NO ES UNA CORTESIA. Es la definicion peligrosa del
 * reporte entero y la spec le dedica un apartado: una profesora que no pasa
 * lista no produce alumnos ausentes, produce alumnos INVISIBLES. Sus clases no
 * entran en el denominador, y un «94%» sin decir sobre que invita a tomar una
 * decision sobre alguien con un numero que puede cubrir tres clases de doce.
 * (El detalle por alumno es de la Task 4; aqui basta con no mentir.)
 */
export const LAS_CINCO_METRICAS: readonly DescripcionDeMetrica[] = [
  {
    clave: 'ocupacion',
    titulo: 'Ocupacion',
    sobre: 'lugares reservados sobre los cupos de los turnos del mes',
  },
  {
    clave: 'asistencia',
    titulo: 'Asistencia',
    sobre: 'presentes sobre las reservas de turnos con lista pasada',
    nota: 'Una clase sin lista pasada no produce ausentes: no entra en la cuenta.',
  },
  {
    clave: 'cobranza',
    titulo: 'Cobranza',
    sobre: 'alumnos al dia al cerrar el mes, sobre los que tienen pack',
  },
  {
    clave: 'cancelacionRecuperable',
    titulo: 'Cancelacion recuperable',
    sobre: 'reservas reprogramadas sobre todas las reservas del mes',
  },
  {
    clave: 'cancelacionDefinitiva',
    titulo: 'Cancelacion definitiva',
    sobre: 'reservas dadas de baja sobre todas las reservas del mes',
  },
];

/**
 * UNA metrica, con su numero grande, su fraccion y sobre que se calcula.
 *
 * `data-metrica` y no una clase de CSS ni el texto del titulo: es el enganche
 * con el que el spec fija el conjunto ENTERO de lo que se pinta —una metrica
 * de mas rompe la lista blanca— sin depender de como se llame cada una en
 * castellano.
 *
 * EL AVISO DE «SIN DATOS» ES UNA FRASE Y NO UN GUION. Un «—» en el sitio del
 * numero se lee como que la pantalla no termino de cargar, que es otra mentira
 * distinta; y una celda vacia, igual. Lo que hay que decir es que la pregunta
 * no se puede contestar y por que: no hubo nada que contar.
 */
export function Porcentaje({
  descripcion,
  dato,
}: {
  descripcion: DescripcionDeMetrica;
  dato: PorcentajeDelContrato;
}) {
  const sinDatos = dato.porcentaje === null;

  return (
    <div
      data-metrica={descripcion.clave}
      className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {descripcion.titulo}
      </p>

      <p
        data-numero
        className={`text-3xl font-semibold ${sinDatos ? 'text-slate-400' : 'text-slate-900'}`}
      >
        {textoDelNumero(dato)}
      </p>

      {/* La fraccion va SIEMPRE, tambien cuando es «0 de 0»: es la mitad del
          dato, no un detalle. Sin ella el numero grande no se puede juzgar. */}
      <p data-fraccion className="text-sm font-medium text-slate-700">
        {textoDeLaFraccion(dato)}
      </p>

      <p data-sobre className="text-xs text-slate-500">
        {descripcion.sobre}
      </p>

      {sinDatos && (
        <p data-sin-datos className="text-xs text-amber-700">
          No hubo nada que contar este mes: la pregunta no se puede contestar. No es un 0%.
        </p>
      )}

      {descripcion.nota !== undefined && (
        <p data-nota className="text-xs text-slate-500">
          {descripcion.nota}
        </p>
      )}
    </div>
  );
}

/**
 * La misma metrica dentro de una celda del trimestre: apretada, pero entera.
 *
 * El numero grande sin la fraccion al lado volveria a juntar el 0% con el «no
 * se puede contestar» en la mitad de la pantalla donde se compara, que es
 * justo donde mas se mira. Que sea una tabla no cambia lo que hay que decir.
 */
export function PorcentajeEnCelda({ dato }: { dato: PorcentajeDelContrato }) {
  const sinDatos = dato.porcentaje === null;

  return (
    <span className="flex flex-col">
      <span data-numero className={sinDatos ? 'text-slate-400' : 'font-medium text-slate-900'}>
        {textoDelNumero(dato)}
      </span>
      <span data-fraccion className="text-xs text-slate-500">
        {textoDeLaFraccion(dato)}
      </span>
    </span>
  );
}
