import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Public } from '../common/decorators/public.decorator';
import { AlmacenLocal } from './almacen-local';

/**
 * Las dos rutas que sirven el almacen local. Publicas en el sentido de que no
 * piden JWT, pero NO abiertas: exigen una firma HMAC con caducidad que solo el
 * servidor sabe generar. Es el mismo modelo que una URL presignada de S3.
 *
 * Este controller SOLO se registra cuando ALMACEN_TIPO es `local`; en
 * produccion estas rutas no existen.
 */
@Controller('archivos-locales')
export class AlmacenLocalController {
  constructor(private readonly almacen: AlmacenLocal) {}

  @Public()
  @Put(':clave')
  async subir(
    @Param('clave') clave: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Req() req: Request,
  ): Promise<{ ok: true }> {
    this.exigirFirma(clave, exp, firma);

    await this.almacen.asegurarDirectorio();
    await pipeline(req, createWriteStream(this.almacen.rutaDe(clave)));

    return { ok: true };
  }

  @Public()
  @Get(':clave')
  async descargar(
    @Param('clave') clave: string,
    @Query('exp') exp: string,
    @Query('firma') firma: string,
    @Res() res: Response,
  ): Promise<void> {
    this.exigirFirma(clave, exp, firma);

    const ruta = this.almacen.rutaDe(clave);
    try {
      await stat(ruta);
    } catch {
      throw new NotFoundException('El archivo no existe');
    }

    createReadStream(ruta).pipe(res);
  }

  private exigirFirma(clave: string, exp: string, firma: string): void {
    if (!this.almacen.verificar(clave, exp, firma)) {
      // Mismo error para firma mala, caducada y ausente: no hay nada que ganar
      // diciendole a quien prueba cual de las tres fallo.
      throw new ForbiddenException('Enlace invalido o caducado');
    }
  }
}
