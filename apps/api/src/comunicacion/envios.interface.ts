/**
 * Tokens de inyeccion. Hacen falta explicitos porque `EnviosDeEmail` y
 * `EnviosPush` son interfaces de TypeScript, y las interfaces no existen en
 * tiempo de ejecucion: Nest no puede usarlas como clave del contenedor. Mismo
 * patron que ALMACEN_DE_ARCHIVOS desde la Fase 3A.
 */
export const ENVIOS_DE_EMAIL = Symbol('ENVIOS_DE_EMAIL');
export const ENVIOS_PUSH = Symbol('ENVIOS_PUSH');

/** Los datos de conexion, ya descifrados. Viven en memoria y no se loguean. */
export interface DatosSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  clave: string;
  emailOrigen: string;
}

export interface MensajeDeEmail {
  para: string;
  /**
   * Copia interna al salon, si la configuro. Va en BCC, nunca en CC: el salon
   * quiere guardarse copia de lo que sale, no presentarle su buzon interno a
   * cada alumno que abre el email.
   */
  copia: string | null;
  asunto: string;
  html: string;
}

export interface EnviosDeEmail {
  enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void>;
  /**
   * Abre la conexion y la cierra. Lanza con el motivo si no se puede.
   * El adaptador de memoria siempre resuelve: no hay contra que conectar.
   */
  verificar(smtp: DatosSmtp): Promise<void>;
}

export interface DestinoPush {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface MensajePush {
  titulo: string;
  cuerpo: string;
  /** Adonde lleva al tocarla. */
  url: string;
}

/** Que hacer con la suscripcion despues del intento. */
export type ResultadoPush = 'ENVIADO' | 'CADUCADA' | 'FALLO';

export interface EnviosPush {
  /** `false` = el push esta desactivado (sin VAPID). Quien llama se salta el paso. */
  readonly habilitado: boolean;
  enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush>;
}
