import { aFechaISO } from '@boxadmin/shared';
import type { AlumnoEnClase } from '@boxadmin/shared';
import type { RangoDeClases } from '@/hooks/use-mis-clases';

/**
 * EL RANGO DE LA AGENDA Y LA CUENTA DE LA LISTA, FUERA DE `page.tsx`.
 *
 * Mismo motivo que en `admin/analisis/asistencia/filtros.ts`, de donde esta
 * pieza copia la forma: **Next 15 prohibe que un `page.tsx` exporte cualquier
 * cosa que no sea el `default`** y su lista corta de claves de configuracion.
 * Un `export function` de mas ahi pasa el `tsc --noEmit` y pasa el bundler, y
 * revienta despues, en el paso de «Linting and checking validity of types» de
 * `next build`, con un error que habla de `OmitWithTag` y de una propiedad que
 * no es asignable a `never` — que no se parece en nada a la causa.
 *
 * Y ademas: la pantalla usa estas funciones para armar la consulta y el spec
 * las usa para saber con que clave sembrar la cache y que numeros esperar. Que
 * las dos cosas salgan de la MISMA funcion es lo que impide que un test pase
 * con una lectura equivocada.
 */

/** Un dia en milisegundos. */
const MS_POR_DIA = 86_400_000;

/**
 * ---------------------------------------------------------------------------
 * EL RANGO POR DEFECTO ES **HOY**, Y ES LA DECISION CARA DE ESTA PANTALLA.
 * ---------------------------------------------------------------------------
 *
 * No sale de un gusto: sale de que **la agenda cuesta una peticion por clase**.
 *
 * `ClaseDelProfesor` trae `listaPasada`, que seria gratis, y NO SE USA: ver el
 * bloque de abajo. Lo que esta pantalla dice —«faltan 7 de 9»— solo se puede
 * saber pidiendo `GET /mis-clases/:id/alumnos` de cada clase, porque es el
 * unico sitio donde esta el `asistio` de cada reserva. O sea: 1 peticion de
 * agenda + N peticiones de detalle.
 *
 * CON **HOY** COMO RANGO POR DEFECTO ESO SON 3 O 4 PETICIONES. Una profesora da
 * dos o tres clases en un dia. Con una SEMANA por defecto serian quince o
 * veinte, y en un telefono con la red del gimnasio eso es una pantalla que
 * tarda — justo la que se mira de pie, con la gente esperando.
 *
 * Y HOY ES ADEMAS LA PREGUNTA QUE SE HACE DE VERDAD. Quien abre esto esta a
 * punto de entrar a una clase o acaba de salir de ella. «Que me falta de la
 * semana» es una pregunta real pero es OTRA, se hace sentada y se hace
 * escribiendo el rango: por eso el rango esta en la URL y no cableado.
 *
 * HACIA ATRAS NO HAY LIMITE EN LA API —`pasarLista` solo rechaza las clases que
 * todavia no empezaron, «quien se olvido tres semanas puede ponerse al dia»—,
 * asi que el defecto de un solo dia no cierra ninguna puerta: la abre
 * escribiendo dos fechas.
 */
export const DIAS_POR_DEFECTO = 1;

/**
 * ---------------------------------------------------------------------------
 * EL TOPE: A PARTIR DE AQUI NO SE PIDE EL DETALLE, Y SE DICE.
 * ---------------------------------------------------------------------------
 *
 * La otra mitad de la decision, y la que importa: **que pasa cuando el rango
 * que alguien escribe trae muchas clases.**
 *
 * Hay tres respuestas posibles y dos son inaceptables:
 *
 *  1. PEDIR IGUAL. Veinticinco peticiones en paralelo desde un telefono contra
 *     una API que resuelve el perfil del actor en cada una. La pantalla se
 *     arrastra y la profesora no entiende por que.
 *  2. CAER AL `listaPasada` QUE YA VIENE EN LA AGENDA, que es gratis y es un
 *     si/no. **Es la peor de las tres**, porque es un si/no QUE PUEDE SER
 *     FALSO —ver el bloque siguiente— y porque solo mentiria en los rangos
 *     largos, que es donde nadie va a ir a comprobarlo.
 *  3. NO PEDIRLO Y DECIRLO. Es la que se implementa. La agenda sigue
 *     listando las clases, cada una sigue llevando a su lista, y donde iria la
 *     cuenta hay una frase que dice que no se pregunto y por que.
 *
 * DOCE, Y NO ES UN NUMERO REDONDO ELEGIDO AL AZAR. Tiene que cumplir dos cosas
 * a la vez, y las cumple con margen por los dos lados:
 *
 *  - EL RANGO POR DEFECTO NUNCA LO TOCA. Un dia son dos o tres clases; doce es
 *     mas de lo que nadie da en una jornada. Si el defecto rozara el tope, la
 *     pantalla normal estaria a una clase de dejar de contestar.
 *  - UNA SEMANA SIEMPRE LO PASA. Tres clases por dia son veintiuna. O sea que
 *     «mirar la semana» cae del lado honesto a proposito y no por accidente:
 *     para esa pregunta la respuesta de esta pantalla es «abri el dia».
 *
 * Es un tope sobre CUANTAS CLASES VUELVEN, no sobre cuantos dias se piden: lo
 * que cuesta son las peticiones, y un mes de vacaciones son cero.
 */
export const MAX_CLASES_CON_DETALLE = 12;

/**
 * El rango con el que se entra cuando la URL no dice ninguno: HOY, los dos
 * extremos.
 *
 * En UTC, que es el huso en el que piensa la API: `aFechaISO` corta el ISO y
 * los getters locales desplazarian el dia en cualquier maquina al oeste de
 * Greenwich. El reloj entra por parametro para poder probarlo sin congelar el
 * global.
 */
