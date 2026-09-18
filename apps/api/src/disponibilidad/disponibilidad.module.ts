import { Module } from '@nestjs/common';
import { DisponibilidadService } from './disponibilidad.service';

@Module({
  providers: [DisponibilidadService],
  exports: [DisponibilidadService],
})
export class DisponibilidadModule {}
