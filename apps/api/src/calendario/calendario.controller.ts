import { Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import type {
  Conflicto,
  JwtPayload,
  MesCalendarioPublico,
  PlanDeMes,
  PublicacionEncolada,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CalendarioService } from './calendario.service';

@Controller('calendario/:salaId/:anio/:mes')
export class CalendarioController {
  constructor(private readonly calendario: CalendarioService) {}

  @Roles('ADMIN_OPERATIVO')
  @HttpCode(200)
  @Post('previsualizar')
  previsualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<PlanDeMes> {
    return this.calendario.previsualizar(actor, salaId, anio, mes);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get('conflictos')
  async conflictos(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<Conflicto[]> {
    const plan = await this.calendario.previsualizar(actor, salaId, anio, mes);
    return plan.conflictos;
  }

  // Publicar crea reservas para todo el salon de golpe: es gestion, no
  // operacion diaria.
  @Roles('ADMIN_SALON')
  @HttpCode(202)
  @Post('publicar')
  publicar(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<PublicacionEncolada> {
    return this.calendario.encolarPublicacion(actor, salaId, anio, mes);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  obtener(
    @CurrentUser() actor: JwtPayload,
    @Param('salaId') salaId: string,
    @Param('anio', ParseIntPipe) anio: number,
    @Param('mes', ParseIntPipe) mes: number,
  ): Promise<MesCalendarioPublico> {
    return this.calendario.obtenerMes(actor, salaId, anio, mes);
  }
}
