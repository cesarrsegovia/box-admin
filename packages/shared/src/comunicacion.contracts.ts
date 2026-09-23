// ---------------------------------------------------------------------------
// Fase 5B — Comunicacion
// ---------------------------------------------------------------------------

export type TipoPlantilla =
  'CONFIRMACION' | 'CANCELACION' | 'RECORDATORIO_PAGO' | 'LISTA_ESPERA' | 'VENCIMIENTO_PACK';

export const TIPOS_DE_PLANTILLA: TipoPlantilla[] = [
  'CONFIRMACION',
  'CANCELACION',
  'RECORDATORIO_PAGO',
  'LISTA_ESPERA',
  'VENCIMIENTO_PACK',
];

/**
 * La configuracion SMTP tal como la ve el admin.
 *
 * NO lleva la contrasena, ni cifrada ni enmascarada: una mascara sigue
 * confirmando su longitud. Solo dice si hay una guardada.
 */
export interface ConfiguracionSmtpPublica {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  emailOrigen: string;
  emailDestino: string | null;
  tieneClave: boolean;
  /** ISO 8601. */
  actualizadoEn: string;
}

export interface PlantillaPublica {
  tipo: TipoPlantilla;
  asunto: string;
  cuerpoHtml: string;
  /** `true` = es la del codigo; el gimnasio no configuro la suya. */
  esPorDefecto: boolean;
}

/** Lo que el navegador entrega al suscribirse. */
export interface SuscripcionPushEntrada {
  endpoint: string;
  p256dh: string;
  auth: string;
}
