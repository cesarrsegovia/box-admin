import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { LiquidacionService } from './liquidacion.service';

@Controller('liquidacion')
export class LiquidacionController {
  constructor(private readonly liquidacion: LiquidacionService) {}

  // ADMIN_SALON y no ADMIN_OPERATIVO: esto ensena tarifas.
  @Roles('ADMIN_SALON')
  @Get(':profesorId')
  delMes(
    @CurrentUser() actor: JwtPayload,
    @Param('profesorId') profesorId: string,
    @Query('anio', ParseIntPipe) anio: number,
    @Query('mes', ParseIntPipe) mes: number,
  ): Promise<LiquidacionProfesor> {
    return this.liquidacion.delMes(actor, profesorId, anio, mes);
  }
}
