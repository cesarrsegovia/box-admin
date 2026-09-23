import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import type { DatosSmtp, EnviosDeEmail, MensajeDeEmail } from './envios.interface';

/** Lo que se espera a conectar, a que salude y a cada respuesta. */
const MILIS_DE_ESPERA = 10_000;

/**
 * El adaptador real.
 *
 * Crea un transporte POR ENVIO en vez de cachearlo: la configuracion es de cada
 * gimnasio y puede cambiar en cualquier momento, y un transporte cacheado
 * seguiria usando la contrasena vieja hasta reiniciar.
 *
 * NUNCA loguea `smtp.clave`, ni en debug. El manual de TurnoFit avisaba de esto
 * explicitamente y es la clase de cosa que se cuela en un console.log de
 * depuracion y se queda ahi.
 */
@Injectable()
export class EmailPorSmtp implements EnviosDeEmail {
  async enviar(smtp: DatosSmtp, mensaje: MensajeDeEmail): Promise<void> {
    const transporte = this.transporte(smtp);
    try {
      await transporte.sendMail({
        from: smtp.emailOrigen,
        to: mensaje.para,
        // BCC y no CC: con CC, el alumno ve la direccion interna del gimnasio
        // en su cliente de correo. El salon quiere copia, no exponer su buzon.
        ...(mensaje.copia === null ? {} : { bcc: mensaje.copia }),
        subject: mensaje.asunto,
        html: mensaje.html,
      });
    } finally {
      transporte.close();
    }
  }

  async verificar(smtp: DatosSmtp): Promise<void> {
    const transporte = this.transporte(smtp);
    try {
      await transporte.verify();
    } finally {
      transporte.close();
    }
  }

  private transporte(smtp: DatosSmtp): Transporter {
    return createTransport({
      host: smtp.host,
      port: smtp.puerto,
      secure: smtp.seguro,
      auth: { user: smtp.usuario, pass: smtp.clave },
      // Los tres timeouts son explicitos porque los de nodemailer son de dos
      // minutos, y dos minutos aca se pagan en dos sitios: `verificar` corre
      // dentro de un PUT /config/smtp sincrono, asi que un host mal tecleado
      // que hace blackhole deja la peticion colgada todo ese rato; y en los
      // processors, bloquea un worker de BullMQ igual de largo. Diez segundos
      // son de sobra para un SMTP que responde.
      connectionTimeout: MILIS_DE_ESPERA,
      greetingTimeout: MILIS_DE_ESPERA,
      socketTimeout: MILIS_DE_ESPERA,
    });
  }
}
