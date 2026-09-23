import type { RolUsuario } from './roles';

// ---------------------------------------------------------------------------
// Advertencias
// ---------------------------------------------------------------------------

/**
 * Situaciones que no impiden completar la operacion pero que el admin debe ver.
 *
 * La alternativa —guardar en silencio— es exactamente el bug de "Sin sala" que
 * se detecto en Wellness: el alta funcionaba, el alumno quedaba inservible y
 * nadie se enteraba hasta que intentaba reservar.
 */
export type CodigoAdvertencia = 'SIN_SALAS' | 'SIN_PACK' | 'PACK_AGOTADO';

export interface Advertencia {
  codigo: CodigoAdvertencia;
  mensaje: string;
}

export interface ConAdvertencias {
  advertencias: Advertencia[];
}

// ---------------------------------------------------------------------------
// Salas
// ---------------------------------------------------------------------------

export interface SalaPublica {
  id: string;
  tenantId: string;
  nombre: string;
  activa: boolean;
  visibleAlumnos: boolean;
  soloCuposLiberados: boolean;
  exclusiva: boolean;
  /** `null` = hereda de la configuracion del tenant (que no existe hasta Fase 2). */
  cupoBase: number | null;
  minMinutosCancelar: number | null;
  minMinutosAnotarse: number | null;
  listaEsperaHabilitada: boolean | null;
}

// ---------------------------------------------------------------------------
// Packs
// ---------------------------------------------------------------------------

export type TipoPack = 'MENSUAL' | 'TOTAL';

export interface PackPublico {
  id: string;
  tenantId: string;
  nombre: string;
  /** `null` = vale para todas las salas. */
  salaId: string | null;
  tipo: TipoPack;
  /**
   * Decimal serializado como string (`"12500.00"`), nunca como number: los
   * float binarios pierden centavos y esto es dinero. `null` = a consultar.
   */
  precio: string | null;
  clasesPorMes: number | null;
  clasesTotales: number | null;
  cancelacionesPermitidas: number | null;
  activo: boolean;
}

// ---------------------------------------------------------------------------
// Usuarios de negocio (Usuario + Perfil)
// ---------------------------------------------------------------------------

export type TipoUsuarioNegocio = 'alumno' | 'profesor';

/** Lo que se devuelve en listados. Nunca incluye `fichaMedica`. */
export interface UsuarioResumen {
  id: string;
  tenantId: string;
  nombreCompleto: string;
  email: string;
  rol: RolUsuario;
  activo: boolean;
  perfilId: string;
  telefono: string | null;
  packId: string | null;
  /**
   * DERIVADO desde la Fase 5A: hay un pago vigente, no anulado y que no sea una
   * sena, cubriendo hoy. Antes era una columna que nadie bajaba nunca.
   */
  pagoAlDia: boolean;
  salaIds: string[];
}

/** Detalle completo. `fichaMedica` solo viaja si el actor puede verla. */
export interface UsuarioDetalle extends UsuarioResumen {
  fichaMedica?: string | null;
  clasesExtra: number;
  cancelacionesUsadas: number;
  /** `YYYY-MM-DD` o `null`. */
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
  pack: PackPublico | null;
  salas: SalaPublica[];
}

/** El alta devuelve la contraseña temporal UNA sola vez. No se puede releer. */
export interface AltaUsuarioRespuesta extends UsuarioDetalle, ConAdvertencias {
  passwordTemporal: string;
}

export interface ResetPasswordRespuesta {
  usuarioId: string;
  passwordTemporal: string;
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

export interface TurnoPublico {
  id: string;
  tenantId: string;
  salaId: string;
  nombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  /** `HH:MM`. */
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservasActivas: number;
  lugaresLibres: number;
  /**
   * `null` = sin profesora asignada. Desde la Fase 4 esto es una relacion real,
   * no una parte del `nombre`.
   */
  profesor: { id: string; nombreCompleto: string } | null;
}

// ---------------------------------------------------------------------------
// Reservas
// ---------------------------------------------------------------------------

export type OrigenReserva = 'ADMIN' | 'ALUMNO' | 'RUTINA' | 'PRUEBA' | 'LISTA_ESPERA' | 'EXTRA';

export type TipoCancelacion = 'RECUPERABLE' | 'DEFINITIVA';

export interface ReservaPublica {
  id: string;
  tenantId: string;
  turnoId: string;
  perfilId: string;
  origen: OrigenReserva;
  esPrueba: boolean;
  pagoRealizado: boolean;
  /** ISO 8601 completo, o `null` si sigue activa. */
  canceladaEn: string | null;
  cancelacionTipo: TipoCancelacion | null;
  /** `null` = todavia no se paso lista en esa clase. */
  asistio: boolean | null;
}

export interface ReservaCreada extends ReservaPublica, ConAdvertencias {}

/** Consumo del pack de un perfil, siempre derivado de las reservas. */
export interface ConsumoDePack {
  /** Reservas que cuentan: las no canceladas y las canceladas como DEFINITIVA. */
  clasesConsumidas: number;
  /** `null` = el pack no impone tope (o no hay pack). */
  tope: number | null;
  agotado: boolean;
}
