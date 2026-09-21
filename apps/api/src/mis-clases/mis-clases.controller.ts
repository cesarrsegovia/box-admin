import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  esFechaValida,
  type AlumnoEnClase,
  type ClaseDelProfesor,
  type JwtPayload,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { PasarListaDto } from './dto/pasar-lista.dto';
import { MisClasesService } from './mis-clases.service';

@Controller('mis-clases')
export class MisClasesController {
  constructor(private readonly misClases: MisClasesService) {}

  @Roles('PROFESOR')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
  ): Promise<ClaseDelProfesor[]> {
    exigirRango(desde, hasta);
    return this.misClases.misClases(actor, { desde, hasta });
  }

  @Roles('PROFESOR')
  @Get(':turnoId/alumnos')
  alumnos(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
  ): Promise<AlumnoEnClase[]> {
    return this.misClases.alumnos(actor, turnoId);
  }

  @Roles('PROFESOR')
  @Post(':turnoId/asistencia')
  pasarLista(
    @CurrentUser() actor: JwtPayload,
    @Param('turnoId') turnoId: string,
    @Body() dto: PasarListaDto,
  ): Promise<AlumnoEnClase[]> {
    return this.misClases.pasarLista(actor, turnoId, dto);
  }
}

/**
 * Los dos extremos del rango son obligatorios y tienen que ser fechas. Sin
 * esto, un `desde` vacio se convierte en Invalid Date y Prisma devuelve el
 * historial entero de la profesora.
 */
function exigirRango(desde: string, hasta: string): void {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    throw new BadRequestException('desde y hasta son obligatorios, con formato YYYY-MM-DD');
  }
  if (desde > hasta) {
    throw new BadRequestException('desde no puede ser posterior a hasta');
  }
}
