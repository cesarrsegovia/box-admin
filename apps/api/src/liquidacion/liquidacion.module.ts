import { Module } from '@nestjs/common';
import { LiquidacionController } from './liquidacion.controller';
import { LiquidacionDatos } from './liquidacion.datos';
import { LiquidacionService } from './liquidacion.service';
import { MiLiquidacionController } from './mi-liquidacion.controller';

@Module({
  controllers: [LiquidacionController, MiLiquidacionController],
  providers: [LiquidacionService, LiquidacionDatos],
  exports: [LiquidacionService],
})
export class LiquidacionModule {}
