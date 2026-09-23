import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { ListaEsperaService } from './lista-espera.service';

@Module({
  // Ya no importa NotificacionesModule: `asignarPrimero` devuelve el aviso en
  // vez de encolarlo, y quien encola es quien hizo commit (ReservasService).
  imports: [DisponibilidadModule],
  providers: [ListaEsperaService],
  exports: [ListaEsperaService],
})
export class ListaEsperaModule {}
