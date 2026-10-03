/** `YYYY-MM-DD`, sin hora ni huso. */
export const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** `HH:MM` en 24 h. */
export const PATRON_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export class FechaInvalidaError extends Error {
  constructor(recibido: string) {
    super(`Se esperaba una fecha con formato YYYY-MM-DD y se recibio ${JSON.stringify(recibido)}.`);
    this.name = 'FechaInvalidaError';
  }
}

/**
 * Parte de fecha de un `Date`, en UTC.
 *
 * Las columnas `@db.Date` de Prisma vuelven como `Date` a medianoche UTC. Usar
 * `toISOString().slice(0, 10)` y no `getFullYear()` es deliberado: los getters
 * locales desplazarian el dia en cualquier maquina al oeste de Greenwich.
 */
export function aFechaISO(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/**
 * Convierte `"YYYY-MM-DD"` en la medianoche UTC de ese dia.
 *
 * Valida el ida y vuelta, no solo el patron: asi se rechaza `2026-02-31` en vez
 * de dejar que se convierta silenciosamente en el 3 de marzo.
 */
export function desdeFechaISO(iso: string): Date {
  if (!PATRON_FECHA.test(iso)) throw new FechaInvalidaError(iso);

  const fecha = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(fecha.getTime()) || aFechaISO(fecha) !== iso) {
    throw new FechaInvalidaError(iso);
  }

  return fecha;
}

export function esFechaValida(iso: string): boolean {
  try {
    desdeFechaISO(iso);
    return true;
  } catch {
    return false;
  }
}

export function esHoraValida(hora: string): boolean {
  return PATRON_HORA.test(hora);
}

/**
 * Compara dos horas `HH:MM`. Con ceros a la izquierda y 24 h, el orden
 * lexicografico coincide con el cronologico, asi que no hace falta parsear.
 */
export function comparaHoras(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Medianoche UTC de hoy. Util para "turnos futuros". */
export function comienzoDeHoyUtc(ahora: Date = new Date()): Date {
  return desdeFechaISO(aFechaISO(ahora));
}

/**
 * El instante exacto en que empieza un turno, combinando su fecha (columna
 * `@db.Date`, que Prisma devuelve a medianoche UTC) con su `horaInicio` "HH:MM".
 *
 * LIMITACION CONOCIDA, deliberada: `horaInicio` es "hora local del salon" segun
 * el comentario del schema, pero el sistema no almacena la zona horaria de
 * ningun gimnasio. Aqui se interpreta como UTC, que es la misma convencion que
 * usa todo el resto del sistema desde la Fase 1 (fechas de turno, ventanas de
 * pack, generacion de meses). Cambiarlo solo aqui rompería la coherencia; si
 * algun dia se soportan husos, se cambia en todos los sitios a la vez.
 */
export function instanteDelTurno(fecha: Date, hora: string): Date {
  if (!esHoraValida(hora)) {
    throw new FechaInvalidaError(`Hora invalida: ${hora}. Se espera HH:MM en 24 h.`);
  }

  const [horas, minutos] = hora.split(':').map(Number);

  return new Date(
    Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate(), horas, minutos, 0, 0),
  );
}

/**
 * El instante UTC que corresponde a un reloj de pared de una zona.
 *
 * `instanteDelTurno` construye el instante EN UTC, lo que equivale a decir que
 * el gimnasio vive en UTC. Para comparar contra fechas eso da igual —un turno
 * del 5 de octubre es del 5 de octubre en todas partes— y por eso seis fases
 * funcionaron sin esto. Pero el check-in compara una hora del dia contra el
 * reloj, con una ventana de quince minutos: la de una clase de las 18:00 seria
 * [17:45, 18:15] UTC, o sea [14:45, 15:15] en Argentina, y el alumno que llega
 * a su clase quedaria tres horas afuera.
 *
 * NO se resta un desfase fijo: se le pregunta a `Intl`, que conoce los cambios
 * de horario de verano. Una resta de "menos tres horas" acierta en julio y
 * falla en noviembre, y el fallo es invisible hasta que alguien no puede marcar
 * presente un lunes.
 *
 * DONDE SE USA: la ventana del check-in y el patron del cron. En ningun otro
 * sitio. Las fechas del sistema siguen en UTC.
 */
