import type { OrigenReserva, PackPublico } from './nucleo.contracts';

// ---------------------------------------------------------------------------
// Disponibilidad
// ---------------------------------------------------------------------------

/**
 * El estado consolidado de un TURNO, que unifica en un solo concepto lo que en
 * TurnoFit son dos features separadas y confusas ("lista de espera" y "solo
 * cupos liberados").
 */
export type EstadoDisponibilidad = 'LIBRE' | 'SOLO_ADMIN' | 'LISTA_ESPERA' | 'LLENO';

/** Por que ESTE alumno no puede reservar ESTE turno ahora mismo. */
export type MotivoNoDisponible =
  | 'VENTANA_CERRADA'
  | 'SOLO_CUPOS_LIBERADOS'
  | 'YA_RESERVADO'
  | 'SIN_ACCESO_A_SALA'
  | 'SALA_NO_VISIBLE'
  | 'MES_NO_PUBLICADO';

export interface Disponibilidad {
  turnoId: string;
  /** Situacion del turno, independiente de quien pregunte. */
  estado: EstadoDisponibilidad;
  cupo: number;
  ocupados: number;
  /** Si ESTE alumno puede reservar ahora. */
  puedeReservar: boolean;
  /** El porque de `puedeReservar: false`. Null cuando puede, o cuando el estado ya lo explica. */
  motivo: MotivoNoDisponible | null;
  enListaEspera: boolean;
  /** 1 = el proximo en entrar. Null si no esta anotado. */
  posicionEnLista: number | null;
}

// ---------------------------------------------------------------------------
// Configuracion heredable
// ---------------------------------------------------------------------------

/** La forma que comparten `Sala` y `Tenant`: null = "hereda del siguiente nivel". */
export interface ConfigHeredable {
  minMinutosCancelar: number | null;
  minMinutosAnotarse: number | null;
  listaEsperaHabilitada: boolean | null;
}

/** El resultado de resolver la cascada. Sin nulls: aqui ya hay un valor para todo. */
export interface ConfiguracionEfectiva {
  minMinutosCancelar: number;
  minMinutosAnotarse: number;
  listaEsperaHabilitada: boolean;
}

// ---------------------------------------------------------------------------
// Claves de invitacion
// ---------------------------------------------------------------------------

export interface ClaveInvitacionPublica {
  id: string;
  tenantId: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  /** Null = ilimitada. */
  usosMax: number | null;
  usosActuales: number;
  expiraEn: string | null;
  packId: string | null;
  salaIds: string[];
}

// ---------------------------------------------------------------------------
// Comprobantes
// ---------------------------------------------------------------------------

export type EstadoComprobante = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO';

export interface ComprobantePublico {
  id: string;
  tenantId: string;
  perfilId: string;
  nombreOriginal: string;
  tipoMime: string;
  /** Null mientras el alumno no confirmo la subida. */
  subidoEn: string | null;
  estado: EstadoComprobante;
  revisadoPor: string | null;
  revisadoEn: string | null;
  nota: string | null;
  createdAt: string;
  /** Firmada y de vida corta. Null si todavia no hay archivo. */
  urlDeDescarga: string | null;
}

/** Respuesta del POST: la fila recien creada y donde subir el archivo. */
export interface ComprobanteCreado {
  comprobante: ComprobantePublico;
  urlDeSubida: string;
}

// ---------------------------------------------------------------------------
// Lista de espera
// ---------------------------------------------------------------------------

export interface EntradaListaEspera {
  id: string;
  tenantId: string;
  turnoId: string;
  perfilId: string;
  /** Derivada del orden por (createdAt, id). 1 = el proximo en entrar. */
  posicion: number;
  notificado: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Vistas del alumno
// ---------------------------------------------------------------------------

/** Una clase que el alumno tiene reservada. */
export interface MiClase {
  reservaId: string;
  turnoId: string;
  salaId: string;
  nombre: string;
  /** YYYY-MM-DD */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  origen: OrigenReserva;
  /** Si la ventana de cancelacion sigue abierta. */
  puedeCancelar: boolean;
}

/** Un turno que el alumno podria reservar, con su disponibilidad ya calculada. */
export interface TurnoDisponible {
  turnoId: string;
  salaId: string;
  nombre: string;
  fecha: string;
  horaInicio: string;
  horaFin: string;
  disponibilidad: Disponibilidad;
}

// ---------------------------------------------------------------------------
// Mi pack
// ---------------------------------------------------------------------------

/**
 * El estado del pack de un alumno, tal como lo ve el.
 *
 * `consumidas` NO se puede calcular en el cliente: cuenta tambien las reservas
 * canceladas como DEFINITIVA y se mide sobre la ventana del pack, no sobre el
 * rango que el alumno tenga abierto en pantalla.
 */
export interface MiPackPublico {
  pack: PackPublico | null;
  /** Tope de clases del periodo. null = sin pack, o pack sin tope. */
  tope: number | null;
  consumidas: number;
  /** null cuando no hay tope. Nunca negativo. */
  restantes: number | null;
  /** La ventana sobre la que se cuenta, en YYYY-MM-DD. null = sin limite por ese lado. */
  ventanaDesde: string | null;
  ventanaHasta: string | null;
  clasesExtra: number;
  cancelacionesUsadas: number;
  cancelacionesPermitidas: number | null;
  pagoAlDia: boolean;
  vigenciaDesde: string | null;
  vigenciaHasta: string | null;
}
