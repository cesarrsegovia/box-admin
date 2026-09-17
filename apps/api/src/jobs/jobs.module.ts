import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CalendarioModule } from '../calendario/calendario.module';
import { GENERACION_MES_QUEUE } from './generacion-mes/cola';
import { GeneracionMesProcessor } from './generacion-mes/generacion-mes.processor';
import { PublicacionService } from './generacion-mes/publicacion.service';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: HEALTH_CHECK_QUEUE }),
    BullModule.registerQueue({ name: GENERACION_MES_QUEUE }),
    // CalendarioModule exporta CalendarioDatos, que el worker necesita para
    // recargar los datos antes de replanificar. No es un ciclo: calendario no
    // importa jobs, solo la cola (que vive en un archivo suelto sin modulo).
    CalendarioModule,
  ],
  controllers: [JobsController],
  providers: [HealthCheckProcessor, GeneracionMesProcessor, PublicacionService],
})
export class JobsModule {}
