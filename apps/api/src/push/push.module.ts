import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/**
 * No importa ComunicacionModule: ese es global y ya expone ENVIOS_PUSH a todo
 * el arbol. Aqui solo se exporta el servicio, porque los processors de
 * notificaciones llaman a `notificar` con el cliente de su propia transaccion.
 */
@Module({
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
