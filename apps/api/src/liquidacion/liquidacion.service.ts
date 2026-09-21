import { BadRequestException, Injectable } from '@nestjs/common';
import type { JwtPayload, LiquidacionProfesor } from '@boxadmin/shared';
import { calcularLiquidacion } from './calcular-liquidacion';
import { LiquidacionDatos } from './liquidacion.datos';

@Injectable()
export class LiquidacionService {
  constructor(private readonly datos: LiquidacionDatos) {}

  async delMes(
    actor: JwtPayload,
    profesorId: string,
    anio: number,
    mes: number,
  ): Promise<LiquidacionProfesor> {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2200) {
      throw new BadRequestException('anio invalido');
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('mes invalido');
    }

    return calcularLiquidacion(await this.datos.cargar(actor, profesorId, anio, mes));
  }
}
