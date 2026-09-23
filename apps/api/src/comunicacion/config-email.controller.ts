import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import {
  TIPOS_DE_PLANTILLA,
  type ConfiguracionSmtpPublica,
  type JwtPayload,
  type PlantillaPublica,
  type TipoPlantilla,
} from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ConfigEmailService } from './config-email.service';
import { GuardarPlantillaDto } from './dto/guardar-plantilla.dto';
import { GuardarSmtpDto } from './dto/guardar-smtp.dto';

// ADMIN_SALON y no ADMIN_OPERATIVO: son credenciales, y son los textos que
// salen firmados con el nombre del gimnasio.
@Controller('config')
export class ConfigEmailController {
  constructor(private readonly config: ConfigEmailService) {}

  @Roles('ADMIN_SALON')
  @Put('smtp')
  guardarSmtp(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: GuardarSmtpDto,
  ): Promise<ConfiguracionSmtpPublica> {
    return this.config.guardarSmtp(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @Get('smtp')
  verSmtp(): Promise<ConfiguracionSmtpPublica> {
    return this.config.verSmtp();
  }

  @Roles('ADMIN_SALON')
  @Get('plantillas')
  listarPlantillas(): Promise<PlantillaPublica[]> {
    return this.config.listarPlantillas();
  }

  @Roles('ADMIN_SALON')
  @Put('plantillas/:tipo')
  guardarPlantilla(
    @CurrentUser() actor: JwtPayload,
    @Param('tipo') tipo: string,
    @Body() dto: GuardarPlantillaDto,
  ): Promise<PlantillaPublica> {
    // El tipo viene de la URL, asi que no pasa por el ValidationPipe: se
    // comprueba a mano contra el enum en vez de dejar que llegue a Prisma.
    if (!TIPOS_DE_PLANTILLA.includes(tipo as TipoPlantilla)) {
      throw new BadRequestException(
        `Tipo de plantilla desconocido: ${tipo}. Los validos son ${TIPOS_DE_PLANTILLA.join(', ')}.`,
      );
    }

    return this.config.guardarPlantilla(actor, tipo as TipoPlantilla, dto);
  }
}
