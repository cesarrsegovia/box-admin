import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CalendarioModule } from '../calendario/calendario.module';
import { GENERACION_MES_QUEUE } from './generacion-mes/cola';
import { GeneracionMesProcessor } from './generacion-mes/generacion-mes.processor';
import { PublicacionService } from './generacion-mes/publicacion.service';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
} from './notificaciones/colas';
import { NotificacionListaEsperaProcessor } from './notificaciones/notificacion-lista-espera.processor';
import { NotificacionReservaProcessor } from './notificaciones/notificacion-reserva.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: HEALTH_CHECK_QUEUE }),
    BullModule.registerQueue({ name: GENERACION_MES_QUEUE }),
    // Aqui se registra como CONSUMIDOR: NotificacionesModule ya la registra
    // como productor. Registrarla en los dos sitios no duplica la cola —BullMQ
    // las identifica por nombre—, y es lo que hace que el Worker arranque en
    // este modulo, que es donde vive el processor.
    BullModule.registerQueue({ name: NOTIFICACION_RESERVA_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICACION_LISTA_ESPERA_QUEUE }),
    // CalendarioModule exporta CalendarioDatos, que el worker necesita para
    // recargar los datos antes de replanificar. No es un ciclo: calendario no
    // importa jobs, solo la cola (que vive en un archivo suelto sin modulo).
    CalendarioModule,
  ],
  controllers: [JobsController],
  providers: [
    HealthCheckProcessor,
    GeneracionMesProcessor,
    PublicacionService,
    NotificacionReservaProcessor,
    NotificacionListaEsperaProcessor,
  ],
})
export class JobsModule {}
