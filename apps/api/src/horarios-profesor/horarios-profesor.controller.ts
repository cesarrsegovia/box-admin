import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { HorarioProfesorPublico, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarHorarioProfesorDto } from './dto/actualizar-horario-profesor.dto';
import { CrearHorarioProfesorDto } from './dto/crear-horario-profesor.dto';
import { HorariosProfesorService } from './horarios-profesor.service';

@Controller('horarios-profesor')
export class HorariosProfesorController {
  constructor(private readonly horarios: HorariosProfesorService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    return this.horarios.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @Query('profesorId') profesorId?: string,
    @Query('salaId') salaId?: string,
  ): Promise<HorarioProfesorPublico[]> {
    return this.horarios.listar({ profesorId, salaId });
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    return this.horarios.actualizar(actor, id, dto);
  }

  // 204 y baja logica: la fila se conserva porque la liquidacion de los meses
  // ya cerrados la sigue necesitando.
  @Roles('ADMIN_OPERATIVO')
  @HttpCode(204)
  @Delete(':id')
  eliminar(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.horarios.eliminar(actor, id);
  }
}
