import { Module } from '@nestjs/common';
import { PublicoController } from './publico.controller';
import { PublicoService } from './publico.service';
import { WebSalonController } from './web-salon.controller';
import { WebSalonService } from './web-salon.service';

/**
 * Las dos mitades de la web del salon: la configuracion, que pide ADMIN_SALON,
 * y la lectura publica, que no pide nada.
 *
 * Van en el MISMO modulo y en servicios SEPARADOS a proposito: comparten los
 * datos pero no el criterio de que se puede leer. `WebSalonService` devuelve la
 * configuracion entera, banderas incluidas; `PublicoService` arma a mano un
 * objeto que solo lleva lo que el gimnasio eligio publicar. Fusionarlos seria
 * exactamente la forma de que un campo nuevo del lado admin acabe un dia en
 * una pagina indexada.
 */
@Module({
  controllers: [WebSalonController, PublicoController],
  providers: [WebSalonService, PublicoService],
  exports: [WebSalonService, PublicoService],
})
export class WebSalonModule {}
