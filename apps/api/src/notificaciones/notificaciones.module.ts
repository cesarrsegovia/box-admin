import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
} from '../jobs/notificaciones/colas';
import { NotificacionesService } from './notificaciones.service';

/**
 * Registra las dos colas como PRODUCTOR. Los processors que las consumen viven
 * en JobsModule; el nombre es lo unico que comparten, y vive en un archivo
 * suelto sin modulo (`jobs/notificaciones/colas.ts`), asi que no hay ciclo.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICACION_RESERVA_QUEUE }),
    BullModule.registerQueue({ name: NOTIFICACION_LISTA_ESPERA_QUEUE }),
  ],
  providers: [NotificacionesService],
  exports: [NotificacionesService],
})
export class NotificacionesModule {}
