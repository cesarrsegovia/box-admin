import { Module } from '@nestjs/common';
import { AlmacenModule } from '../almacen/almacen.module';
import { ComprobantesController } from './comprobantes.controller';
import { ComprobantesService } from './comprobantes.service';

@Module({
  imports: [AlmacenModule.forRoot()],
  controllers: [ComprobantesController],
  providers: [ComprobantesService],
  exports: [ComprobantesService],
})
export class ComprobantesModule {}