export function instanteEnZona(fecha: Date, hora: string, zona: string): Date {
  if (!esHoraValida(hora)) {
    throw new FechaInvalidaError(`Hora invalida: ${hora}. Se espera HH:MM en 24 h.`);
  }

  const [horas, minutos] = hora.split(':').map(Number);

  // Se parte de la interpretacion ingenua —ese reloj de pared como si fuera
  // UTC— y se corrige con el desfase que la zona tenia EN ESE INSTANTE. Dos
  // pasadas, porque el desfase puede cambiar justo en el salto de horario: la
  // primera aterriza en el instante equivocado cuando el ingenuo cae del otro
  // lado del salto, y la segunda lo corrige con el desfase que de verdad regia.
  const ingenuo = Date.UTC(
    fecha.getUTCFullYear(),
    fecha.getUTCMonth(),
    fecha.getUTCDate(),
    horas,
    minutos,
  );

  const primerIntento = ingenuo - desfaseDeZona(new Date(ingenuo), zona);

  return new Date(ingenuo - desfaseDeZona(new Date(primerIntento), zona));
}

/** Milisegundos que `zona` esta por delante de UTC en ese instante. */
function desfaseDeZona(instante: Date, zona: string): number {
  // `en-CA` da `YYYY-MM-DD, HH:MM:SS`, que `Date.parse` entiende tras cambiar
  // la coma por una T. Es la forma estandar de sacarle a Intl un desfase sin
  // depender de una tabla propia de husos.
  //
  // ⚠️ `hourCycle: 'h23'` Y NO `hour12: false`, que es la trampa de esta
  // funcion: con `hour12: false` el ciclo que sale es h24 y la medianoche se
  // formatea "24:00", no "00:00". `Date.parse('2026-10-05T24:00:00Z')` es
  // valido y vale el dia SIGUIENTE a medianoche, asi que el desfase sale con 24
  // horas de error y la funcion devuelve un dia corrido —o un `Invalid Date`
  // cuando la segunda pasada arrastra el error—. Pasa cada vez que el reloj de
  // la zona cae en la hora de medianoche, que no es un borde raro: en UTC es
  // sencillamente la hora "00:00".
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const comoSiFueraUtc = Date.parse(`${formato.format(instante).replace(', ', 'T')}Z`);

  return comoSiFueraUtc - instante.getTime();
}

/**
 * Minutos entre dos horas "HH:MM" del mismo dia.
 *
 * No contempla cruzar la medianoche —devuelve un negativo y quien llame
 * decide—, porque en este sistema un turno nunca lo hace: `exigirHorasCoherentes`
 * rechaza un horaFin que no sea posterior al horaInicio desde la Fase 1.
 */
export function minutosEntreHoras(inicio: string, fin: string): number {
  if (!esHoraValida(inicio)) {
    throw new FechaInvalidaError(`Hora invalida: ${inicio}. Se espera HH:MM en 24 h.`);
  }
  if (!esHoraValida(fin)) {
    throw new FechaInvalidaError(`Hora invalida: ${fin}. Se espera HH:MM en 24 h.`);
  }

  const aMinutos = (hora: string): number => {
    const [hh, mm] = hora.split(':');
    return Number(hh) * 60 + Number(mm);
  };

  return aMinutos(fin) - aMinutos(inicio);
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/**
 * Una fecha como la escribiria una persona: "lunes 7 de septiembre".
 *
 * Se arma a mano y no con `toLocaleDateString`: el resultado de esa dependeria
 * de los datos de idioma del sistema donde corra el worker, que en un contenedor
 * minimo pueden no estar y devolver el nombre en ingles. Esto es lo que va a
 * leer un alumno, asi que no puede depender de como este montada la imagen.
 *
 * Todo en UTC, como el resto del archivo: las columnas `@db.Date` vuelven a
 * medianoche UTC y los getters locales desplazarian el dia en cualquier maquina
 * al oeste de Greenwich. El worker no corre necesariamente en el huso del salon.
 *
 * Los acentos son deliberados: esto NO es un identificador ni un log, es el
 * texto que se interpola en el asunto de un email ("Reservaste Pilates para el
 * miércoles 7 de octubre"), y ahi "miercoles" se lee como un error.
 */
export function fechaLegible(fecha: Date): string {
  return `${DIAS[fecha.getUTCDay()]} ${fecha.getUTCDate()} de ${MESES[fecha.getUTCMonth()]}`;
}
