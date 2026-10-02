import type { Importe } from './dinero.contracts';
import type { MetodoPago } from './pagos.contracts';

/** Un metodo de pago con lo que entro por el. */
export interface CobradoPorMetodo {
  /**
   * El enum, no un `string`. Es el campo que viaja al cliente, asi que tiparlo
   * suelto perderia el chequeo justo donde mas se nota: un dia alguien escribe
   * `'EFECTVO'` en un filtro del panel y no se entera hasta que el desglose le
   * sale vacio.
   */
  metodo: MetodoPago;
  importe: Importe;
}

/**
 * La caja de un mes.
 *
 * `cobrado` EXCLUYE las cortesias y `bonificado` las junta aparte. Una cortesia
 * es un metodo de pago normal y nada obliga a que su monto sea cero: sumarla al
 * cobrado haria que un mes en el que el gimnasio regalo cuotas apareciera como
 * facturacion.
 *
 * OJO CON LAS BASES, y esta escrito aqui a proposito: `cobrado` es CAJA —se
 * cuenta por `Pago.createdAt`, cuando entro el dinero— y `costoProfesoras` es
 * DEVENGADO —las clases de ese mes—. Un alumno que paga octubre el 28 de
 * septiembre entra en la caja de septiembre. Es la base correcta para "cuanto
 * entro este mes", pero el margen de un mes concreto puede verse raro si
 * alguien cobra muy adelantado.
 */
export interface CajaDelMes {
  anio: number;
  mes: number;
  cobrado: Importe;
  porMetodo: CobradoPorMetodo[];
  bonificado: Importe;
  costoProfesoras: Importe;
  margen: Importe;
  pendienteEstimado: Importe;
}

/**
 * Un porcentaje con su fraccion a la vista.
 *
 * El numerador y el denominador viajan SIEMPRE. Sin ellos, un 0% y un "no hay
 * datos" se ven igual, y son cosas distintas: `denominador: 0` significa que la
 * pregunta no se puede contestar, no que la respuesta sea cero.
 */
export interface Porcentaje {
  numerador: number;
  denominador: number;
  /** `null` cuando el denominador es cero. */
  porcentaje: number | null;
}

export interface MetricasOperativas {
  anio: number;
  mes: number;
  ocupacion: Porcentaje;
  /** Denominador: reservas de turnos donde SE PASO LISTA. Ver la spec, 6. */
  asistencia: Porcentaje;
  cobranza: Porcentaje;
  cancelacionRecuperable: Porcentaje;
  cancelacionDefinitiva: Porcentaje;
}

export interface Operativo {
  actual: MetricasOperativas;
  /** Los tres meses anteriores, del mas viejo al mas nuevo. */
  trimestre: MetricasOperativas[];
}

export interface TurnoLibre {
  turnoId: string;
  salaId: string;
  salaNombre: string;
  /** `YYYY-MM-DD`. */
  fecha: string;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  reservados: number;
  libres: number;
}

export interface PagoPendiente {
  perfilId: string;
  nombreCompleto: string;
  email: string;
  packNombre: string | null;
  /**
   * El precio del pack. Es un ESTIMADO y por eso se llama asi: el sistema no
   * lleva cuenta corriente, asi que esto es lo que costaria ponerse al dia con
   * un pack, no una deuda calculada.
   */
  pendienteEstimado: Importe;
  cancelacionesDelMes: number;
}

export interface ComposicionPorPack {
  packId: string | null;
  packNombre: string;
  alumnos: number;
  porcentaje: number;
}

export interface ConsumoDeAlumno {
  perfilId: string;
  nombreCompleto: string;
  /** Reservas vivas del mes. Derivado, como desde la Fase 1. */
  clasesTomadas: number;
}

export interface ComposicionAlumnos {
  anio: number;
  mes: number;
  totalAlumnos: number;
  porPack: ComposicionPorPack[];
  consumo: ConsumoDeAlumno[];
}

export interface AsistenciaDeAlumno {
  perfilId: string;
  nombreCompleto: string;
  presentes: number;
  ausentes: number;
  /** `null` si no se le paso lista ni una vez en el rango. */
  porcentaje: number | null;
}

export interface ReporteAsistencia {
  desde: string;
  hasta: string;
  alumnos: AsistenciaDeAlumno[];
}
