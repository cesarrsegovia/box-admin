import { Module } from '@nestjs/common';
import { ListaEsperaModule } from '../lista-espera/lista-espera.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ReservasController, ReservasDeTurnoController } from './reservas.controller';
import { ReservasService } from './reservas.service';

@Module({
  // NotificacionesModule va aqui porque ReservasService es HOY EL UNICO que
  // encola: `asignarPrimero` devuelve el aviso en vez de mandarlo, asi que
  // ListaEsperaModule ya no lo importa. No hay ciclo: notificaciones no conoce
  // a reservas.
  imports: [ListaEsperaModule, NotificacionesModule],
  controllers: [ReservasDeTurnoController, ReservasController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule {}
