import { Module } from '@nestjs/common';
import { LiquidacionController } from './liquidacion.controller';
import { LiquidacionDatos } from './liquidacion.datos';
import { LiquidacionService } from './liquidacion.service';

@Module({
  controllers: [LiquidacionController],
  providers: [LiquidacionService, LiquidacionDatos],
  exports: [LiquidacionService],
})
export class LiquidacionModule {}
