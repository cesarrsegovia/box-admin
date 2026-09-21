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
import { HorariosProfesorService } from '../horarios-profesor/horarios-profesor.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarTurnoDto } from './dto/actualizar-turno.dto';
import type { AsignarProfesorDto } from './dto/asignar-profesor.dto';
import type { CrearTurnoDto } from './dto/crear-turno.dto';

export interface FiltroTurnos {
  desde?: string;
  hasta?: string;
  salaId?: string;
  soloLibres?: boolean;
  /** El punto 4 del PDF: la carga horaria de una profesora, de un vistazo. */
  profesorId?: string;
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
  profesorId: string | null;
  profesor?: { usuario: { nombreCompleto: string } } | null;
  _count: { reservas: number };
}

/**
 * Solo cuenta reservas con `canceladaEn: null`. Contarlas todas dejaria turnos
 * eternamente "llenos" de gente que ya cancelo.
 *
 * El nombre de la profesora viene resuelto en la misma query: un calendario que
 * devuelve ids obliga a quien lo pinta a hacer N consultas mas.
 */
const RECUENTO_Y_PROFESORA = {
  _count: { select: { reservas: { where: { canceladaEn: null } } } },
  profesor: { include: { usuario: { select: { nombreCompleto: true } } } },
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
    profesor:
      turno.profesorId === null || !turno.profesor
        ? null
        : { id: turno.profesorId, nombreCompleto: turno.profesor.usuario.nombreCompleto },
  };
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly horarios: HorariosProfesorService,
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

      const fecha = desdeFechaISO(dto.fecha);

      // La del admin manda; si no viene, se mira el patron. Nunca al reves: un
      // alta manual es una decision humana y el patron no la discute.
      let profesorId: string | null = null;
      if (dto.profesorId !== undefined) {
        await this.horarios.exigirProfesoraConAccesoALaSala(cliente, dto.profesorId, dto.salaId);
        profesorId = dto.profesorId;
      } else {
        profesorId = await this.horarios.resolverParaFranja(
          cliente,
          dto.salaId,
          fecha,
          dto.horaInicio,
        );
      }

      const creado = await cliente.turno.create({
        data: {
          tenantId: actor.tenantId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          fecha,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          cupo: dto.cupo,
          profesorId,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { salaId: dto.salaId, fecha: dto.fecha, horaInicio: dto.horaInicio, profesorId },
        },
        cliente,
      );

      return creado;
    });

    // Se relee en vez de componer la respuesta a mano: la fila recien creada no
    // trae la relacion con la profesora, y `profesor` es parte del contrato.
    return await this.obtener(turno.id);
  }

  async listar(actor: JwtPayload, filtro: FiltroTurnos): Promise<TurnoPublico[]> {
    const where: Record<string, unknown> = {};

    if (filtro.salaId) where.salaId = filtro.salaId;
    if (filtro.profesorId) where.profesorId = filtro.profesorId;

    if (filtro.desde || filtro.hasta) {
      where.fecha = {
        ...(filtro.desde ? { gte: desdeFechaISO(filtro.desde) } : {}),
        ...(filtro.hasta ? { lte: desdeFechaISO(filtro.hasta) } : {}),
      };
    }

    const turnos = await this.prisma.db.turno.findMany({
      where,
      include: RECUENTO_Y_PROFESORA,
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
      include: RECUENTO_Y_PROFESORA,
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

  /**
   * La suplencia: cambia la profesora de UN turno sin tocar el patron semanal.
   *
   * No hay que hacer nada especial para que sobreviva a una republicacion del
   * mes: el motor solo rellena huecos, y un turno con profesora ya no es un
   * hueco.
   */
  async asignarProfesor(
    actor: JwtPayload,
    id: string,
    dto: AsignarProfesorDto,
  ): Promise<TurnoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const turno = await cliente.turno.findFirst({ where: { id } });
      if (!turno) throw new NotFoundException('Turno inexistente');

      if (dto.profesorId !== null) {
        await this.horarios.exigirProfesoraConAccesoALaSala(cliente, dto.profesorId, turno.salaId);
      }

      await cliente.turno.update({
        where: { id },
        data: { profesorId: dto.profesorId },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: id,
          accion: 'PROFESOR_ASIGNADO',
          detalle: { profesorId: dto.profesorId },
        },
        cliente,
      );
    });

    return await this.obtener(id);
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
