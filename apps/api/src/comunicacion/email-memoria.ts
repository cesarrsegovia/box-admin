import { Injectable, Logger } from '@nestjs/common';
import type { DatosSmtp, EnviosDeEmail, MensajeDeEmail } from './envios.interface';

/** Lo enviado, mas de donde salio. SIN la contrasena. */
export interface EmailGuardado extends MensajeDeEmail {
  desde: string;
  host: string;
}

/**
 * El adaptador que usan los tests y el desarrollo: guarda lo que se habria
 * enviado y no toca la red.
 *
 * Deliberadamente NO guarda `smtp.clave`. Este objeto acaba impreso en el
 * primer `expect` que falla, y una credencial en la salida de un test es una
 * credencial filtrada.
 *
 * `enviados` NO SE EXPONE NUNCA POR UN ENDPOINT. Es un array del proceso, sin
 * particionar por gimnasio, con el HTML entero de cada mensaje —y ahi dentro
 * van el nombre y el email del alumno—. Hoy es inofensivo porque nada lo
 * publica; la ruta de conveniencia "ver los emails de prueba" lo convierte en
 * una fuga de datos personales ENTRE gimnasios el dia que alguien la anada sin
 * saber esto. Es la misma forma del problema que el GET de suscripciones que se
 * descarto en la Task 6.
 */
@Injectable()
export class EmailEnMemoria implements EnviosDeEmail {
  private readonly logger = new Logger(EmailEnMemoria.name);
  readonly enviados: EmailGuardado[] = [];

  async enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void> {
    this.enviados.push({ ...mensaje, desde: smtp.emailOrigen, host: smtp.host });
    this.logger.log(`[memoria] email a ${mensaje.para}: ${mensaje.asunto}`);
  }

  /**
   * `_smtp` NO se puede omitir aunque ESLint lo marque como no usado: quien
   * llama lo hace sobre esta clase concreta —los tests, sin pasar por la
   * interfaz— y quitarlo convierte cada llamada en un TS2554 que no compila.
   * El guion bajo es la senal de que sobra a proposito, no de que falte algo.
   */
  async verificar(_smtp: DatosSmtp): Promise<void> {
    // No hay contra que conectar. Es una diferencia real de comportamiento
    // entre entornos y esta documentada en el README.
  }

  limpiar(): void {
    this.enviados.length = 0;
  }
}
