import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  esFechaValida,
  type EntradaListaEspera,
  type JwtPayload,
  type MiClase,
  type ReservaCreada,
  type ReservaPublica,
  type TurnoDisponible,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ListaEsperaService } from '../lista-espera/lista-espera.service';
import { MiCalendarioService } from './mi-calendario.service';

/**
 * Sin prefijo de ruta: las rutas del alumno viven en la raiz porque hablan de
 * cosas distintas (`/mi-calendario`, `/turnos-disponibles`, `/mis-reservas`) y
 * agruparlas bajo un prefijo comun no diria nada util.
 */
@Controller()
export class MiCalendarioController {
  constructor(
    private readonly miCalendario: MiCalendarioService,
    private readonly listaEspera: ListaEsperaService,
  ) {}

  @Roles('ALUMNO')
  @Get('mi-calendario')
  misClases(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('salaId') salaId?: string,
  ): Promise<MiClase[]> {
    exigirRango(desde, hasta);
    return this.miCalendario.misClases(actor, { desde, hasta, salaId });
  }

  @Roles('ALUMNO')
  @Get('turnos-disponibles')
  turnosDisponibles(
    @CurrentUser() actor: JwtPayload,
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('salaId') salaId?: string,
  ): Promise<TurnoDisponible[]> {
    exigirRango(desde, hasta);
    return this.miCalendario.turnosDisponibles(actor, { desde, hasta, salaId });
  }

  @Roles('ALUMNO')
  @Post('turnos/:id/mi-reserva')
  reservar(@CurrentUser() actor: JwtPayload, @Param('id') turnoId: string): Promise<ReservaCreada> {
    return this.miCalendario.reservar(actor, turnoId);
  }

  @Roles('ALUMNO')
  @Delete('mis-reservas/:id')
  cancelarPropia(
    @CurrentUser() actor: JwtPayload,
    @Param('id') id: string,
  ): Promise<ReservaPublica> {
    return this.miCalendario.cancelarPropia(actor, id);
  }

  @Roles('ALUMNO')
  @Post('turnos/:id/lista-espera')
  anotarse(
    @CurrentUser() actor: JwtPayload,
    @Param('id') turnoId: string,
  ): Promise<EntradaListaEspera> {
    return this.listaEspera.anotarse(actor, turnoId);
  }

  @Roles('ALUMNO')
  @HttpCode(204)
  @Delete('lista-espera/:id')
  salirse(@CurrentUser() actor: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.listaEspera.salirse(actor, id);
  }
}

/**
 * Los query params no pasan por el ValidationPipe de los DTOs, asi que se
 * validan a mano. Sin rango, la consulta traeria el historico entero.
 */
export function exigirRango(desde: string, hasta: string): void {
  if (!desde || !hasta) {
    throw new BadRequestException('Hacen falta los parametros desde y hasta (YYYY-MM-DD)');
  }
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    throw new BadRequestException('desde y hasta deben tener formato YYYY-MM-DD');
  }
  if (hasta < desde) {
    throw new BadRequestException('hasta no puede ser anterior a desde');
  }
}
