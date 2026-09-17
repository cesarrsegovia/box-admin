import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { JwtPayload, RutinaPublica } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarRutinaDto } from './dto/actualizar-rutina.dto';
import { CrearRutinaDto } from './dto/crear-rutina.dto';
import { RutinasService } from './rutinas.service';

@Controller('rutinas')
export class RutinasController {
  constructor(private readonly rutinas: RutinasService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearRutinaDto): Promise<RutinaPublica> {
    return this.rutinas.crear(actor, dto);
  }

  // Las rutinas son datos de gestion, no de calendario: el alumno no las
  // consulta, asi que las cuatro rutas piden ADMIN_OPERATIVO.
  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('perfilId') perfilId?: string,
    @Query('salaId') salaId?: string,
    @Query('activa', new ParseBoolPipe({ optional: true })) activa?: boolean,
  ): Promise<RutinaPublica[]> {
    return this.rutinas.listar(actor, { perfilId, salaId, activa });
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarRutinaDto,
  ): Promise<RutinaPublica> {
    return this.rutinas.actualizar(actor, id, dto);
  }

  // Baja logica, como salas y packs: devuelve la fila para que el cliente vea
  // el nuevo estado. Borrarla perderia el rastro de por que existen los turnos
  // ya generados.
  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<RutinaPublica> {
    return this.rutinas.darDeBaja(actor, id);
  }
}
