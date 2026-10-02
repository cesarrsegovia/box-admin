import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ClienteDeCache } from './cache-de-stats';

/**
 * El adaptador real de `ClienteDeCache`, sobre ioredis.
 *
 * ES UNA CLASE Y NO UN `useFactory` QUE DEVUELVA UN `new Redis(...)`, y el
 * motivo esta escrito en `app.module.ts` desde la Fase 0: una conexion creada a
 * mano dentro de una factory no la gestiona Nest, sobrevive a `app.close()` y
 * deja el proceso de Jest vivo para siempre. Paso con BullMQ, costo encontrarlo,
 * y la forma de que no vuelva a pasar es que el objeto que Nest guarda tenga un
 * `onModuleDestroy` que cierre la conexion. Una instancia suelta de ioredis no
 * lo tiene; esta clase si.
 *
 * `maxRetriesPerRequest` NO VA EN `null`, al reves que la conexion de BullMQ.
 * Alli es un requisito de sus comandos bloqueantes; aqui seria un error grave:
 * con `null` un comando contra un Redis caido no falla nunca —se queda en la
 * cola de reintentos— y `CacheDeStats.recordar`, que esta escrito para seguir
 * adelante cuando el cache no contesta, se quedaria esperando en vez de
 * calcular. Un reporte colgado es peor que un reporte lento: el 500 al menos se
 * ve. Con un tope de reintentos el comando RECHAZA, el `catch` del cache se lo
 * come y el reporte sale igual, que es el invariante que la Task 3 fijo.
 */
@Injectable()
export class CacheRedis implements ClienteDeCache, OnModuleDestroy {
  private readonly logger = new Logger(CacheRedis.name);
  private readonly redis: Redis;

  constructor(config: ConfigService) {
    this.redis = new Redis(config.getOrThrow<string>('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });

    // Sin un listener de `error`, un fallo de conexion de ioredis se emite como
    // un 'error' sin oyente y Node lo convierte en una excepcion no capturada
    // que tumba el proceso entero. Un Redis caido NO puede tirar la API: ese es
    // el mismo invariante que `CacheDeStats` protege en cada llamada.
    this.redis.on('error', (error: Error) => {
      this.logger.warn(`Redis del cache de stats: ${error.message}`);
    });
  }

  get(clave: string): Promise<string | null> {
    return this.redis.get(clave);
  }

  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown> {
    return this.redis.set(clave, valor, modo, segundos);
  }

  incr(clave: string): Promise<number> {
    return this.redis.incr(clave);
  }

  expire(clave: string, segundos: number): Promise<unknown> {
    return this.redis.expire(clave, segundos);
  }

  async onModuleDestroy(): Promise<void> {
    // `disconnect` y no `quit`: `quit` espera a que la cola de comandos se
    // vacie, y si Redis no esta contestando esa espera es justo el cuelgue que
    // esta clase existe para evitar.
    this.redis.disconnect();
  }
}
