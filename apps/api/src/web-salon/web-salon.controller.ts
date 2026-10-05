import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import type {
  ConfiguracionWebSalon,
  JwtPayload,
  PreguntaAdmin,
  TestimonioAdmin,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CrearFaqDto } from './dto/crear-faq.dto';
import { CrearTestimonioDto } from './dto/crear-testimonio.dto';
import { GuardarWebSalonDto } from './dto/guardar-web-salon.dto';
import { WebSalonService } from './web-salon.service';

/**
 * La configuracion de la web publica.
 *
 * ADMIN_SALON Y NO ADMIN_OPERATIVO, en los seis endpoints. Lo que se decide
 * aqui es que sale a internet con el nombre del gimnasio: la bandera `activa`
 * publica o despublica el sitio entero, `mostrarPrecios` pone la lista de
 * precios en una pagina indexable, y `mostrarTurnosLibres` publica la agenda y
 * cuan vacia esta. Es la misma altura que las credenciales SMTP de la Fase 5B,
 * no la del dia a dia operativo.
 */
@Controller('config/web-salon')
export class WebSalonController {
  constructor(private readonly webSalon: WebSalonService) {}

  @Roles('ADMIN_SALON')
  @Get()
  ver(): Promise<ConfiguracionWebSalon> {
    return this.webSalon.ver();
  }

  @Roles('ADMIN_SALON')
  @Put()
  guardar(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: GuardarWebSalonDto,
  ): Promise<ConfiguracionWebSalon> {
    return this.webSalon.guardar(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @Post('testimonios')
  crearTestimonio(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearTestimonioDto,
  ): Promise<TestimonioAdmin> {
    return this.webSalon.crearTestimonio(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @HttpCode(204)
  @Delete('testimonios/:id')
  borrarTestimonio(@Param('id') id: string): Promise<void> {
    return this.webSalon.borrarTestimonio(id);
  }

  @Roles('ADMIN_SALON')
  @Post('faq')
  crearPregunta(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: CrearFaqDto,
  ): Promise<PreguntaAdmin> {
    return this.webSalon.crearPregunta(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @HttpCode(204)
  @Delete('faq/:id')
  borrarPregunta(@Param('id') id: string): Promise<void> {
    return this.webSalon.borrarPregunta(id);
  }
}
