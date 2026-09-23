import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload, PagoPublico } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearPagoDto } from './dto/crear-pago.dto';
import { PagosService } from './pagos.service';

@Controller('pagos')
export class PagosController {
  constructor(private readonly pagos: PagosService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearPagoDto): Promise<PagoPublico> {
    return this.pagos.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @Query('perfilId') perfilId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<PagoPublico[]> {
    return this.pagos.listar({ perfilId, desde, hasta });
  }

  // ADMIN_SALON y no ADMIN_OPERATIVO: registrar un cobro es operativo,
  // deshacerlo es contable.
  @Roles('ADMIN_SALON')
  @Patch(':id/anular')
  anular(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<PagoPublico> {
    return this.pagos.anular(actor, id);
  }
}
