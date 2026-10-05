import { instanteEnZona } from '@boxadmin/shared';

/**
 * Una reserva viva del alumno, con lo justo para decidir si es la que esta
 * marcando. Las carga el service; aqui no se toca la base.
 */
export interface CandidataDeCheckIn {
  reservaId: string;
  turnoId: string;
  /** La del turno: columna `@db.Date`, o sea medianoche UTC. */
  fecha: Date;
  /** `HH:MM`, reloj de pared del gimnasio. */
  horaInicio: string;
  /**
   * El nombre de la clase. Sale de `Turno.nombre`: la columna se llama
   * `nombre`, y "clase" es como se le dice de cara al alumno, igual que en las
   * plantillas de email de la Fase 5B (`{{clase}}`). No existe `turno.clase`.
   */
  clase: string;
  /** Si ya tiene fila de `Asistencia`, es decir, si ya paso por el check-in. */
  yaMarcada: boolean;
  /**
   * Si `Reserva.asistio` ya no es null, es decir, si la profesora ya paso lista
   * en esa clase.
   *
   * ES DISTINTO DE `yaMarcada` y por eso son dos campos. La profesora que pasa
   * lista escribe `asistio` sin dejar fila de `Asistencia`; un check-in deja
   * las dos cosas. Con un solo campo no se podria distinguir "ya marcaste" de
   * "la profesora ya te puso ausente", que son dos mensajes y dos acciones
   * distintas para el alumno.
   */
  listaPasada: boolean;
}

export type ResultadoDeEleccion =
  | { tipo: 'elegida'; candidata: CandidataDeCheckIn }
  | { tipo: 'ya-marcada'; candidata: CandidataDeCheckIn }
  | { tipo: 'lista-ya-pasada'; candidata: CandidataDeCheckIn }
  | { tipo: 'fuera-de-ventana'; masCercana: CandidataDeCheckIn }
  | { tipo: 'sin-reserva' };

const MS_POR_MINUTO = 60_000;

/**
 * Cual de las reservas del alumno es la que esta marcando.
 *
 * PURA: recibe el instante y la zona, no los lee. Es lo que permite probar el
 * borde de los quince minutos con una tabla de casos en vez de con un reloj.
 *
 * LA VENTANA SE CALCULA CON `instanteEnZona`, NO CON `instanteDelTurno`. Es la
 * razon de ser de esta fase: `horaInicio` es un reloj de pared del gimnasio, y
 * `instanteDelTurno` lo interpreta como UTC. Una clase de las 18:00 en
 * Argentina empieza a las 21:00 UTC; con la ventana en UTC seria [17:45, 18:15]
 * UTC, o sea [14:45, 15:15] hora local, y el alumno que llega puntual a su
 * clase quedaria tres horas afuera. Hay un test que cae exactamente ahi.
 *
 * Los tres rechazos son DISTINGUIBLES a proposito: son datos del propio alumno,
 * asi que decirle cual de los tres no filtra nada y le ahorra una llamada a
 * recepcion. "No se pudo marcar" lo manda a preguntar; "llegaste 40 minutos
 * tarde" no.
 */
export function elegirReserva(
  candidatas: CandidataDeCheckIn[],
  ahora: Date,
  config: { minutosAntes: number; minutosDespues: number },
  zona: string,
): ResultadoDeEleccion {
  // El unico desenlace que no lleva candidata: no hay ninguna de la que hablar.
  if (candidatas.length === 0) return { tipo: 'sin-reserva' };

  const instante = ahora.getTime();

  const medidas = candidatas.map((candidata) => {
    const inicio = instanteEnZona(candidata.fecha, candidata.horaInicio, zona).getTime();

    return {
      candidata,
      // En valor absoluto: la de las 19:00 a veinte minutos vista gana a la de
      // las 18:00 que empezo hace cuarenta.
      distancia: Math.abs(inicio - instante),
      // INCLUSIVA en los dos extremos: el que llega al minuto exacto de
      // apertura entra, y el que llega al minuto exacto de cierre tambien. Con
      // la ventana en cero esto deja pasar solo el instante justo del inicio,
      // que es configuracion valida y tiene que comportarse.
      enVentana:
        instante >= inicio - config.minutosAntes * MS_POR_MINUTO &&
        instante <= inicio + config.minutosDespues * MS_POR_MINUTO,
    };
  });

  const masCercana = (medidas: { candidata: CandidataDeCheckIn; distancia: number }[]) =>
    medidas.reduce((mejor, otra) => (otra.distancia < mejor.distancia ? otra : mejor)).candidata;

  const abiertas = medidas.filter((medida) => medida.enVentana);

  if (abiertas.length === 0) {
    // Tenia reservas, pero ninguna abierta. Se devuelve la mas cercana para que
    // la pantalla pueda decir "tu clase era a las 18:00" en vez de un "no se
    // pudo" que no ayuda a nadie.
    return { tipo: 'fuera-de-ventana', masCercana: masCercana(medidas) };
  }

  const elegida = masCercana(abiertas);

  // LOS DOS BLOQUEOS SE MIRAN AQUI, DESPUES DE ELEGIR, y no filtrando las
  // candidatas antes. Al reves, un alumno con dos clases seguidas que ya marco
  // la primera no tendria candidatas abiertas y recibiria "fuera de ventana"
  // —o incluso "sin reserva"— en vez de que se le marque la segunda.

  // `yaMarcada` ANTES que `listaPasada`: un check-in deja las dos marcas, asi
  // que quien ya escaneo cumple las dos condiciones y el mensaje correcto es
  // "ya marcaste", no "hablá con tu profesora".
  if (elegida.yaMarcada) return { tipo: 'ya-marcada', candidata: elegida };

  // LA PROFESORA MANDA. Si ya paso lista, ella estaba en la sala y el alumno no
  // puede sobrescribir ese parte desde su telefono: seria dejar que lo corrija
  // justo quien tiene interes en que diga otra cosa. El caso incomodo —lista
  // pasada temprano, alumno que llega tarde— se arregla solo y mejor, porque
  // los dos estan en la misma sala; lo que no se arregla es un registro que se
  // cambio solo y nadie vio.
  if (elegida.listaPasada) return { tipo: 'lista-ya-pasada', candidata: elegida };

  return { tipo: 'elegida', candidata: elegida };
}
