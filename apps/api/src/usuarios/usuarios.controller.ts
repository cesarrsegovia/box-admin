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
import type {
  AltaUsuarioRespuesta,
  JwtPayload,
  ResetPasswordRespuesta,
  TipoUsuarioNegocio,
  UsuarioDetalle,
  UsuarioResumen,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarSalasDto } from './dto/actualizar-salas.dto';
import { ActualizarUsuarioDto } from './dto/actualizar-usuario.dto';
import { CrearAlumnoDto } from './dto/crear-alumno.dto';
import { CrearProfesorDto } from './dto/crear-profesor.dto';
import { UsuariosService } from './usuarios.service';

@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Roles('ADMIN_OPERATIVO')
  @Post('alumnos')
  crearAlumno(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearAlumnoDto,
  ): Promise<AltaUsuarioRespuesta> {
    return this.usuarios.crearAlumno(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Post('profesores')
  crearProfesor(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearProfesorDto,
  ): Promise<AltaUsuarioRespuesta> {
    return this.usuarios.crearProfesor(actor, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('tipo') tipo?: TipoUsuarioNegocio,
    @Query('salaId') salaId?: string,
    @Query('activo', new ParseBoolPipe({ optional: true })) activo?: boolean,
  ): Promise<UsuarioResumen[]> {
    return this.usuarios.listar(actor, { tipo, salaId, activo });
  }

  // Sin @Roles: el propio service decide, porque un alumno puede pedir su
  // propio detalle y un @Roles('ADMIN_OPERATIVO') se lo impediria.
  @Get(':id')
  obtener(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<UsuarioDetalle> {
    return this.usuarios.obtener(actor, id);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarUsuarioDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_OPERATIVO')
  @Patch(':id/salas')
  actualizarSalas(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarSalasDto,
  ): Promise<UsuarioDetalle> {
    return this.usuarios.actualizarSalas(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @HttpCode(200)
  @Post(':id/reset-password')
  resetearPassword(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ResetPasswordRespuesta> {
    return this.usuarios.resetearPassword(actor, id);
  }

  @Roles('ADMIN_OPERATIVO')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<UsuarioDetalle> {
    return this.usuarios.darDeBaja(actor, id);
  }
}
