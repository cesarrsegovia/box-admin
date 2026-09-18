import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AlmacenLocal } from './almacen-local';
import { AlmacenLocalController } from './almacen-local.controller';
import { AlmacenS3 } from './almacen-s3';
import { ALMACEN_DE_ARCHIVOS } from './almacen.interface';

/**
 * El adaptador se elige en el arranque, no en cada llamada: asi un error de
 * configuracion sale al levantar la aplicacion y no la primera vez que alguien
 * sube un comprobante.
 *
 * El controller del almacen local SOLO se registra cuando ALMACEN_TIPO es
 * `local`. En produccion esas rutas no existen, que es mas fuerte que dejarlas
 * existir y confiar en que la firma las proteja.
 */
@Module({})
export class AlmacenModule {
  static forRoot(): DynamicModule {
    const esLocal = (process.env.ALMACEN_TIPO ?? 'local') === 'local';

    return {
      module: AlmacenModule,
      controllers: esLocal ? [AlmacenLocalController] : [],
      providers: [
        AlmacenLocal,
        {
          provide: ALMACEN_DE_ARCHIVOS,
          inject: [ConfigService],
          useFactory: (config: ConfigService): AlmacenLocal | AlmacenS3 =>
            esLocal ? new AlmacenLocal(config) : new AlmacenS3(config),
        },
      ],
      exports: [ALMACEN_DE_ARCHIVOS],
    };
  }
}
