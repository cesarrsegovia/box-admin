import { aFechaISO, esFechaValida } from '@boxadmin/shared';
import type { RangoDeAsistencia } from '@/hooks/use-stats';

/**
 * EL RANGO DE LA ASISTENCIA, FUERA DE `page.tsx` Y NO DENTRO.
 *
 * Mismo motivo que en `analisis/filtros.ts`, `ausencias/filtros.ts` y
 * `turnos/filtros.tsx`: **Next 15 prohibe que un `page.tsx` exporte cualquier
 * cosa que no sea el `default`** y su lista corta de claves de configuracion.
 * Un `export function` de mas ahi pasa el `tsc --noEmit` y pasa el bundler, y
 * revienta despues, en el paso de «Linting and checking validity of types» de
 * `next build`, con un error que habla de `OmitWithTag` y de una propiedad que
 * no es asignable a `never` — que no se parece en nada a la causa.
 *
 * Y ademas: la pantalla usa estas funciones para armar la consulta y el spec
 * las usa para saber con que clave sembrar la cache. Que las dos cosas salgan
 * de la MISMA funcion es lo que impide que un test pase con una lectura
 * equivocada.
 *
 * ---------------------------------------------------------------------------
 * POR QUE ESTO NO ES UN BLOQUE MAS DE ANALISIS: **NO SE PIDE POR MES**.
 *
 * Los otros tres reportes del panel (`caja`, `operativo`,
 * `composicion-alumnos`) comparten `ConsultaMensualDto` y se piden con `anio` y
 * `mes` y nada mas. `/stats/asistencia` es el unico que toma `ConsultaRangoDto`
 * —`desde`, `hasta` y un `perfilId` opcional—, y lo dice el controller: la
 * conversacion con un alumno sobre su asistencia no empieza ni termina un dia
 * 1. Meter este reporte debajo del selector de mes seria recortarlo a algo que
 * su endpoint no pide y que la pregunta no tiene.
 */

/** Un dia en milisegundos. Igual que en `stats.service.ts`. */
const MS_POR_DIA = 86_400_000;

/**
 * EL TOPE DEL RANGO, COPIADO DEL SERVICE PORQUE ES EL SERVICE QUIEN LO DECIDE.
 *
 * `MAX_DIAS_DE_RANGO` vale 366 en `stats.service.ts` y cuenta EL PRIMER DIA:
 * el tope es `desde + 365 dias`. Un rango mas largo **no es un 400**, vuelve
 * RECORTADO —«recortar y contestar es mejor respuesta que un error», mismo
 * criterio que el `mesesAdelante` de los turnos libres—.
 *
 * Esta copia NO se usa para recortar aqui ni para rechazar nada: recortar en
 * el cliente convertiria el unico aviso honesto de la pantalla —«pediste
 * hasta X y se miro hasta Y»— en una mentira comoda, porque el `hasta` pedido
 * y el devuelto coincidirian siempre y nadie se enteraria de que se miro menos
 * de lo que creia. Se usa SOLO para poder decir con palabras por que volvio
 * recortado. El numero que se pinta es siempre el `hasta` DE LA RESPUESTA.
 */
export const MAX_DIAS_DE_RANGO = 366;

/**
 * Cuantos dias mira el rango por defecto, contando hoy.
 *
 * Treinta es «el ultimo mes» sin ser un mes calendario, que es justamente lo
 * que esta pantalla existe para no ser. No hay un defecto que venga de la API:
 * `desde` y `hasta` son OBLIGATORIOS en `ConsultaRangoDto`, asi que entrar sin
 * nada en la URL tiene que elegir un rango igualmente — y el que se elija se
 * dibuja en los dos controles, para que nadie lea unos numeros sin saber de
 * cuando son.
 */
export const DIAS_POR_DEFECTO = 30;

/**
 * El rango con el que se entra cuando la URL no dice ninguno: los ultimos
 * treinta dias, contando hoy.
 *
 * En UTC, que es el huso en el que piensa la API: `aFechaISO` corta el ISO y
 * los getters locales desplazarian el dia en cualquier maquina al oeste de
 * Greenwich.
 *
 * El reloj entra por parametro para poder probarlo sin congelar el global.
 */
