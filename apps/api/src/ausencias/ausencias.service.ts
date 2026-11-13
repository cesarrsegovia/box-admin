import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Ausencia } from '@prisma/client';
import { aFechaISO, desdeFechaISO, type AusenciaPublica, type JwtPayload } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { CacheDeStats } from '../stats/cache-de-stats';
import type { CrearAusenciaDto } from './dto/crear-ausencia.dto';

export interface FiltroAusencias {
  salaId?: string;
  /** `YYYY-MM-DD`. Extremos del rango sobre el que se busca SOLAPE. */
  desde?: string;
  hasta?: string;
}

export function aAusenciaPublica(ausencia: Ausencia): AusenciaPublica {
  return {
    id: ausencia.id,
    tenantId: ausencia.tenantId,
    salaId: ausencia.salaId,
    desde: aFechaISO(ausencia.desde),
    hasta: aFechaISO(ausencia.hasta),
    motivo: ausencia.motivo,
  };
}

/**
 * Cierres de una sala o de todo el salon: feriado, evento, reforma. A diferencia
 * de las vacaciones, afectan a todo el mundo.
 */
@Injectable()
export class AusenciasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly cache: CacheDeStats,
  ) {}

  async crear(actor: JwtPayload, dto: CrearAusenciaDto): Promise<AusenciaPublica> {
    if (dto.hasta < dto.desde) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }

    // Sin salaId el cierre es del salon entero y no hay nada que comprobar.
    if (dto.salaId) {
      const sala = await this.prisma.db.sala.findFirst({ where: { id: dto.salaId } });
      if (!sala) throw new NotFoundException('Sala inexistente');
    }

    const ausencia = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.ausencia.create({
        data: {
          tenantId: actor.tenantId,
          salaId: dto.salaId ?? null,
          desde: desdeFechaISO(dto.desde),
          hasta: desdeFechaISO(dto.hasta),
          motivo: dto.motivo ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Ausencia',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: {
            salaId: dto.salaId ?? null,
            desde: dto.desde,
            hasta: dto.hasta,
          },
        },
        cliente,
      );

      return creada;
    });

    // UN CIERRE MUEVE DINERO, aunque no lo parezca. `liquidacion.datos.ts` lee
    // la tabla `ausencia` desde la Fase 4: una franja que cae dentro de un
    // cierre deja de contar, asi que crear o retirar uno cambia
    // `importes.aPagar` de alguna profesora y con el `costoProfesoras` y el
    // `margen` de `/stats/caja`. Es el mismo razonamiento por el que
    // `TurnosService` invalida: lo que decide que horas se pagan tiene que tirar
    // el cache de la caja.
    //
    // Post-commit y sin try/catch. Ver `CacheDeStats`.
    await this.cache.invalidar(actor.tenantId);

    return aAusenciaPublica(ausencia);
  }

  async listar(actor: JwtPayload, filtro: FiltroAusencias): Promise<AusenciaPublica[]> {
    const where: Record<string, unknown> = {};

    // Un cierre de todo el salon (salaId null) afecta tambien a esta sala.
    if (filtro.salaId) {
      where.OR = [{ salaId: filtro.salaId }, { salaId: null }];
    }

    // Solape, no contencion: un cierre del 28/09 al 03/10 tiene que salir al
    // preguntar por octubre.
    if (filtro.desde) where.hasta = { gte: desdeFechaISO(filtro.desde) };
    if (filtro.hasta) where.desde = { lte: desdeFechaISO(filtro.hasta) };

    const ausencias = await this.prisma.db.ausencia.findMany({
      where,
      orderBy: [{ desde: 'asc' }],
    });

    return ausencias.map(aAusenciaPublica);
  }

  /** Se borra de verdad: un cierre retirado no explica nada del calendario. */
  async darDeBaja(actor: JwtPayload, id: string): Promise<AusenciaPublica> {
    const ausencia = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // findFirst y no findUnique: dentro del contexto de tenant, las
      // operaciones de where unico no admiten el filtro y lanzan.
      const existente = await cliente.ausencia.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Ausencia inexistente');

      const borrada = await cliente.ausencia.delete({ where: { id } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Ausencia',
          entidadId: id,
          accion: 'ELIMINADA',
          detalle: {
            salaId: existente.salaId,
            desde: aFechaISO(existente.desde),
            hasta: aFechaISO(existente.hasta),
          },
        },
        cliente,
      );

      return borrada;
    });

    // UN CIERRE MUEVE DINERO, aunque no lo parezca. `liquidacion.datos.ts` lee
    // la tabla `ausencia` desde la Fase 4: una franja que cae dentro de un
    // cierre deja de contar, asi que crear o retirar uno cambia
    // `importes.aPagar` de alguna profesora y con el `costoProfesoras` y el
    // `margen` de `/stats/caja`. Es el mismo razonamiento por el que
    // `TurnosService` invalida: lo que decide que horas se pagan tiene que tirar
    // el cache de la caja.
    //
    // Post-commit y sin try/catch. Ver `CacheDeStats`.
    await this.cache.invalidar(actor.tenantId);

    return aAusenciaPublica(ausencia);
  }
}
