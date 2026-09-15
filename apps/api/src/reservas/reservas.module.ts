import { Module } from '@nestjs/common';
import { ReservasController, ReservasDeTurnoController } from './reservas.controller';
import { ReservasService } from './reservas.service';

@Module({
  controllers: [ReservasDeTurnoController, ReservasController],
  providers: [ReservasService],
  exports: [ReservasService],
})
export class ReservasModule {}
