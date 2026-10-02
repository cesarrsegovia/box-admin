import { Module } from '@nestjs/common';
import { LiquidacionModule } from '../liquidacion/liquidacion.module';
import { PagosModule } from '../pagos/pagos.module';
import { StatsController } from './stats.controller';
import { StatsDatos } from './stats.datos';
import { StatsService } from './stats.service';

/**
 * Los reportes de solo lectura de la Fase 6A.
 *
 * Importa `LiquidacionModule` porque el costo de profesoras de la caja es
 * exactamente el mismo calculo que el reporte individual —asi cuadran por
 * construccion— y `PagosModule` porque `estaAlDia` tiene una sola
 * implementacion desde la 5A y esta no va a ser la segunda.
 *
 * `CacheDeStats` no se provee aqui: vive en `CacheModule`, que es global. El
 * porque esta escrito en ese archivo.
 */
@Module({
  imports: [LiquidacionModule, PagosModule],
  controllers: [StatsController],
  providers: [StatsService, StatsDatos],
})
export class StatsModule {}
