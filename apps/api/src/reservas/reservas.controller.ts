import { Body, Controller, Delete, Param, Patch, Post, Query } from '@nestjs/common';
import type { JwtPayload, ReservaCreada, ReservaPublica } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { aTipoCancelacion, CancelarReservaDto } from './dto/cancelar-reserva.dto';
import { CrearReservaDto } from './dto/crear-reserva.dto';
import { ReasignarReservaDto } from './dto/reasignar-reserva.dto';
import { ReservasService } from './reservas.service';

@Controller('turnos/:turnoId/reservas')
export class ReservasDeTurnoController {
  constructor(private readonly reservas: ReservasService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
    @Body() dto: CrearReservaDto,
  ): Promise<ReservaCreada> {
    return this.reservas.crear(actor, turnoId, dto);
  }
}

/**
 * Una reserva se cancela por su propio id, no por el del turno: por eso este
 * controller cuelga de otra ruta base y va aparte del de `turnos/:turnoId/reservas`.
 */
@Controller('reservas')
export class ReservasController {
  constructor(private readonly reservas: ReservasService) {}

  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  cancelar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Query() query: CancelarReservaDto,
  ): Promise<ReservaPublica> {
    return this.reservas.cancelar(actor, id, aTipoCancelacion(query.tipo));
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/reasignar')
  reasignar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ReasignarReservaDto,
  ): Promise<ReservaPublica> {
    return this.reservas.reasignar(actor, id, dto);
  }
}
