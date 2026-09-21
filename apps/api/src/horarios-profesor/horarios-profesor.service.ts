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
  horasSeSolapan,
  rangosSeSolapan,
  type HorarioProfesorPublico,
  type JwtPayload,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarHorarioProfesorDto } from './dto/actualizar-horario-profesor.dto';
import type { CrearHorarioProfesorDto } from './dto/crear-horario-profesor.dto';
import { resolverProfesorDeFranja } from './resolver-profesor';

export interface FiltroHorarios {
  profesorId?: string;
  salaId?: string;
}

/** La forma minima que necesita la comprobacion de solape. */
interface FranjaAComprobar {
  /** El id del propio horario cuando se esta editando: se excluye a si mismo. */
  id?: string;
  profesorId: string;
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  desde: Date;
  hasta: Date | null;
}

/** Fila de Prisma con las relaciones que el contrato publico necesita. */
interface HorarioConRelaciones {
  id: string;
  profesorId: string;
  salaId: string;
  diaSemana: number;
  horaInicio: string;
  horaFin: string;
  activo: boolean;
  desde: Date;
  hasta: Date | null;
  tarifaPorHora: { toFixed(digitos: number): string } | null;
  profesor?: { usuario: { nombreCompleto: string } } | null;
  sala?: { nombre: string } | null;
}

const CON_NOMBRES = {
  profesor: { include: { usuario: { select: { nombreCompleto: true } } } },
  sala: { select: { nombre: true } },
} as const;

export function aHorarioPublico(fila: HorarioConRelaciones): HorarioProfesorPublico {
  return {
    id: fila.id,
    profesorId: fila.profesorId,
    profesorNombre: fila.profesor?.usuario.nombreCompleto ?? '',
    salaId: fila.salaId,
    salaNombre: fila.sala?.nombre ?? '',
    diaSemana: fila.diaSemana,
    horaInicio: fila.horaInicio,
    horaFin: fila.horaFin,
    activo: fila.activo,
    desde: aFechaISO(fila.desde),
    hasta: fila.hasta === null ? null : aFechaISO(fila.hasta),
    // toFixed y no toString: es dinero, y convertir a number reintroduciria el
    // error de coma flotante que el Decimal existe para evitar. Misma regla que
    // `aPackPublico` desde la Fase 1.
    tarifaPorHora: fila.tarifaPorHora === null ? null : fila.tarifaPorHora.toFixed(2),
  };
}

@Injectable()
export class HorariosProfesorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearHorarioProfesorDto): Promise<HorarioProfesorPublico> {
    this.exigirHorasCoherentes(dto.horaInicio, dto.horaFin);

    const desde = desdeFechaISO(dto.desde);
    const hasta = dto.hasta ? desdeFechaISO(dto.hasta) : null;
    this.exigirFechasCoherentes(desde, hasta);

    await this.exigirProfesoraConAccesoALaSala(this.prisma.db, dto.profesorId, dto.salaId);

    const creado = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirSinSolape(cliente, {
        profesorId: dto.profesorId,
        salaId: dto.salaId,
        diaSemana: dto.diaSemana,
        horaInicio: dto.horaInicio,
        horaFin: dto.horaFin,
        desde,
        hasta,
      });

