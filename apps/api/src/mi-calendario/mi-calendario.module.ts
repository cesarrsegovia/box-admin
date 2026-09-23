import { Module } from '@nestjs/common';
import { DisponibilidadModule } from '../disponibilidad/disponibilidad.module';
import { ListaEsperaModule } from '../lista-espera/lista-espera.module';
import { PagosModule } from '../pagos/pagos.module';
import { ReservasModule } from '../reservas/reservas.module';
import { MiCalendarioController } from './mi-calendario.controller';
import { MiCalendarioService } from './mi-calendario.service';
import { MiPackService } from './mi-pack.service';

@Module({
  imports: [DisponibilidadModule, ListaEsperaModule, PagosModule, ReservasModule],
  controllers: [MiCalendarioController],
  providers: [MiCalendarioService, MiPackService],
  exports: [MiCalendarioService, MiPackService],
})
export class MiCalendarioModule {}
