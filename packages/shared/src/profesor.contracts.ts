// ---------------------------------------------------------------------------
// Fase 4 — El profesor como entidad real
// ---------------------------------------------------------------------------

/** Un horario fijo de una profesora, tal como lo ve el admin. */
export interface HorarioProfesorPublico {
  id: string;
  profesorId: string;
  /** El nombre va resuelto: un listado de ids no le sirve a nadie. */
  profesorNombre: string;
  salaId: string;
  salaNombre: string;
  /** 0 = domingo ... 6 = sabado. */
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  activo: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  /** `YYYY-MM-DD` o null = indefinido. */
  hasta: string | null;
  /**
   * String con dos decimales, nunca number: es dinero, y un float binario no
   * representa 1500.10 exactamente. Misma regla que el precio de los packs
   * desde la Fase 1. `null` = usa la tarifa general del gimnasio.
   */
  tarifaPorHora: string | null;
}

/** Una clase de la profesora, en su propia vista. */
export interface ClaseDelProfesor {
  turnoId: string;
  salaId: string;
  salaNombre: string;
  nombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservasActivas: number;
  /** Si ya se paso lista en esta clase. */
  listaPasada: boolean;
}

/**
 * Un alumno en la clase de la profesora.
 *
 * Deliberadamente escueto: nombre y si vino. Ni telefono ni ficha medica — desde
 * la Fase 1, `fichaMedica` solo la ve ADMIN_SALON o la propia persona, y esta
 * fase no abre esa puerta.
 */
export interface AlumnoEnClase {
  perfilId: string;
  nombreCompleto: string;
  /** `null` = todavia no se paso lista. */
  asistio: boolean | null;
}

/** De donde salio la tarifa de una franja. */
export type OrigenTarifa = 'HORARIO' | 'TENANT';

/**
 * Una franja de la liquidacion, con tres banderas ortogonales.
 *
 * | contratada | dictada | cerrada | que es                          |
 * |------------|---------|---------|---------------------------------|
 * | si         | si      | no      | la clase se dio                 |
 * | si         | no      | no      | NADIE SE ANOTO                  |
 * | si         | no      | si      | feriado: no suma a contratadas  |
 * | no         | si      | -       | suplencia sin contrato          |
 */
export interface FranjaDeLiquidacion {
  /** `YYYY-MM-DD`. */
  fecha: string;
  salaId: string;
  horaInicio: string;
  horaFin: string;
  /** Enteros: es la verdad. Las horas son una comodidad derivada. */
  minutos: number;
  contratada: boolean;
  dictada: boolean;
  cerrada: boolean;
  /** Solo cuando `cerrada`. */
  motivoCierre: string | null;
  /** El turno que la dicto, si lo hubo. */
  turnoId: string | null;
  /** String con dos decimales. `null` = no hay ninguna tarifa definida. */
  tarifaPorHora: string | null;
  origenTarifa: OrigenTarifa | null;
}

/**
 * Las horas de una profesora en un mes.
 *
 * NO lleva importes: el calculo en pesos —tarifas, ajustes, el "50% base"— es de
 * la Fase 6, y adelantarlo aqui duplicaria logica de reportes en dos sitios.
 * Lo que si lleva es la tarifa YA RESUELTA por franja, para que la Fase 6 solo
 * tenga que multiplicar.
 */
export interface LiquidacionProfesor {
  profesorId: string;
  profesorNombre: string;
  anio: number;
  mes: number;
  /** Enteros. Contratados EXCLUYE los cerrados. */
  minutosContratados: number;
  minutosDictados: number;
  minutosCerrados: number;
  /** Los mismos numeros en horas, string con dos decimales. */
  horasContratadas: string;
  horasDictadas: string;
  horasCerradas: string;
  franjas: FranjaDeLiquidacion[];
}
