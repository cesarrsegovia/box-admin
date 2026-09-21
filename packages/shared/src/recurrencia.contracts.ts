/** 0 = domingo ... 6 = sabado, como `Date.getUTCDay()`. */
export type DiaSemana = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface RutinaPublica {
  id: string;
  tenantId: string;
  perfilId: string;
  salaId: string;
  /** Nombre del turno que generara, p. ej. "Pilates". */
  nombre: string;
  diaSemana: DiaSemana;
  /** `HH:MM`. */
  horaInicio: string;
  horaFin: string;
  activa: boolean;
  /** `YYYY-MM-DD`. */
  desde: string;
  /** `YYYY-MM-DD`, o `null` si la rutina es indefinida. */
  hasta: string | null;
}

export interface VacacionPublica {
  id: string;
  tenantId: string;
  perfilId: string;
  desde: string;
  hasta: string;
  motivo: string | null;
  /** Se almacena y NO se aplica en la Fase 2. Ver D3 del spec. */
  devuelveClase: boolean;
}

export interface AusenciaPublica {
  id: string;
  tenantId: string;
  /** `null` = todo el salon. */
  salaId: string | null;
  desde: string;
  hasta: string;
  todoElDia: boolean;
  /** `HH:MM`, solo si `todoElDia` es false. */
  horaInicio: string | null;
  horaFin: string | null;
  recuperable: boolean;
  motivo: string | null;
}

// ---------------------------------------------------------------------------
// El plan de un mes
// ---------------------------------------------------------------------------

/**
 * Situaciones que EXIGEN una decision humana antes de publicar.
 *
 * Deliberadamente separadas de las exclusiones: un mes con tres alumnos de
 * vacaciones produciria decenas de "conflictos" que nadie tiene que resolver y
 * que esconderian los dos que si.
 */
export type TipoConflicto = 'CUPO_LLENO' | 'FUERA_DE_PACK' | 'SALA_SIN_CUPO_BASE';

/** Fechas que no generan reserva por datos cargados a proposito. Informativas. */
export type TipoExclusion = 'AUSENCIA_SALA' | 'VACACION_ALUMNO';

export interface Conflicto {
  tipo: TipoConflicto;
  /** `null` cuando el conflicto es de la sala y no de un alumno concreto. */
  perfilId: string | null;
  /** `YYYY-MM-DD`. */
  fecha: string;
  detalle: string;
}

export interface Exclusion {
  tipo: TipoExclusion;
  perfilId: string | null;
  fecha: string;
  detalle: string;
}

export interface TurnoPlanificado {
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  /** `null` = ningun horario de profesora cubre esa franja. */
  profesorId: string | null;
}

/**
 * Un turno que YA EXISTE y al que hay que ponerle profesora.
 *
 * Solo se emiten para turnos SIN profesora: el motor rellena huecos y nunca
 * pisa lo que un humano decidio. Sin esa regla, la suplencia que el admin puso
 * a mano duraria hasta la proxima publicacion del mes y desapareceria sin que
 * nadie se entere.
 */
export interface EtiquetaDeProfesor {
  turnoId: string;
  profesorId: string;
}

export interface ReservaPlanificada {
  perfilId: string;
  salaId: string;
  fecha: string;
  horaInicio: string;
}

export interface ResumenDelPlan {
  turnos: number;
  reservas: number;
  conflictos: number;
  exclusiones: number;
}

/**
 * Lo que devuelve el planificador.
 *
 * Desviacion respecto al PDF, que definia `turnosACrear` y `reservasACrear` como
 * simples numeros: aqui son las listas completas, porque `previsualizar` tiene
 * que ensenarselas al admin. El recuento va aparte, en `resumen`.
 */
export interface PlanDeMes {
  turnosACrear: TurnoPlanificado[];
  reservasACrear: ReservaPlanificada[];
  etiquetasDeProfesor: EtiquetaDeProfesor[];
  conflictos: Conflicto[];
  exclusiones: Exclusion[];
  resumen: ResumenDelPlan;
}

// ---------------------------------------------------------------------------
// Estado del mes y de su publicacion
// ---------------------------------------------------------------------------

export type EstadoMes = 'BORRADOR' | 'HABILITADO';

export type EstadoJob = 'sin_job' | 'en_cola' | 'procesando' | 'terminado' | 'fallido';

export interface EstadoPublicacion {
  jobId: string;
  estado: EstadoJob;
  /** Resumen del plan aplicado, disponible solo cuando el job termino bien. */
  resumen: ResumenDelPlan | null;
  error: string | null;
}

export interface MesCalendarioPublico {
  /** `null` si el mes todavia no tiene fila: nunca se previsualizo ni publico. */
  id: string | null;
  tenantId: string;
  salaId: string;
  anio: number;
  mes: number;
  estado: EstadoMes;
  publicadoEn: string | null;
  publicadoPor: string | null;
  publicacion: EstadoPublicacion | null;
}

export interface PublicacionEncolada {
  jobId: string;
  salaId: string;
  anio: number;
  mes: number;
}
