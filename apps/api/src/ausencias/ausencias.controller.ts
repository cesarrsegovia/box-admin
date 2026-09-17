import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import type { AusenciaPublica, JwtPayload } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearAusenciaDto } from './dto/crear-ausencia.dto';
import { AusenciasService } from './ausencias.service';

@Controller('ausencias')
export class AusenciasController {
  constructor(private readonly ausencias: AusenciasService) {}

  // Cerrar una sala o el salon entero es un acto de gestion, no de mostrador:
  // por eso POST y DELETE piden ADMIN_SALON y no ADMIN_OPERATIVO.
  @Roles('ADMIN_SALON')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearAusenciaDto): Promise<AusenciaPublica> {
    return this.ausencias.crear(actor, dto);
  }

  // Sin @Roles a proposito: cualquier autenticado puede consultarlas. A un
  // profesor le interesa saber que el salon cierra.
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('salaId') salaId?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ): Promise<AusenciaPublica[]> {
    return this.ausencias.listar(actor, { salaId, desde, hasta });
  }

  @Roles('ADMIN_SALON')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<AusenciaPublica> {
    return this.ausencias.darDeBaja(actor, id);
  }
}
