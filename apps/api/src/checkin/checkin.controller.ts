import { Body, Controller, Get, Post, Put, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ConfigCheckIn, JwtPayload, PresenteMarcado } from '@boxadmin/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { CheckinService } from './checkin.service';
import { ConfigCheckInService } from './config-checkin.service';
import { GuardarConfigQrDto } from './dto/guardar-config-qr.dto';
import { MarcarPresenteDto } from './dto/marcar-presente.dto';

/**
 * A donde llega el alumno despues de escanear el QR de la pared.
 *
 * Este controller es la UNICA capa que conoce `Request`: la IP y el User-Agent
 * se extraen aqui y bajan al service como argumentos. Es lo que permite probar
 * el check-in entero sin montar HTTP.
 */
@Controller('checkin')
export class CheckinController {
  constructor(private readonly checkin: CheckinService) {}

  @Roles('ALUMNO')
  @Post()
  marcar(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: MarcarPresenteDto,
    @Req() req: Request,
  ): Promise<PresenteMarcado> {
    return this.checkin.marcarPresente(actor, dto.firma, {
      // `req.ip` ya respeta el `trust proxy` que main.ts deja en 1: detras del
      // reverse proxy propio es la del cliente, no la del proxy.
      ip: req.ip ?? null,
      dispositivo: req.get('user-agent') ?? null,
    });
  }
}

/**
 * La ventana y el cartel. ADMIN_SALON y no ADMIN_OPERATIVO: la ventana decide
 * quien puede marcar presente, y el PNG LLEVA LA FIRMA DEL GIMNASIO dentro.
 * Quien pueda descargarlo puede fabricar el QR, asi que esta al nivel de una
 * credencial.
 */
@Controller('config/checkin-qr')
export class ConfigCheckInController {
  constructor(private readonly configCheckIn: ConfigCheckInService) {}

  @Roles('ADMIN_SALON')
  @Get()
  ver(): Promise<ConfigCheckIn> {
    return this.configCheckIn.ver();
  }

  @Roles('ADMIN_SALON')
  @Put()
  guardar(
    @CurrentUser() actor: JwtPayload,
    @Body() dto: GuardarConfigQrDto,
  ): Promise<ConfigCheckIn> {
    return this.configCheckIn.guardar(actor, dto);
  }

  @Roles('ADMIN_SALON')
  @Get('imagen')
  async imagen(@CurrentUser() actor: JwtPayload, @Res() res: Response): Promise<void> {
    const png = await this.configCheckIn.imagenQr(actor);

    // `no-store` y no un cache largo aunque el QR sea estatico: la imagen
    // lleva la firma del gimnasio, y lo que no se cachea no se queda en el
    // disco de un proxy compartido.
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  }
}
