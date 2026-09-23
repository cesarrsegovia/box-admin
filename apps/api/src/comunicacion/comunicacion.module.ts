import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushModule } from '../push/push.module';
import { ConfigEmailController } from './config-email.controller';
import { ConfigEmailService } from './config-email.service';
import { EmailEnMemoria } from './email-memoria';
import { EmailPorSmtp } from './email-smtp';
import { ENVIOS_DE_EMAIL, ENVIOS_PUSH } from './envios.interface';
import { MensajeroService } from './mensajero.service';
import { PushEnMemoria } from './push-memoria';
import { PushPorWebPush } from './push-webpush';

/**
 * Los adaptadores se eligen en el arranque, no en cada llamada: asi un error de
 * configuracion sale al levantar la aplicacion y no la primera vez que alguien
 * espera un email. Mismo patron que AlmacenModule desde la Fase 3A.
 *
 * El modulo es global porque los cuatro processors, el servicio de
 * configuracion y el de push necesitan los puertos, y encadenar imports por
 * todo el arbol solo para eso no aporta nada.
 */
@Module({})
export class ComunicacionModule {
  static forRoot(): DynamicModule {
    const emailEnMemoria = (process.env.EMAIL_TIPO ?? 'memoria') === 'memoria';
    const pushEnMemoria = (process.env.PUSH_TIPO ?? 'memoria') === 'memoria';

    return {
      module: ComunicacionModule,
      global: true,
      // MensajeroService necesita PushService. No hay ciclo: PushModule NO
      // importa ComunicacionModule —el token ENVIOS_PUSH le llega porque este
      // modulo es global—, asi que la dependencia va en un solo sentido.
      imports: [PushModule],
      controllers: [ConfigEmailController],
      providers: [
        ConfigEmailService,
        MensajeroService,
        {
          provide: ENVIOS_DE_EMAIL,
          // Sin `inject`: ninguno de los dos adaptadores de email necesita
          // ConfigService. La configuracion SMTP es de cada gimnasio y llega
          // como argumento de `enviar`, no del entorno.
          useFactory: (): EmailEnMemoria | EmailPorSmtp =>
            emailEnMemoria ? new EmailEnMemoria() : new EmailPorSmtp(),
        },
        {
          provide: ENVIOS_PUSH,
          inject: [ConfigService],
          useFactory: (config: ConfigService): PushEnMemoria | PushPorWebPush =>
            pushEnMemoria ? new PushEnMemoria() : new PushPorWebPush(config),
        },
      ],
      // ConfigEmailService se exporta porque los processors lo necesitan para
      // resolver el SMTP y la plantilla del gimnasio antes de cada envio.
      exports: [ENVIOS_DE_EMAIL, ENVIOS_PUSH, ConfigEmailService, MensajeroService],
    };
  }
}
