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
    this.exigirMesValido(anio, mes);

    return calcularLiquidacion(await this.datos.cargar(actor, profesorId, anio, mes));
  }

  /**
   * La liquidacion de quien pide. El perfil sale del token (via
   * `perfilDeLaProfesora`) y nunca de la URL ni del cuerpo; `cargar` sigue
   * exigiendo que ese perfil sea de un usuario PROFESOR.
   */
  async deLaProfesora(actor: JwtPayload, anio: number, mes: number): Promise<LiquidacionProfesor> {
    this.exigirMesValido(anio, mes);
    const perfilId = await this.datos.perfilDeLaProfesora(actor);

    return calcularLiquidacion(await this.datos.cargar(actor, perfilId, anio, mes));
  }

  private exigirMesValido(anio: number, mes: number): void {
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2200) {
      throw new BadRequestException('anio invalido');
    }
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('mes invalido');
    }
  }
}
