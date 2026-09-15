import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { JwtPayload, SalaPublica } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ActualizarSalaDto } from './dto/actualizar-sala.dto';
import { CrearSalaDto } from './dto/crear-sala.dto';
import { SalasService } from './salas.service';

@Controller('salas')
export class SalasController {
  constructor(private readonly salas: SalasService) {}

  @Roles('ADMIN_SALON')
  @Post()
  crear(@CurrentUser() actor: JwtPayload, @Body() dto: CrearSalaDto): Promise<SalaPublica> {
    return this.salas.crear(actor, dto);
  }

  // Sin @Roles: cualquier usuario autenticado del gimnasio. El propio service
  // recorta el listado segun el rol.
  @Get()
  listar(@CurrentUser() actor: JwtPayload): Promise<SalaPublica[]> {
    return this.salas.listar(actor);
  }

  @Get(':id')
  obtener(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<SalaPublica> {
    return this.salas.obtener(actor, id);
  }

  @Roles('ADMIN_SALON')
  @Patch(':id')
  actualizar(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ActualizarSalaDto,
  ): Promise<SalaPublica> {
    return this.salas.actualizar(actor, id, dto);
  }

  @Roles('ADMIN_SALON')
  @Delete(':id')
  darDeBaja(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<SalaPublica> {
    return this.salas.darDeBaja(actor, id);
  }
}
