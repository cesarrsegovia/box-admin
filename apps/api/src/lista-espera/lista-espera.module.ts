import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { ListaEsperaService } from './lista-espera.service';

@Module({
  imports: [DisponibilidadModule, NotificacionesModule],
  providers: [ListaEsperaService],
  exports: [ListaEsperaService],
})
export class ListaEsperaModule {}