export function rangoPorDefecto(ahora: Date): { desde: string; hasta: string } {
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
 * El rango vive en la URL y nunca en `useState`. Un rango en la URL se
 * comparte por chat («mira como viene asistiendo desde que volvio»), sobrevive
 * al boton de atras y vuelve puesto desde el login. En estado se pierde al
 * navegar, y la barra de direcciones y la pantalla dicen cosas distintas.
 *
 * LOS DOS EXTREMOS SON INDEPENDIENTES, Y AQUI ESTA LA DIFERENCIA CON EL MES.
 * En `analisis/filtros.ts` las dos claves van juntas o no van, porque `anio` y
 * `mes` son **las dos mitades de un solo valor**: un `?anio=2026` suelto no
 * significa «todo 2026» ni «enero», es media eleccion y la mitad que falta no
 * se adivina. Un rango no es eso: `?desde=2026-01-01` solo SI tiene una
 * lectura honesta —«desde el 1 de enero hasta hoy»— y es la que se usa.
 *
 * UNA FECHA ROTA NO SE ARREGLA Y TAMPOCO SE DESCARTA: viaja tal cual. El sitio
 * donde se decide que fecha es valida es `ConsultaRangoDto` —`@Matches(
 * PATRON_FECHA)`—, que contesta un 400 diciendo «desde debe tener formato
 * YYYY-MM-DD». Caerse al defecto en silencio pintaria los numeros de otro
 * rango debajo de una barra de direcciones que dice el roto, que es la misma
 * clase de mentira que el `porcentaje ?? 0`.
 *
 * Y el `perfilId` vacio se descarta ANTES de llegar al hook: `?perfilId=` seria
 * pedir la asistencia de un alumno cuyo id es la cadena vacia, y la respuesta
 * —un reporte sin alumnos— se lee como «este alumno no vino nunca».
 */
export function rangoDeLaBusqueda(parametros: URLSearchParams, ahora: Date): RangoDeAsistencia {
  const defecto = rangoPorDefecto(ahora);

  const rango: RangoDeAsistencia = {
    desde: valorDeLaUrl(parametros.get('desde')) ?? defecto.desde,
    hasta: valorDeLaUrl(parametros.get('hasta')) ?? defecto.hasta,
  };

  const perfilId = valorDeLaUrl(parametros.get('perfilId'));
  if (perfilId !== undefined) rango.perfilId = perfilId;

  return rango;
}

/**
 * La URL que pinta ESE rango, partiendo de la que YA HAY.
 *
 * Se parte de los parametros actuales para que el rango no borre lo que lleve
 * al lado —hoy nada, mañana lo que agregue otra tarea o un enlace compartido—.
 * Es la misma forma que usa el selector de mes de Analisis.
 *
 * SIN `perfilId` SE BORRA LA CLAVE, no se escribe vacia: `?perfilId=` y «sin
 * filtro» son dos peticiones distintas para la API y dos entradas distintas en
 * la cache de TanStack.
 */
export function urlDelRango(
  ruta: string,
  parametros: URLSearchParams,
  rango: RangoDeAsistencia,
): string {
  const siguientes = new URLSearchParams(parametros.toString());
  siguientes.set('desde', rango.desde);
  siguientes.set('hasta', rango.hasta);

  if (rango.perfilId === undefined || rango.perfilId === '') siguientes.delete('perfilId');
  else siguientes.set('perfilId', rango.perfilId);

  return `${ruta}?${siguientes.toString()}`;
}

/**
 * Cuantos dias cubre un rango, contando los dos extremos. `null` si no se
 * puede saber.
 *
 * `null` y no un cero ni un numero negativo, por lo mismo que el `porcentaje`
 * del contrato: una fecha rota o un rango invertido no son «cero dias», son
 * «no se puede contestar», y un cero ahi se leeria como un rango vacio de
 * verdad. Quien lo use tiene que ramificar.
 */
export function diasDelRango(desde: string, hasta: string): number | null {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) return null;

  const dias =
    (Date.parse(`${hasta}T00:00:00.000Z`) - Date.parse(`${desde}T00:00:00.000Z`)) / MS_POR_DIA;

  return dias < 0 ? null : dias + 1;
}

/**
 * Si la respuesta mira MENOS de lo que se pidio.
 *
 * Se compara el `hasta` PEDIDO con el `hasta` DE LA RESPUESTA, que son dos
 * valores distintos y no dos nombres del mismo: el service recorta a
 * `MAX_DIAS_DE_RANGO` y devuelve el recortado. Sin este aviso, quien pidio
 * dieciocho meses lee los doce primeros como «no vino mas» en vez de como «no
 * miramos mas alla» — que es exactamente el bug que el campo `mesesAdelante`
 * de los turnos libres vino a arreglar en el otro reporte.
 */
export function elRangoVolvioRecortado(
  pedido: RangoDeAsistencia,
  devuelto: { hasta: string },
): boolean {
  return devuelto.hasta !== pedido.hasta;
}
