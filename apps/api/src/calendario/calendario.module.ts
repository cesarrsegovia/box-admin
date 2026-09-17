import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { GENERACION_MES_QUEUE } from '../jobs/generacion-mes/cola';
import { CalendarioController } from './calendario.controller';
import { CalendarioDatos } from './calendario.datos';
import { CalendarioService } from './calendario.service';

@Module({
  imports: [BullModule.registerQueue({ name: GENERACION_MES_QUEUE })],
  controllers: [CalendarioController],
  providers: [CalendarioDatos, CalendarioService],
  exports: [CalendarioDatos],
})
export class CalendarioModule {}
