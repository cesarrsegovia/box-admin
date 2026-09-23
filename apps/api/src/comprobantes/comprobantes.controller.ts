import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  ComprobanteCreado,
  ComprobantePublico,
  EstadoComprobante,
  JwtPayload,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ComprobantesService } from './comprobantes.service';
import { CrearComprobanteDto } from './dto/crear-comprobante.dto';
import { AprobarComprobanteDto } from './dto/aprobar-comprobante.dto';
import { RevisarComprobanteDto } from './dto/revisar-comprobante.dto';

@Controller('comprobantes')
export class ComprobantesController {
  constructor(private readonly comprobantes: ComprobantesService) {}

  @Roles('ALUMNO')
  @Post()
  crear(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearComprobanteDto,
  ): Promise<ComprobanteCreado> {
    return this.comprobantes.crear(actor, dto);
  }

  @Roles('ALUMNO')
  @Patch(':id/confirmar')
  confirmar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.confirmar(actor, id);
  }

  // `ALUMNO` como minimo, pero el alcance real lo decide el service: un alumno
  // ve solo los suyos y un ADMIN_OPERATIVO los de todo el gimnasio. Es el mismo
  // patron que GET /usuarios/:id desde la Fase 1.
  @Roles('ALUMNO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('estado') estado?: EstadoComprobante,
  ): Promise<ComprobantePublico[]> {
    return this.comprobantes.listar(actor, { estado });
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/aprobar')
  aprobar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AprobarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.aprobar(actor, id, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/rechazar')
  rechazar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RevisarComprobanteDto,
  ): Promise<ComprobantePublico> {
    return this.comprobantes.rechazar(actor, id, dto.nota);
  }
}
