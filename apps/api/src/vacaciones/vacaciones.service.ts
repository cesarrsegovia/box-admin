import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { VacacionAlumno } from '@prisma/client';
import { aFechaISO, desdeFechaISO, type JwtPayload, type VacacionPublica } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearVacacionDto } from './dto/crear-vacacion.dto';

export interface FiltroVacaciones {
  perfilId?: string;
}

export function aVacacionPublica(vacacion: VacacionAlumno): VacacionPublica {
  return {
    id: vacacion.id,
    tenantId: vacacion.tenantId,
    perfilId: vacacion.perfilId,
    desde: aFechaISO(vacacion.desde),
    hasta: aFechaISO(vacacion.hasta),
    motivo: vacacion.motivo,
    devuelveClase: vacacion.devuelveClase,
  };
}

/**
 * Vacaciones de un alumno concreto: el rango en el que no se le generan
 * reservas. No afecta a nadie mas — el turno sigue existiendo para el resto de
 * la clase.
 */
@Injectable()
export class VacacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearVacacionDto): Promise<VacacionPublica> {
    this.exigirRangoCoherente(dto.desde, dto.hasta);

    const perfil = await this.prisma.db.perfil.findFirst({ where: { id: dto.perfilId } });
    if (!perfil) throw new NotFoundException('Perfil inexistente');

    const vacacion = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creada = await cliente.vacacionAlumno.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: dto.perfilId,
          desde: desdeFechaISO(dto.desde),
          hasta: desdeFechaISO(dto.hasta),
          motivo: dto.motivo ?? null,
          // Se almacena y NO se aplica en esta fase: con el conteo derivado de
          // clases, no generar la reserva ya equivale a no gastarla.
          devuelveClase: dto.devuelveClase ?? true,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'VacacionAlumno',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: { perfilId: dto.perfilId, desde: dto.desde, hasta: dto.hasta },
        },
        cliente,
      );

      return creada;
    });

    return aVacacionPublica(vacacion);
  }

  async listar(actor: JwtPayload, filtro: FiltroVacaciones): Promise<VacacionPublica[]> {
    const where: Record<string, unknown> = {};

    if (filtro.perfilId) where.perfilId = filtro.perfilId;

    const vacaciones = await this.prisma.db.vacacionAlumno.findMany({
      where,
      orderBy: [{ desde: 'asc' }],
    });

    return vacaciones.map(aVacacionPublica);
  }

  /**
   * Borra de verdad, a diferencia de rutinas o salas: un rango de vacaciones no
   * explica ningun turno ya generado, asi que conservarlo dado de baja solo
   * ensuciaria el calendario. Unas vacaciones mal cargadas se corrigen
   * borrandolas.
   */
  async darDeBaja(actor: JwtPayload, id: string): Promise<VacacionPublica> {
    const vacacion = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // findFirst y no findUnique: dentro del contexto de tenant, las
      // operaciones de where unico no admiten el filtro y lanzan.
      const existente = await cliente.vacacionAlumno.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Vacaciones inexistentes');

      const borrada = await cliente.vacacionAlumno.delete({ where: { id } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'VacacionAlumno',
          entidadId: id,
          accion: 'ELIMINADA',
          detalle: {
            perfilId: existente.perfilId,
            desde: aFechaISO(existente.desde),
            hasta: aFechaISO(existente.hasta),
          },
        },
        cliente,
      );

      return borrada;
    });

    return aVacacionPublica(vacacion);
  }

  private exigirRangoCoherente(desde: string, hasta: string): void {
    // Igual no es error: faltar un solo dia es el caso mas frecuente.
    if (hasta < desde) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
  }
}
