import { instanteDelTurno } from './fechas';
import type {
  ConfiguracionEfectiva,
  Disponibilidad,
  EstadoDisponibilidad,
  MotivoNoDisponible,
} from './selfservice.contracts';

/**
 * Todo lo que hace falta para decidir, ya cargado. La funcion es pura: no lee
 * la base ni el reloj —`ahora` entra como parametro— para que la tabla de
 * decision se pueda probar entera sin levantar nada.
 */
export interface EntradaDisponibilidad {
  turno: {
    id: string;
    salaId: string;
    /** Columna @db.Date: Prisma la devuelve a medianoche UTC. */
    fecha: Date;
    horaInicio: string;
    cupo: number;
  };
  sala: {
    activa: boolean;
    visibleAlumnos: boolean;
    soloCuposLiberados: boolean;
  };
  /** Ya resuelta por `resolverConfiguracion`. */
  config: ConfiguracionEfectiva;
  /** Reservas activas del turno. */
  ocupados: number;
  /** Si el turno tiene alguna reserva cancelada: es lo que hace "liberado" a un cupo. */
  huboCancelaciones: boolean;
  mesPublicado: boolean;
  tieneAccesoASala: boolean;
  yaReservado: boolean;
  enListaEspera: boolean;
  posicionEnLista: number | null;
  ahora: Date;
}

/**
 * El estado consolidado de un turno para un alumno concreto.
 *
 * Dos ejes distintos, deliberadamente separados:
 *
 * - `estado` describe el TURNO y no depende de quien pregunte. Un turno con
 *   cupo esta LIBRE aunque el alumno que mira no pueda tomarlo.
 * - `puedeReservar` y `motivo` describen a ESTE alumno AHORA.
 *
 * Mezclarlos —hacer que el estado cambiara segun quien pregunta— haria el
 * contrato inservible para el frontend, que necesita pintar el turno y el boton
 * por separado.
 */
export function calcularDisponibilidad(entrada: EntradaDisponibilidad): Disponibilidad {
  const estado = estadoDelTurno(entrada);
  const motivo = motivoDelAlumno(entrada, estado);

  return {
    turnoId: entrada.turno.id,
    estado,
    cupo: entrada.turno.cupo,
    ocupados: entrada.ocupados,
    puedeReservar: motivo === null && estado === 'LIBRE',
    motivo,
    enListaEspera: entrada.enListaEspera,
    posicionEnLista: entrada.enListaEspera ? entrada.posicionEnLista : null,
  };
}

function estadoDelTurno(e: EntradaDisponibilidad): EstadoDisponibilidad {
  // `>=` y no `===`: si un admin baja el cupo de un turno que ya tenia mas
  // reservas, `ocupados` puede superar al cupo y el turno sigue lleno.
  if (e.ocupados >= e.turno.cupo) {
    return e.config.listaEsperaHabilitada ? 'LISTA_ESPERA' : 'LLENO';
  }

  // "Solo cupos liberados": el alumno solo puede tomar lugares que alguien
  // solto, no lugares originales. Es derivable de que exista alguna reserva
  // cancelada en el turno, asi que no hace falta ninguna columna nueva.
  if (e.sala.soloCuposLiberados && !e.huboCancelaciones) return 'SOLO_ADMIN';

  return 'LIBRE';
}

/**
 * El primer criterio que se cumpla gana, de lo mas general a lo mas especifico.
 * A un alumno que ni siquiera tiene la sala asignada no le sirve que le digan
 * "la ventana cerro": lo mandaria a resolver el problema equivocado.
 */
function motivoDelAlumno(
  e: EntradaDisponibilidad,
  estado: EstadoDisponibilidad,
): MotivoNoDisponible | null {
  if (!e.tieneAccesoASala) return 'SIN_ACCESO_A_SALA';
  if (!e.sala.activa || !e.sala.visibleAlumnos) return 'SALA_NO_VISIBLE';
  if (!e.mesPublicado) return 'MES_NO_PUBLICADO';
  if (e.yaReservado) return 'YA_RESERVADO';
  if (ventanaCerrada(e)) return 'VENTANA_CERRADA';
  if (estado === 'SOLO_ADMIN') return 'SOLO_CUPOS_LIBERADOS';

  // LLENO y LISTA_ESPERA no necesitan motivo: el estado ya lo dice, y repetirlo
  // obligaria al frontend a mirar dos campos para decir lo mismo.
  return null;
}

/**
 * La ventana se mide contra el comienzo del turno. Un turno que ya empezo tiene
 * la ventana cerrada aunque no haya ninguna configurada: con
 * `minMinutosAnotarse: 0` el limite es el propio comienzo.
 */
function ventanaCerrada(e: EntradaDisponibilidad): boolean {
  const comienzo = instanteDelTurno(e.turno.fecha, e.turno.horaInicio);
  const limite = comienzo.getTime() - e.config.minMinutosAnotarse * 60_000;

  return e.ahora.getTime() > limite;
}

/**
 * La misma regla, aplicada a la cancelacion. Vive aqui y no en el servicio para
 * que el frontend de la Fase 3B pueda apagar el boton sin preguntar al
 * servidor.
 */
export function puedeCancelar(
  fecha: Date,
  horaInicio: string,
  config: ConfiguracionEfectiva,
  ahora: Date,
): boolean {
  const comienzo = instanteDelTurno(fecha, horaInicio);

  return ahora.getTime() <= comienzo.getTime() - config.minMinutosCancelar * 60_000;
}
