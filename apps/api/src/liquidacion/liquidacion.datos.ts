import { Injectable, NotFoundException } from '@nestjs/common';
import { primerDiaDelMesUtc, ultimoDiaDelMesUtc, type JwtPayload } from '@boxadmin/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { EntradaLiquidacion } from './calcular-liquidacion';

/**
 * Traduce el estado de la base a la entrada de `calcularLiquidacion`.
 *
 * Mismo reparto que en la Fase 2: aqui no entra una sola regla de negocio, y en
 * la funcion pura no entra una sola query.
 */
@Injectable()
export class LiquidacionDatos {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    actor: JwtPayload,
    profesorId: string,
    anio: number,
    mes: number,
  ): Promise<EntradaLiquidacion> {
    const inicio = primerDiaDelMesUtc(anio, mes);
    const fin = ultimoDiaDelMesUtc(anio, mes);

    const perfil = await this.prisma.db.perfil.findFirst({
      where: { id: profesorId },
      include: { usuario: { select: { rol: true, nombreCompleto: true } } },
    });
    if (!perfil || perfil.usuario.rol !== 'PROFESOR') {
      throw new NotFoundException('No hay ninguna profesora con ese id');
    }

    // NO se filtra por `activo`: la liquidacion mira el rango de fechas, y un
    // horario dado de baja la semana pasada sigue explicando las horas de la
    // semana anterior. Darlo de baja cierra su `hasta`, que es lo que acota.
    const horarios = await this.prisma.db.horarioProfesorAsignado.findMany({
      where: {
        profesorId,
        desde: { lte: fin },
        OR: [{ hasta: null }, { hasta: { gte: inicio } }],
      },
    });

    const turnos = await this.prisma.db.turno.findMany({
      where: { profesorId, fecha: { gte: inicio, lte: fin } },
      select: { id: true, salaId: true, fecha: true, horaInicio: true, horaFin: true },
    });

    const salaIds = [...new Set(horarios.map((h) => h.salaId))];
    const ausencias =
      salaIds.length === 0
        ? []
        : await this.prisma.db.ausencia.findMany({
            where: {
              OR: [{ salaId: { in: salaIds } }, { salaId: null }],
              desde: { lte: fin },
              hasta: { gte: inicio },
            },
          });

    // Tenant es un modelo GLOBAL en la extension de aislamiento, asi que no se
    // le inyecta ningun filtro: hay que acotarlo a mano.
    const tenant = await this.prisma.db.tenant.findFirst({ where: { id: actor.tenantId } });

    return {
      profesorId,
      profesorNombre: perfil.usuario.nombreCompleto,
      anio,
      mes,
      horarios: horarios.map((h) => ({
        salaId: h.salaId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        desde: h.desde,
        hasta: h.hasta,
        tarifaPorHora: h.tarifaPorHora === null ? null : h.tarifaPorHora.toFixed(2),
      })),
      turnos,
      ausencias: ausencias.map((a) => ({
        salaId: a.salaId,
        desde: a.desde,
        hasta: a.hasta,
        motivo: a.motivo,
      })),
      tarifaDelTenant:
        tenant?.tarifaPorHoraProfesor == null ? null : tenant.tarifaPorHoraProfesor.toFixed(2),
    };
  }
}
