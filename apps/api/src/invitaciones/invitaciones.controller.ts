import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import type { ClaveInvitacionPublica, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarInvitacionDto } from './dto/actualizar-invitacion.dto';
import { CrearInvitacionDto } from './dto/crear-invitacion.dto';
import { InvitacionesService } from './invitaciones.service';

// ADMIN_OPERATIVO en las tres: es el mismo rol que ya da de alta alumnos y les
// asigna salas desde la Fase 1, y una clave de invitacion no es mas que esa
// misma operacion preparada por adelantado.
@Controller('invitaciones')
export class InvitacionesController {
  constructor(private readonly invitaciones: InvitacionesService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    return this.invitaciones.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(@CurrentUser() actor: JwtPayload): Promise<ClaveInvitacionPublica[]> {
    return this.invitaciones.listar(actor);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    return this.invitaciones.actualizar(actor, id, dto);
  }
}
