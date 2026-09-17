import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RutinaFija } from '@prisma/client';
import {
  aFechaISO,
  comparaHoras,
  desdeFechaISO,
  type DiaSemana,
  type JwtPayload,
  type RutinaPublica,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarRutinaDto } from './dto/actualizar-rutina.dto';
import type { CrearRutinaDto } from './dto/crear-rutina.dto';

export interface FiltroRutinas {
  perfilId?: string;
  salaId?: string;
  activa?: boolean;
}

export function aRutinaPublica(rutina: RutinaFija): RutinaPublica {
  return {
    id: rutina.id,
    tenantId: rutina.tenantId,
    perfilId: rutina.perfilId,
    salaId: rutina.salaId,
    nombre: rutina.nombre,
    diaSemana: rutina.diaSemana as DiaSemana,
    horaInicio: rutina.horaInicio,
    horaFin: rutina.horaFin,
    activa: rutina.activa,
    desde: aFechaISO(rutina.desde),
    hasta: rutina.hasta === null ? null : aFechaISO(rutina.hasta),
  };
}

@Injectable()
export class RutinasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearRutinaDto): Promise<RutinaPublica> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);
    this.exigirVigenciaCoherente(dto.desde, dto.hasta);
    await this.exigirAccesoASala(dto.perfilId, dto.salaId);

    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.rutinaFija.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: dto.perfilId,
          salaId: dto.salaId,
          nombre: dto.nombre,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          activa: dto.activa ?? true,
          desde: desdeFechaISO(dto.desde),
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'RutinaFija',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: {
            perfilId: dto.perfilId,
            salaId: dto.salaId,
            diaSemana: dto.diaSemana,
            horaInicio: dto.horaInicio,
          },
        },
        cliente,
      );

      return creada;
    });

    return aRutinaPublica(rutina);
  }

  async listar(actor: JwtPayload, filtro: FiltroRutinas): Promise<RutinaPublica[]> {
    const where: Record<string, unknown> = {};

    if (filtro.perfilId) where.perfilId = filtro.perfilId;
    if (filtro.salaId) where.salaId = filtro.salaId;
    // Sin filtro explicito se listan solo las activas: son las que generan. El
    // historico se pide a proposito con ?activa=false.
    where.activa = filtro.activa ?? true;

    const rutinas = await this.prisma.db.rutinaFija.findMany({
      where,
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });

    return rutinas.map(aRutinaPublica);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarRutinaDto,
  ): Promise<RutinaPublica> {
    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.rutinaFija.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Rutina inexistente');

      const inicio = dto.horaInicio ?? existente.horaInicio;
      const fin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(inicio, fin);

      const desde = dto.desde ?? aFechaISO(existente.desde);
      const hasta =
        dto.hasta ?? (existente.hasta === null ? undefined : aFechaISO(existente.hasta));
      this.exigirVigenciaCoherente(desde, hasta);

      const actualizada = await cliente.rutinaFija.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          activa: dto.activa,
          desde: dto.desde ? desdeFechaISO(dto.desde) : undefined,
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : undefined,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'RutinaFija',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );

      return actualizada;
    });

    return aRutinaPublica(rutina);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<RutinaPublica> {
    const rutina = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.rutinaFija.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Rutina inexistente');

      // Idempotente: repetir el DELETE no vuelve a escribir una baja que ya
      // ocurrio. El historial no debe inventar acontecimientos.
      if (!existente.activa) return existente;

      const baja = await cliente.rutinaFija.update({
        where: { id },
        data: { activa: false },
      });

      await this.historial.registrar(
        { actor, entidad: 'RutinaFija', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aRutinaPublica(rutina);
  }

  /**
   * Misma regla que una reserva manual: sin acceso a la sala, la rutina
   * generaria mes tras mes reservas que el motor acabaria rechazando.
   */
  private async exigirAccesoASala(perfilId: string, salaId: string): Promise<void> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { id: perfilId },
      include: { salas: { select: { salaId: true } } },
    });
    if (!perfil) throw new NotFoundException('Perfil inexistente');

    const sala = await this.prisma.db.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    if (!sala.activa) {
      throw new BadRequestException('No se pueden crear rutinas en una sala dada de baja');
    }

    const tieneAcceso = perfil.salas.some((union) => union.salaId === salaId);
    if (!tieneAcceso) {
      throw new ForbiddenException(
        'El usuario no tiene acceso a esa sala. Asignasela con PATCH /usuarios/:id/salas.',
      );
    }
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }

  private exigirVigenciaCoherente(desde: string, hasta: string | undefined): void {
    if (hasta && hasta < desde) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
  }
}
