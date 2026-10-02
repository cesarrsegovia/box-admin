import { Global, Module } from '@nestjs/common';
import { CacheDeStats, CLIENTE_DE_CACHE } from './cache-de-stats';
import { CacheRedis } from './cache-redis';

/**
 * El cache de los reportes, y su conexion a Redis.
 *
 * VIVE EN SU PROPIO MODULO Y ES GLOBAL, en vez de ser un proveedor mas de
 * `StatsModule` como decia el plan. El motivo es un ciclo: `StatsModule`
 * necesita `PagosModule` (de ahi sale el `estaAlDia` que el pendiente estimado
 * reutiliza) y `LiquidacionModule`, pero la Task 5 tiene que llamar a
 * `invalidar` DENTRO de `PagosService`, `ReservasService` y `MisClasesService`
 * — o sea, esos tres modulos tendrian que importar `StatsModule`, que ya
 * importa a uno de ellos. Con el cache aqui, la dependencia va en un solo
 * sentido y no hace falta un `forwardRef`, que es un ciclo igual pero
 * disimulado.
 *
 * Global por el mismo motivo que `ComunicacionModule` desde la Fase 5B:
 * encadenar imports por todo el arbol solo para repartir un token no aporta
 * nada, y la lista de sitios que invalidan va a crecer.
 */
@Global()
@Module({
  providers: [CacheDeStats, { provide: CLIENTE_DE_CACHE, useClass: CacheRedis }],
  exports: [CacheDeStats],
})
export class CacheModule {}
