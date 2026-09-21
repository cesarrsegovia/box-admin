import { Module } from '@nestjs/common';
import { MisClasesController } from './mis-clases.controller';
import { MisClasesService } from './mis-clases.service';

@Module({
  controllers: [MisClasesController],
  providers: [MisClasesService],
  exports: [MisClasesService],
})
export class MisClasesModule {}
