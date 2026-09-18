import { Module } from '@nestjs/common';
import { InvitacionesController } from './invitaciones.controller';
import { InvitacionesService } from './invitaciones.service';

@Module({
  controllers: [InvitacionesController],
  providers: [InvitacionesService],
  exports: [InvitacionesService],
})
export class InvitacionesModule {}