export function rangoPorDefecto(ahora: Date): RangoDeClases {
  const hasta = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
  const desde = new Date(hasta.getTime() - (DIAS_POR_DEFECTO - 1) * MS_POR_DIA);

  return { desde: aFechaISO(desde), hasta: aFechaISO(hasta) };
}

/** Un valor con algo dentro, o nada. Una cadena vacia no es una eleccion. */
function valorDeLaUrl(valor: string | null): string | undefined {
  if (valor === null || valor.trim() === '') return undefined;
  return valor;
}

/**
 * EL RANGO QUE DICE LA URL, y para cada extremo que falte, el del defecto.
 *
 * El rango vive en la URL y nunca en `useState`. En la URL sobrevive al boton
 * de atras —que en un telefono es el gesto mas usado de todos—, vuelve puesto
 * desde el login y se puede compartir. En estado se pierde al navegar a la
 * lista de una clase y volver, que es LA navegacion de esta pantalla: la
 * profesora entra en una clase, pasa lista, vuelve, y tiene que seguir mirando
 * el mismo dia.
 *
 * UN EXTREMO SUELTO SE COMPLETA Y NO SE DESCARTA, igual que en el reporte de
 * asistencia: `?desde=2026-10-01` tiene una lectura honesta —«desde el 1 hasta
 * hoy»— y es la que se usa.
 *
 * UNA FECHA ROTA VIAJA TAL CUAL. El sitio donde se decide que rango es valido
 * es `exigirRango` en el controller, que contesta «desde y hasta son
 * obligatorios, con formato YYYY-MM-DD». Arreglarla aqui en silencio pintaria
 * las clases de otro dia debajo de una barra de direcciones que dice el roto.
 *
 * Y UN RANGO INVERTIDO TAMBIEN SE MANDA, para que la API conteste su segundo
 * mensaje —«desde no puede ser posterior a hasta»—. Es la misma decision que
 * ya tomo `queryDeMisClases` en el hook, y por el mismo motivo: el que juzga
 * el rango es el controller.
 */
export function rangoDeLaBusqueda(parametros: URLSearchParams, ahora: Date): RangoDeClases {
  const defecto = rangoPorDefecto(ahora);

  return {
    desde: valorDeLaUrl(parametros.get('desde')) ?? defecto.desde,
    hasta: valorDeLaUrl(parametros.get('hasta')) ?? defecto.hasta,
  };
}

/**
 * La URL que pinta ESE rango, partiendo de la que YA HAY.
 *
 * Se parte de los parametros actuales para que el rango no borre lo que lleve
 * al lado —hoy nada, mañana lo que agregue otra tarea o un enlace compartido—.
 */
export function urlDelRango(
  ruta: string,
  parametros: URLSearchParams,
  rango: RangoDeClases,
): string {
  const siguientes = new URLSearchParams(parametros.toString());
  siguientes.set('desde', rango.desde);
  siguientes.set('hasta', rango.hasta);

  return `${ruta}?${siguientes.toString()}`;
}

/**
 * ¿Se pide el detalle de esta agenda?
 *
 * Una funcion y no un `>` suelto en el JSX para que el spec pueda preguntar lo
 * MISMO que decide la pantalla. Con el `>` escrito en los dos sitios, mover el
 * tope dejaria los tests mirando el viejo y pasando en verde.
 */
export function seDetallaLaAgenda(cuantasClases: number): boolean {
  return cuantasClases <= MAX_CLASES_CON_DETALLE;
}

/** La cuenta de una lista: cuantos anotados hay y cuantos siguen sin estado. */
export interface ConteoDeLaLista {
  /** Los anotados a la clase: los que tienen reserva viva. */
  anotados: number;
  /** Los que YA tienen estado —vino o falto—, sea quien sea quien lo escribio. */
  marcados: number;
  /** Los que siguen en `asistio: null`. Es el numero que la agenda existe para decir. */
  faltan: number;
}

/**
 * CUANTOS QUEDAN SIN MARCAR, QUE ES LA UNICA PREGUNTA DE ESTA PANTALLA.
 *
 * `asistio !== null` y no `=== true`: un alumno marcado AUSENTE esta marcado.
 * Confundir «no vino» con «no se sabe» es el error que el reporte de
 * asistencia de la Fase 11 vino a explicar con palabras, y aqui lo volveria a
 * cometer la pantalla que produce el dato.
 *
 * `faltan` se devuelve CALCULADO y no lo calcula quien llama: es la resta que
 * la mutacion «el conteo cuenta los anotados y no los que faltan» invierte, y
 * si viviera en el JSX habria dos sitios donde escribirla mal.
 *
 * Y NO SE USA `reservasActivas` DE LA AGENDA COMO DENOMINADOR aunque sea el
 * mismo numero: los dos salen de la misma consulta en el service
 * —`reservas: { where: { canceladaEn: null } }`— pero de dos peticiones
 * distintas, hechas en dos momentos distintos. Si alguien cancela entre una y
 * otra, «faltan 7 de 9» con un 9 viejo y un 7 nuevo es una fraccion que no
 * cuadra con ninguna realidad. Los dos numeros salen de la MISMA respuesta.
 */
export function conteoDeLaLista(alumnos: readonly AlumnoEnClase[]): ConteoDeLaLista {
  const marcados = alumnos.filter((alumno) => alumno.asistio !== null).length;

  return { anotados: alumnos.length, marcados, faltan: alumnos.length - marcados };
}
