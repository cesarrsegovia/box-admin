import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sendNotification, setVapidDetails, WebPushError } from 'web-push';
import type { DestinoPush, EnviosPush, MensajePush, ResultadoPush } from './envios.interface';

/**
 * El adaptador real de push.
 *
 * Sin claves VAPID queda desactivado en vez de impedir el arranque: son una
 * capacidad del despliegue, no un dato por gimnasio, y exigirlas obligaria a
 * cada desarrollador a generar un par solo para levantar la API. El email sigue
 * saliendo (decision D4 de la spec).
 */
@Injectable()
export class PushPorWebPush implements EnviosPush {
  private readonly logger = new Logger(PushPorWebPush.name);
  readonly habilitado: boolean;

  constructor(config: ConfigService) {
    const publica = config.get<string>('VAPID_PUBLIC_KEY');
    const privada = config.get<string>('VAPID_PRIVATE_KEY');

    // El estrechamiento vive en el `if` y no en un `Boolean(...)` aparte para
    // que TypeScript vea que dentro las dos claves son string.
    if (publica && privada) {
      this.habilitado = true;
      // El "subject" es obligatorio para web-push y sirve para que el servicio
      // del navegador sepa a quien reclamar si algo va mal.
      setVapidDetails(
        config.get<string>('VAPID_SUBJECT') ?? 'mailto:soporte@boxadmin.local',
        publica,
        privada,
      );
    } else {
      this.habilitado = false;
      this.logger.warn('Sin claves VAPID: las notificaciones push quedan desactivadas.');
    }
  }

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (!this.habilitado) return 'FALLO';

    try {
      await sendNotification(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(mensaje),
      );
      return 'ENVIADO';
    } catch (error) {
      // 404 y 410 significan que la suscripcion ya no existe en el navegador.
      // Quien llama la borra: sin eso, la tabla se llena de endpoints muertos a
      // los que se reintenta cada dia.
      //
      // `WebPushError` es una clase de verdad en tiempo de ejecucion, asi que
      // el instanceof distingue el rechazo del servicio de push de cualquier
      // otro fallo (DNS, red) en vez de asumir que todo error trae statusCode.
      if (error instanceof WebPushError && (error.statusCode === 404 || error.statusCode === 410)) {
        return 'CADUCADA';
      }

      // Solo los primeros caracteres del endpoint: la URL entera identifica una
      // suscripcion concreta y no tiene por que quedar en los logs.
      this.logger.warn(`Fallo el push a ${destino.endpoint.slice(0, 40)}...: ${String(error)}`);
      return 'FALLO';
    }
  }
}
