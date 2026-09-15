import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aFechaISO,
  comparaHoras,
  desdeFechaISO,
  type JwtPayload,
  type TurnoPublico,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import type { CrearTurnoDto } from './dto/crear-turno.dto';

export interface FiltroTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
}

/** Fila de turno con el recuento de reservas activas ya resuelto por Prisma. */
interface TurnoConRecuento {
  id: string;
  tenantId: string;
  salaId: string;
  nombre: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  _count: { reservas: number };
}

/**
 * Solo cuenta reservas con `canceladaEn: null`. Contarlas todas dejaria turnos
 * eternamente "llenos" de gente que ya cancelo.
 */
const RECUENTO_ACTIVAS = {
  _count: { select: { reservas: { where: { canceladaEn: null } } } },
} as const;

export function aTurnoPublico(turno: TurnoConRecuento): TurnoPublico {
  const reservasActivas = turno._count.reservas;

  return {
    id: turno.id,
    tenantId: turno.tenantId,
    salaId: turno.salaId,
    nombre: turno.nombre,
    fecha: aFechaISO(turno.fecha),
    horaInicio: turno.horaInicio,
    horaFin: turno.horaFin,
    cupo: turno.cupo,
    reservasActivas,
    // Nunca negativo: si el admin bajo el cupo por debajo de las reservas ya
    // hechas, "menos dos lugares libres" no significa nada para el cliente.
    lugaresLibres: Math.max(0, turno.cupo - reservasActivas),
  };
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearTurnoDto): Promise<TurnoPublico> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);

    const sala = await this.prisma.db.sala.findFirst({ where: { id: dto.salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    if (!sala.activa) {
      throw new BadRequestException('No se pueden crear turnos en una sala dada de baja');
    }

    const turno = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creado = await cliente.turno.create({
        data: {
          tenantId: actor.tenantId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          fecha: desdeFechaISO(dto.fecha),
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { salaId: dto.salaId, fecha: dto.fecha, horaInicio: dto.horaInicio },
        },
        cliente,
      );

      return creado;
    });

    return aTurnoPublico({ ...turno, _count: { reservas: 0 } });
  }

  async listar(actor: JwtPayload, filtro: FiltroTurnos): Promise<TurnoPublico[]> {
    const where: Record<string, unknown> = {};

    if (filtro.salaId) where.salaId = filtro.salaId;

    if (filtro.desde || filtro.hasta) {
      where.fecha = {
        ...(filtro.desde ? { gte: desdeFechaISO(filtro.desde) } : {}),
        ...(filtro.hasta ? { lte: desdeFechaISO(filtro.hasta) } : {}),
      };
    }

    const turnos = await this.prisma.db.turno.findMany({
      where,
      include: RECUENTO_ACTIVAS,
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const publicos = (turnos as unknown as TurnoConRecuento[]).map(aTurnoPublico);

    // El filtro de "solo libres" se aplica despues del recuento porque depende
    // de el; no hay forma de expresarlo como where sin desnormalizar el cupo.
    return filtro.soloLibres ? publicos.filter((t) => t.lugaresLibres > 0) : publicos;
  }

  async obtener(id: string): Promise<TurnoPublico> {
    const turno = await this.prisma.db.turno.findFirst({
      where: { id },
      include: RECUENTO_ACTIVAS,
    });
    if (!turno) throw new NotFoundException('Turno inexistente');

    return aTurnoPublico(turno as unknown as TurnoConRecuento);
  }

  async actualizar(actor: JwtPayload, id: string, dto: ActualizarTurnoDto): Promise<TurnoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.turno.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Turno inexistente');

      const inicio = dto.horaInicio ?? existente.horaInicio;
      const fin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(inicio, fin);

      if (dto.cupo !== undefined) {
        const activas = await cliente.reserva.count({
          where: { turnoId: id, canceladaEn: null },
        });
        // Dejar el cupo por debajo de las reservas ya hechas obligaria a elegir
        // a quien echar, y eso no lo decide un PATCH.
        if (dto.cupo < activas) {
          throw new ConflictException(
            `El turno ya tiene ${activas} reserva(s) activa(s); el cupo no puede bajar de ahi. ` +
              'Cancela reservas primero.',
          );
        }
      }

      await cliente.turno.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          fecha: dto.fecha ? desdeFechaISO(dto.fecha) : undefined,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Turno', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );
    });

    return this.obtener(id);
  }

  async eliminar(actor: JwtPayload, id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.turno.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Turno inexistente');

      const activas = await cliente.reserva.count({
        where: { turnoId: id, canceladaEn: null },
      });
      if (activas > 0) {
        throw new ConflictException(
          `El turno tiene ${activas} reserva(s) activa(s). Cancelalas antes de borrarlo.`,
        );
      }

      // Borrado fisico, a diferencia de salas y packs: un turno sin reservas
      // activas no es historia de nadie, y un calendario lleno de turnos
      // "de baja" es peor que uno vacio. Las reservas canceladas que cuelguen
      // de el se van con la fila por la FK.
      await cliente.turno.delete({ where: { id } });

      await this.historial.registrar(
        { actor, entidad: 'Turno', entidadId: id, accion: 'ELIMINADA' },
        cliente,
      );
    });
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }
}
