import { Module } from '@nestjs/common';
import { HorariosProfesorModule } from '../horarios-profesor/horarios-profesor.module';
import { TurnosController } from './turnos.controller';
import { TurnosService } from './turnos.service';

@Module({
  imports: [HorariosProfesorModule],
  controllers: [TurnosController],
  providers: [TurnosService],
  exports: [TurnosService],
})
export class TurnosModule {}
