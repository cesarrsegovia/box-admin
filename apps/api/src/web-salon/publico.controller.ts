import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { SalonPublico } from '@boxadmin/shared';
import { Public } from '../common/decorators/public.decorator';
import { NO_HAY_WEB, PublicoService } from './publico.service';

/**
 * El slug tal y como lo acepta `CreateTenantDto`: minusculas, numeros y
 * guiones, de 2 a 60 caracteres.
 *
 * Se comprueba aqui porque el parametro viene de la URL y por tanto NO pasa por
 * el ValidationPipe, igual que el `:tipo` de las plantillas de la Fase 5B. Sin
 * esto, cualquier cadena —un slug de diez kilobytes, un `%00`— llegaria a la
 * consulta de la base desde una ruta sin sesion.
 */
const FORMA_DEL_SLUG = /^[a-z0-9-]{2,60}$/;

/**
 * EL UNICO ENDPOINT SIN SESION QUE LEE DATOS DE UN GIMNASIO.
 *
 * No lleva `@Throttle` propio: el limite general del `ThrottlerModule` ya lo
 * cubre, y la defensa que importa aqui no es el freno sino que las cuatro
 * formas de "no hay web" devuelvan la misma respuesta. Con eso, martillar la
 * ruta probando nombres no distingue un gimnasio que existe de uno que no, asi
 * que no hay nada que enumerar aunque se pueda llamar muchas veces.
 */
@Controller('public/salon')
export class PublicoController {
  constructor(private readonly publico: PublicoService) {}

  @Public()
  @Get(':slug')
  salon(@Param('slug') slug: string): Promise<SalonPublico> {
    if (!FORMA_DEL_SLUG.test(slug)) {
      // EL MISMO 404 que da el service, y el mismo literal, no un 400. Un 400
      // por "slug mal formado" y un 404 por "no hay web" ya son dos respuestas
      // distintas, y la lista de slugs posibles se estrecha con cada una.
      throw new NotFoundException(NO_HAY_WEB);
    }

    return this.publico.salon(slug);
  }
}
