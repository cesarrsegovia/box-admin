import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Ausencia } from '@prisma/client';
import {
  aFechaISO,
  comparaHoras,
  desdeFechaISO,
  type AusenciaPublica,
  type JwtPayload,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
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
    todoElDia: ausencia.todoElDia,
    horaInicio: ausencia.horaInicio,
    horaFin: ausencia.horaFin,
    recuperable: ausencia.recuperable,
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
  ) {}

  async crear(actor: JwtPayload, dto: CrearAusenciaDto): Promise<AusenciaPublica> {
    if (dto.hasta < dto.desde) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }

    const todoElDia = dto.todoElDia ?? true;

    if (!todoElDia) {
      if (!dto.horaInicio || !dto.horaFin) {
        throw new BadRequestException(
          'Un cierre parcial necesita horaInicio y horaFin. Si cierra el dia entero, usa todoElDia.',
        );
      }
      if (comparaHoras(dto.horaFin, dto.horaInicio) <= 0) {
        throw new BadRequestException('horaFin debe ser posterior a horaInicio');
      }
    }

    // Con todoElDia, el tramo horario no significa nada: se descarta en vez de
    // guardarse a medias y confundir al motor.
    const horaInicio = todoElDia ? null : (dto.horaInicio as string);
    const horaFin = todoElDia ? null : (dto.horaFin as string);

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
          todoElDia,
          horaInicio,
          horaFin,
          recuperable: dto.recuperable ?? true,
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
            todoElDia,
          },
        },
        cliente,
      );

      return creada;
    });

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

    return aAusenciaPublica(ausencia);
  }
}
