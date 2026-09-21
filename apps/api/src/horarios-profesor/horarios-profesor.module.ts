import { Module } from '@nestjs/common';
import { HorariosProfesorController } from './horarios-profesor.controller';
import { HorariosProfesorService } from './horarios-profesor.service';

@Module({
  controllers: [HorariosProfesorController],
  providers: [HorariosProfesorService],
  exports: [HorariosProfesorService],
})
export class HorariosProfesorModule {}
