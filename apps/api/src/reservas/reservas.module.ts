import { Module } from '@nestjs/common';
import { ListaEsperaModule } from '../lista-espera/lista-espera.module';
import { ReservasController, ReservasDeTurnoController } from './reservas.controller';
import { ReservasService } from './reservas.service';

@Module({
  imports: [ListaEsperaModule],
  controllers: [ReservasDeTurnoController, ReservasController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule {}