      const fila = await cliente.horarioProfesorAsignado.create({
        data: {
          tenantId: actor.tenantId,
          profesorId: dto.profesorId,
          salaId: dto.salaId,
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          desde,
          hasta,
          tarifaPorHora: dto.tarifaPorHora ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'HorarioProfesorAsignado',
          entidadId: fila.id,
          accion: 'CREADA',
          detalle: {
            profesorId: dto.profesorId,
            salaId: dto.salaId,
            diaSemana: dto.diaSemana,
            horaInicio: dto.horaInicio,
          },
        },
        cliente,
      );

      return fila;
    });

    return await this.obtener(creado.id);
  }

  async listar(filtro: FiltroHorarios): Promise<HorarioProfesorPublico[]> {
    const where: Record<string, unknown> = {};
    if (filtro.profesorId) where.profesorId = filtro.profesorId;
    if (filtro.salaId) where.salaId = filtro.salaId;

    const filas = await this.prisma.db.horarioProfesorAsignado.findMany({
      where,
      include: CON_NOMBRES,
      orderBy: [{ diaSemana: 'asc' }, { horaInicio: 'asc' }],
    });

    return (filas as unknown as HorarioConRelaciones[]).map(aHorarioPublico);
  }

  async obtener(id: string): Promise<HorarioProfesorPublico> {
    const fila = await this.prisma.db.horarioProfesorAsignado.findFirst({
      where: { id },
      include: CON_NOMBRES,
    });
    if (!fila) throw new NotFoundException('Horario inexistente');

    return aHorarioPublico(fila as unknown as HorarioConRelaciones);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarHorarioProfesorDto,
  ): Promise<HorarioProfesorPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.horarioProfesorAsignado.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Horario inexistente');

      const horaInicio = dto.horaInicio ?? existente.horaInicio;
      const horaFin = dto.horaFin ?? existente.horaFin;
      this.exigirHorasCoherentes(horaInicio, horaFin);

      const desde = dto.desde ? desdeFechaISO(dto.desde) : existente.desde;
      const hasta = dto.hasta ? desdeFechaISO(dto.hasta) : existente.hasta;
      this.exigirFechasCoherentes(desde, hasta);

      // Se vuelve a comprobar el solape sobre el RESULTADO, no sobre lo que
      // llego en el cuerpo: mover un horario media hora puede chocar con otro
      // que antes no molestaba.
      const activo = dto.activo ?? existente.activo;
      if (activo) {
        await this.exigirSinSolape(cliente, {
          id,
          profesorId: existente.profesorId,
          salaId: existente.salaId,
          diaSemana: dto.diaSemana ?? existente.diaSemana,
          horaInicio,
          horaFin,
          desde,
          hasta,
        });
      }

      await cliente.horarioProfesorAsignado.update({
        where: { id },
        data: {
          diaSemana: dto.diaSemana,
          horaInicio: dto.horaInicio,
          horaFin: dto.horaFin,
          desde: dto.desde ? desdeFechaISO(dto.desde) : undefined,
          hasta: dto.hasta ? desdeFechaISO(dto.hasta) : undefined,
          activo: dto.activo,
          tarifaPorHora: dto.tarifaPorHora,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'HorarioProfesorAsignado',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );
    });

    return await this.obtener(id);
  }

  /**
   * Baja logica, y ademas cierra el `hasta` si estaba abierto.
   *
   * Las dos cosas porque cada una sirve para algo distinto: `activo` es lo que
   * filtran los listados y el etiquetado, y `hasta` es lo que mira la
   * liquidacion. Sin cerrar el `hasta`, un horario dado de baja seguiria
   * contando horas contratadas hacia el futuro; borrando la fila, en cambio,
   * desaparecerian tambien las de agosto, que ya se liquidaron.
   */
  async eliminar(actor: JwtPayload, id: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.horarioProfesorAsignado.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Horario inexistente');

      const hoy = new Date();
      const cerrarHasta =
        existente.hasta === null || existente.hasta.getTime() > hoy.getTime()
          ? desdeFechaISO(aFechaISO(hoy))
          : undefined;

      await cliente.horarioProfesorAsignado.update({
        where: { id },
        data: { activo: false, hasta: cerrarHasta },
      });

      await this.historial.registrar(
        { actor, entidad: 'HorarioProfesorAsignado', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );
    });
  }

  /**
   * El perfil existe, su usuario es PROFESOR, y tiene acceso a la sala.
   *
   * Lo tercero es la puerta que sostiene el punto del checklist sobre "otras
   * salas fuera de su asignacion": si no se comprueba aqui, una profesora acaba
   * con un turno asignado en una sala que no puede ni ver.
   */
  async exigirProfesoraConAccesoALaSala(
    cliente: ClientePrismaTx,
    profesorId: string,
    salaId: string,
  ): Promise<void> {
    const perfil = await cliente.perfil.findFirst({
      where: { id: profesorId },
      include: { usuario: { select: { rol: true, nombreCompleto: true } } },
    });
    if (!perfil) throw new NotFoundException('Perfil inexistente');
    if (perfil.usuario.rol !== 'PROFESOR') {
      throw new BadRequestException('Ese perfil no es de una profesora');
    }

    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');

    const acceso = await cliente.usuarioSala.findFirst({
      where: { perfilId: profesorId, salaId },
    });
    if (!acceso) {
      throw new BadRequestException(
        `${perfil.usuario.nombreCompleto} no tiene acceso a la sala ${sala.nombre}. ` +
          'Dale acceso antes de asignarle el horario.',
      );
    }
  }

  /**
   * Quien dicta esta franja, segun los horarios vigentes.
   *
   * Es el puente entre la base y `resolverProfesorDeFranja`, que es pura. Toda
   * la logica de pertenencia vive alli; aqui solo se traen las filas.
   */
  async resolverParaFranja(
    cliente: ClientePrismaTx,
    salaId: string,
    fecha: Date,
    horaInicio: string,
  ): Promise<string | null> {
    // El where filtra por fecha aunque la funcion pura lo vuelva a comprobar. No
    // es redundancia inutil: sin el, la query se traeria todos los horarios
    // historicos de la sala.
    const horarios = await cliente.horarioProfesorAsignado.findMany({
      where: {
        salaId,
        activo: true,
        diaSemana: fecha.getUTCDay(),
        desde: { lte: fecha },
        OR: [{ hasta: null }, { hasta: { gte: fecha } }],
      },
    });

    return resolverProfesorDeFranja(
      horarios.map((h) => ({
        id: h.id,
        profesorId: h.profesorId,
        salaId: h.salaId,
        diaSemana: h.diaSemana,
        horaInicio: h.horaInicio,
        horaFin: h.horaFin,
        desde: h.desde,
        hasta: h.hasta,
      })),
      salaId,
      fecha,
      horaInicio,
    );
  }

  private async exigirSinSolape(cliente: ClientePrismaTx, franja: FranjaAComprobar): Promise<void> {
    const candidatos = await cliente.horarioProfesorAsignado.findMany({
      where: {
        activo: true,
        diaSemana: franja.diaSemana,
        ...(franja.id ? { id: { not: franja.id } } : {}),
        // Solo puede chocar con algo de la misma sala o de la misma profesora.
        OR: [{ salaId: franja.salaId }, { profesorId: franja.profesorId }],
      },
    });

    for (const otro of candidatos) {
      if (!rangosSeSolapan(franja.desde, franja.hasta, otro.desde, otro.hasta)) continue;
      if (!horasSeSolapan(franja.horaInicio, franja.horaFin, otro.horaInicio, otro.horaFin)) {
        continue;
      }

      if (otro.salaId === franja.salaId && otro.profesorId !== franja.profesorId) {
        throw new ConflictException(
          'Ya hay otra profesora asignada a esa sala en ese dia y hora. ' +
            'Un turno tiene una sola profesora, asi que dos horarios que se pisan ' +
            'no se pueden resolver.',
        );
      }

      if (otro.profesorId === franja.profesorId && otro.salaId !== franja.salaId) {
        throw new ConflictException(
          'Esa profesora ya esta asignada a otra sala a esa hora, y no puede estar ' +
            'en dos salas a la vez.',
        );
      }

      throw new ConflictException('Esa profesora ya tiene ese horario en esa sala');
    }
  }

  private exigirHorasCoherentes(inicio: string, fin: string): void {
    if (comparaHoras(fin, inicio) <= 0) {
      throw new BadRequestException('horaFin debe ser posterior a horaInicio');
    }
  }

  private exigirFechasCoherentes(desde: Date, hasta: Date | null): void {
    if (hasta !== null && hasta.getTime() < desde.getTime()) {
      throw new BadRequestException('hasta no puede ser anterior a desde');
    }
  }
}
