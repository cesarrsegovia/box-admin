import { Injectable } from '@nestjs/common';
import type { DestinoPush, EnviosPush, MensajePush, ResultadoPush } from './envios.interface';

/**
 * El adaptador de push que usan los tests y el desarrollo: apunta lo que se
 * habria mandado y no toca la red.
 *
 * `habilitado` es `true` aunque no haya claves VAPID: aca no hacen falta, y con
 * `false` los tests no podrian ejercitar el camino en el que el push si sale.
 */
@Injectable()
export class PushEnMemoria implements EnviosPush {
  readonly habilitado = true;
  readonly enviados: { endpoint: string; mensaje: MensajePush }[] = [];

  /** Endpoints que el doble debe tratar como caducados, para probar la limpieza. */
  readonly caducados = new Set<string>();

  async enviar(destino: DestinoPush, mensaje: MensajePush): Promise<ResultadoPush> {
    if (this.caducados.has(destino.endpoint)) return 'CADUCADA';

    this.enviados.push({ endpoint: destino.endpoint, mensaje });
    return 'ENVIADO';
  }

  limpiar(): void {
    this.enviados.length = 0;
    this.caducados.clear();
  }
}
