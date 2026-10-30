import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LiquidacionService } from './liquidacion.service';

/**
 * La liquidacion vista por la propia profesora.
 *
 * Un controller aparte y no una ruta mas en `LiquidacionController`: aquel es
 * ADMIN_SALON porque «ensena tarifas» de cualquiera, y este es PROFESOR y
 * ensena SOLO las suyas. Sin id en la ruta: el perfil sale del token.
 */
@Controller('mi-liquidacion')
export class MiLiquidacionController {
  constructor(private readonly liquidacion: LiquidacionService) {}

  @Roles('PROFESOR')
  @Get()
  delMes(
    @CurrentUser() actor: JwtPayload,
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ): Promise<LiquidacionProfesor> {
    return this.liquidacion.deLaProfesora(actor, anio, mes);
  }
}
