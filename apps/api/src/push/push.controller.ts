import { Body, Controller, Delete, HttpCode, Post, Query } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { SuscribirDto } from './dto/suscribir.dto';
import { PushService } from './push.service';

/**
 * ⚠️ AQUI NO HAY, NI DEBE HABER, UN GET QUE LISTE SUSCRIPCIONES.
 *
 * El diseno tiene una contrapartida asumida: quien CONOZCA el endpoint de otro
 * alumno puede quedarse su navegador con un POST y dejarlo sin push en
 * silencio. No es fuga de datos —web-push cifra con las claves del atacante, y
 * el navegador de la victima no puede descifrar nada—, es denegacion de
 * servicio.
 *
 * Hoy es inalcanzable por una sola razon, y es esta: ninguna ruta de la API
 * expone endpoints ajenos. Todo el peso lo aguanta esa ausencia. Quien anada un
 * listado sin saberlo abre el camino.
 */
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Roles('ALUMNO')
  @HttpCode(204)
  @Post('suscripcion')
  suscribir(@CurrentUser() actor: JwtPayload, @Body() dto: SuscribirDto): Promise<void> {
    return this.push.suscribir(actor, dto);
  }

  @Roles('ALUMNO')
  @HttpCode(204)
  @Delete('suscripcion')
  desuscribir(
    @CurrentUser() actor: JwtPayload,
    @Query('endpoint') endpoint?: string,
  ): Promise<void> {
    return this.push.desuscribir(actor, endpoint);
  }
}
