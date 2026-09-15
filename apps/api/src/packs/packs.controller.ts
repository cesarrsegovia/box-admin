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
import type { JwtPayload, PackPublico } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarPackDto } from './dto/actualizar-pack.dto';
import { CrearPackDto } from './dto/crear-pack.dto';
import { PacksService } from './packs.service';

@Controller('packs')
export class PacksController {
  constructor(private readonly packs: PacksService) {}

  @Roles('ADMIN_SALON')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearPackDto): Promise<PackPublico> {
    return this.packs.crear(actor, dto);
  }

  @Get()
  listar(
    @CurrentUser() actor: JwtPayload,
    @Query('salaId') salaId?: string,
    @Query('activo', new ParseBoolPipe({ optional: true })) activo?: boolean,
  ): Promise<PackPublico[]> {
    return this.packs.listar(actor, { salaId, activo });
  }

  // Sin @Roles, como el de salas: cualquier autenticado puede resolver un packId
  // suelto (el del perfil de un alumno, p. ej.) sin bajarse el catalogo entero.
  // El service aplica el mismo criterio de visibilidad que el listado.
  @Get(':id')
  obtener(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<PackPublico> {
    return this.packs.obtener(actor, id);
  }

  @Roles('ADMIN_SALON')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarPackDto,
  ): Promise<PackPublico> {
    return this.packs.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<PackPublico> {
    return this.packs.darDeBaja(actor, id);
  }
}
