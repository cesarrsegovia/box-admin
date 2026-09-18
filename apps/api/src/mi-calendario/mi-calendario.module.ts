import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { ListaEsperaModule } from '../lista-espera/lista-espera.module';
import { ReservasModule } from '../reservas/reservas.module';
import { MiCalendarioController } from './mi-calendario.controller';
import { MiCalendarioService } from './mi-calendario.service';

@Module({
  imports: [DisponibilidadModule, ListaEsperaModule, ReservasModule],
  controllers: [MiCalendarioController],
  providers: [MiCalendarioService],
  exports: [MiCalendarioService],
})
export class MiCalendarioModule {}
