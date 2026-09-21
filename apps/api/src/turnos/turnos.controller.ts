import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload, TurnoPublico } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import { AsignarProfesorDto } from './dto/asignar-profesor.dto';
import { CrearTurnoDto } from './dto/crear-turno.dto';
import { TurnosService } from './turnos.service';

@Controller('turnos')
export class TurnosController {
  constructor(private readonly turnos: TurnosService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearTurnoDto): Promise<TurnoPublico> {
    return this.turnos.crear(actor, dto);
  }

  // Sin @Roles: el calendario lo consulta cualquier usuario autenticado del
  // gimnasio. La extension de tenant ya recorta el listado a su gimnasio.
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('salaId') salaId?: string,
    @Query('soloLibres', new ParseBoolPipe({ optional: true })) soloLibres?: boolean,
    @Query('profesorId') profesorId?: string,
  ): Promise<TurnoPublico[]> {
    return this.turnos.listar(actor, { desde, hasta, salaId, soloLibres, profesorId });
  }

  @Get(':id')
  obtener(@Param('id') id: string): Promise<TurnoPublico> {
    return this.turnos.obtener(id);
  }

  // La suplencia. Declarada ANTES de @Patch(':id') a proposito: Nest resuelve
  // las rutas por orden, y la generica se comeria ':id/profesor'.
  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/profesor')
  asignarProfesor(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AsignarProfesorDto,
  ): Promise<TurnoPublico> {
    return this.turnos.asignarProfesor(actor, id, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarTurnoDto,
  ): Promise<TurnoPublico> {
    return this.turnos.actualizar(actor, id, dto);
  }

  // 204 porque el borrado es fisico y no queda cuerpo que devolver, a
  // diferencia de las bajas logicas de salas y packs.
  @Roles('ADMIN_OPERATIVO')
  @HttpCode(204)
  @Delete(':id')
  eliminar(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.turnos.eliminar(actor, id);
  }
}
