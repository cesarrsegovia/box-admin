import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CalendarioModule } from '../calendario/calendario.module';
import { PagosModule } from '../pagos/pagos.module';
import { GENERACION_MES_QUEUE } from './generacion-mes/cola';
import { GeneracionMesProcessor } from './generacion-mes/generacion-mes.processor';
import { PublicacionService } from './generacion-mes/publicacion.service';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
  RECORDATORIO_PAGO_QUEUE,
  VENCIMIENTO_PACK_QUEUE,
} from './notificaciones/colas';
import { NotificacionListaEsperaProcessor } from './notificaciones/notificacion-lista-espera.processor';
import { NotificacionReservaProcessor } from './notificaciones/notificacion-reserva.processor';
import { RecordatorioPagoProcessor } from './notificaciones/recordatorio-pago.processor';
import { RegistroDeCrones } from './notificaciones/registro-de-crones';
import { VencimientoPackProcessor } from './notificaciones/vencimiento-pack.processor';

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
    // Estas dos se registran SOLO aqui, y en los dos papeles a la vez: aqui
    // viven sus processors (consumidor) y aqui vive `RegistroDeCrones`, que es
    // el unico que las llena (productor). No las encola ningun servicio: a los
    // jobs diarios los dispara un cron, no una peticion de nadie.
    BullModule.registerQueue({ name: RECORDATORIO_PAGO_QUEUE }),
    BullModule.registerQueue({ name: VENCIMIENTO_PACK_QUEUE }),
    // CalendarioModule exporta CalendarioDatos, que el worker necesita para
    // recargar los datos antes de replanificar. No es un ciclo: calendario no
    // importa jobs, solo la cola (que vive en un archivo suelto sin modulo).
    CalendarioModule,
    // PagosModule exporta PagosService, del que sale la regla de "estar al
    // dia". El recordatorio diario NO la reimplementa en un where: dos copias
    // de esa regla discrepan algun dia, y discrepar ahi significa escribirle a
    // quien ya pago.
    PagosModule,
  ],
  controllers: [JobsController],
  providers: [
    HealthCheckProcessor,
    GeneracionMesProcessor,
    PublicacionService,
    NotificacionReservaProcessor,
    NotificacionListaEsperaProcessor,
    RecordatorioPagoProcessor,
    VencimientoPackProcessor,
    RegistroDeCrones,
  ],
})
export class JobsModule {}
