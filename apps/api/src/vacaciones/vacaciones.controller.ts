import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { JwtPayload, VacacionPublica } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearVacacionDto } from './dto/crear-vacacion.dto';
import { VacacionesService } from './vacaciones.service';

// Las vacaciones son un dato de gestion que carga el mostrador por el alumno:
// las tres rutas piden ADMIN_OPERATIVO.
@Controller('vacaciones-alumnos')
export class VacacionesController {
  constructor(private readonly vacaciones: VacacionesService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearVacacionDto): Promise<VacacionPublica> {
    return this.vacaciones.crear(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('perfilId') perfilId?: string,
  ): Promise<VacacionPublica[]> {
    return this.vacaciones.listar(actor, { perfilId });
  }

  // Borrado real, no baja logica: unas vacaciones mal cargadas se corrigen
  // borrandolas. Devuelve la fila borrada para que el cliente pueda deshacer.
  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<VacacionPublica> {
    return this.vacaciones.darDeBaja(actor, id);
  }
}
