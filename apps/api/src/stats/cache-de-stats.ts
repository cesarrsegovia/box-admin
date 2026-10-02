import { Inject, Injectable, Logger } from '@nestjs/common';

/**
 * Token de inyeccion. Hace falta explicito porque `ClienteDeCache` es una
 * interfaz de TypeScript y las interfaces no existen en tiempo de ejecucion:
 * Nest no puede usarlas como clave del contenedor. Mismo patron que
 * ALMACEN_DE_ARCHIVOS desde la Fase 3A y ENVIOS_DE_EMAIL desde la 5B.
 */
export const CLIENTE_DE_CACHE = Symbol('CLIENTE_DE_CACHE');

/**
 * Lo poco que este cache necesita de Redis.
 *
 * Es un puerto, como los de la Fase 5B: permite probar la logica entera sin
 * levantar un Redis, y deja a la vista que de toda la superficie de ioredis
 * aqui se usan exactamente tres metodos.
 */
export interface ClienteDeCache {
  get(clave: string): Promise<string | null>;
  set(clave: string, valor: string, modo: 'EX', segundos: number): Promise<unknown>;
  incr(clave: string): Promise<number>;
}

/** Cinco minutos. Los reportes no necesitan ser exactos al segundo. */
const TTL_SEGUNDOS = 300;

/**
 * El cache de los reportes: TTL corto mas un contador de version por gimnasio.
 *
 * POR QUE UN CONTADOR DE VERSION Y NO INVALIDACION DIRIGIDA. Con una lista de
 * claves a borrar en cada escritura, el dia que alguien agregue un reporte
 * nuevo se olvida de sumarlo a la lista y ese reporte queda permanentemente
 * desactualizado. Con el contador, un solo INCR deja huerfanas TODAS las claves
 * viejas de golpe: un reporte nuevo queda invalidado correctamente sin que
 * nadie lo recuerde. Invalida de mas —un pago tira tambien el cache de
 * ocupacion, que no cambio— y a esta escala eso no cuesta nada.
 *
 * LAS DOS DEFENSAS FALLAN HACIA EL MISMO LADO: el peor caso de olvidarse un
 * `invalidar` es llegar tarde cinco minutos, no quedar mal para siempre. El TTL
 * es la red del contador, y el contador es la precision que el TTL no da.
 *
 * NADA DE ESTO PUEDE ROMPER NADA. `recordar` calcula igual si Redis no
 * contesta: un panel que devuelve 500 porque el cache esta caido es peor que
 * uno lento. E `invalidar` NUNCA lanza, porque se llama dentro del servicio que
 * registra un pago y un Redis caido no puede convertir un cobro valido en un
 * 500 — el mismo invariante que el hook de notificaciones de la Fase 5B, y por
 * el mismo motivo.
 *
 * LO QUE SI SE DEJA PASAR es el error del PROPIO reporte. Si la consulta a
 * Postgres falla, el error sale: taparlo devolveria un cuerpo vacio que parece
 * un mes sin movimiento, que es peor que un error. Lo que este cache se traga
 * son los fallos de Redis, no los del dato.
 *
 * EL `tenantId` ES LA RAIZ DE LA CLAVE y quien llama es el responsable de que
 * sea el del actor autenticado. Este cache no puede comprobar que el valor que
 * `calcular` devuelve sea del gimnasio que dice ser: si alguien le pasa un
 * tenant y un calculo que no se corresponden, guarda feliz el numero de otro.
 */
@Injectable()
export class CacheDeStats {
  private readonly logger = new Logger(CacheDeStats.name);

  constructor(@Inject(CLIENTE_DE_CACHE) private readonly cliente: ClienteDeCache) {}

  async recordar<T>(tenantId: string, clave: string, calcular: () => Promise<T>): Promise<T> {
    const completa = `stats:${tenantId}:v${await this.version(tenantId)}:${clave}`;

    try {
      const guardado = await this.cliente.get(completa);
      if (guardado !== null) return JSON.parse(guardado) as T;
    } catch (error) {
      this.logger.warn(`No se pudo leer el cache de ${tenantId}: ${String(error)}`);
    }

    const calculado = await calcular();

    try {
      await this.cliente.set(completa, JSON.stringify(calculado), 'EX', TTL_SEGUNDOS);
    } catch (error) {
      this.logger.warn(`No se pudo guardar el cache de ${tenantId}: ${String(error)}`);
    }

    return calculado;
  }

  /** Tira todo el cache de un gimnasio. NUNCA lanza: ver el comentario de la clase. */
  async invalidar(tenantId: string): Promise<void> {
    try {
      await this.cliente.incr(`stats:${tenantId}:version`);
    } catch (error) {
      this.logger.warn(`No se pudo invalidar el cache de ${tenantId}: ${String(error)}`);
    }
  }

  private async version(tenantId: string): Promise<string> {
    try {
      // Sin version todavia es la cero: nadie invalido nunca este gimnasio.
      return (await this.cliente.get(`stats:${tenantId}:version`)) ?? '0';
    } catch {
      // Sin poder leer la version no hay clave de confianza que construir. Se
      // devuelve una distinta cada vez para que el `get` siguiente falle en
      // vacio y se recalcule, en vez de servir algo de una version que no se
      // pudo comprobar.
      return `sin-version-${Date.now()}`;
    }
  }
}
