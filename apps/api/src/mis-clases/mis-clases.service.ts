import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  aFechaISO,
  desdeFechaISO,
  instanteDelTurno,
  type AlumnoEnClase,
  type ClaseDelProfesor,
  type JwtPayload,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { PasarListaDto } from './dto/pasar-lista.dto';

export interface RangoDeClases {
  desde: string;
  hasta: string;
}

/** Fila de turno con lo que la vista de la profesora necesita. */
interface TurnoDeProfesor {
  id: string;
  salaId: string;
  nombre: string;
  fecha: Date;
  horaInicio: string;
  horaFin: string;
  cupo: number;
  sala: { nombre: string };
  reservas: { asistio: boolean | null }[];
}

/** Fila de reserva con el nombre del alumno resuelto. */
interface ReservaConAlumno {
  perfilId: string;
  asistio: boolean | null;
  perfil: { usuario: { nombreCompleto: string } };
}

@Injectable()
export class MisClasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * El perfil del actor. Es la puerta de las tres rutas de la profesora: todas
   * operan sobre SU perfil, nunca sobre un profesorId del cuerpo o de la URL.
   *
   * Un usuario sin perfil —un admin— recibe 404, y es correcto: no tiene clases
   * propias que mostrar. Mismo patron que `/mi-calendario` desde la Fase 3A.
   */
  async perfilDelActor(
    actor: JwtPayload,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<{ id: string }> {
    const perfil = await cliente.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) {
      throw new NotFoundException(
        'Este usuario no tiene perfil de profesora, asi que no tiene clases propias.',
      );
    }

    return perfil;
  }

  async misClases(actor: JwtPayload, rango: RangoDeClases): Promise<ClaseDelProfesor[]> {
    const perfil = await this.perfilDelActor(actor);

    const turnos = await this.prisma.db.turno.findMany({
      where: {
        // El unico filtro que hace falta: el turno es suyo por definicion, asi
        // que no hay que cruzarlo ademas con las salas a las que tiene acceso.
        profesorId: perfil.id,
        fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
      },
      include: {
        sala: { select: { nombre: true } },
        reservas: { where: { canceladaEn: null }, select: { asistio: true } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    return (turnos as unknown as TurnoDeProfesor[]).map((turno) => ({
      turnoId: turno.id,
      salaId: turno.salaId,
      salaNombre: turno.sala.nombre,
      nombre: turno.nombre,
      fecha: aFechaISO(turno.fecha),
      horaInicio: turno.horaInicio,
      horaFin: turno.horaFin,
      cupo: turno.cupo,
      reservasActivas: turno.reservas.length,
      // Basta con que una tenga la marca: pasar lista escribe todas de golpe.
      listaPasada: turno.reservas.some((reserva) => reserva.asistio !== null),
    }));
  }

  async alumnos(actor: JwtPayload, turnoId: string): Promise<AlumnoEnClase[]> {
    const perfil = await this.perfilDelActor(actor);
    await this.exigirTurnoPropio(this.prisma.db, turnoId, perfil.id);

    return await this.listaDeAlumnos(this.prisma.db, turnoId);
  }

  /**
   * Pasar lista. Es una FOTO del turno entero: quien no esta en `presentes`
   * queda marcado como ausente.
   *
   * Idempotente a proposito —mandar dos veces la misma lista da el mismo
   * resultado— y no toca las reservas canceladas: quien cancelo no falto.
   *
   * `ahora` es inyectable para los tests; en produccion es el reloj.
   */
  async pasarLista(
    actor: JwtPayload,
    turnoId: string,
    dto: PasarListaDto,
    ahora: Date = new Date(),
  ): Promise<AlumnoEnClase[]> {
    const perfil = await this.perfilDelActor(actor);

    return await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const turno = await this.exigirTurnoPropio(cliente, turnoId, perfil.id);

      // No se pasa lista de una clase que no ocurrio. Hacia atras no hay
      // limite: una profesora que se olvido tres semanas puede ponerse al dia, y
      // el rastro queda en historial_acciones.
      if (instanteDelTurno(turno.fecha, turno.horaInicio).getTime() > ahora.getTime()) {
        throw new BadRequestException('Esa clase todavia no empezo');
      }

      const activas = await cliente.reserva.findMany({
        where: { turnoId, canceladaEn: null },
        select: { perfilId: true },
      });
      const conReserva = new Set(activas.map((reserva) => reserva.perfilId));

      const intrusos = dto.presentes.filter((perfilId) => !conReserva.has(perfilId));
      if (intrusos.length > 0) {
        // Sin esta comprobacion, un id equivocado marcaria ausente a media clase
        // en silencio y la profesora no tendria forma de notarlo.
        throw new BadRequestException(
          `No tienen reserva activa en esta clase: ${intrusos.join(', ')}`,
        );
      }

      if (dto.presentes.length > 0) {
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null, perfilId: { in: dto.presentes } },
          data: { asistio: true },
        });
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null, perfilId: { notIn: dto.presentes } },
          data: { asistio: false },
        });
      } else {
        // Se evita generar `notIn: []`, que distintas versiones de Prisma han
        // resuelto de formas distintas.
        await cliente.reserva.updateMany({
          where: { turnoId, canceladaEn: null },
          data: { asistio: false },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Turno',
          entidadId: turnoId,
          accion: 'ASISTENCIA_REGISTRADA',
          detalle: { presentes: dto.presentes.length, total: activas.length },
        },
        cliente,
      );

      return await this.listaDeAlumnos(cliente, turnoId);
    });
  }

  /**
   * El turno existe Y es de esta profesora.
   *
   * 404 en los dos casos, deliberadamente: contestar 403 cuando el turno existe
   * pero es de otra profesora ya seria contar algo de la agenda ajena.
   */
  private async exigirTurnoPropio(
    cliente: ClientePrismaTx,
    turnoId: string,
    perfilId: string,
  ): Promise<{ id: string; fecha: Date; horaInicio: string }> {
    const turno = await cliente.turno.findFirst({
      where: { id: turnoId, profesorId: perfilId },
      select: { id: true, fecha: true, horaInicio: true },
    });
    if (!turno) throw new NotFoundException('No tenes ninguna clase con ese id');

    return turno;
  }

  private async listaDeAlumnos(
    cliente: ClientePrismaTx,
    turnoId: string,
  ): Promise<AlumnoEnClase[]> {
    const reservas = await cliente.reserva.findMany({
      where: { turnoId, canceladaEn: null },
      include: { perfil: { include: { usuario: { select: { nombreCompleto: true } } } } },
      orderBy: { perfil: { usuario: { nombreCompleto: 'asc' } } },
    });

    return (reservas as unknown as ReservaConAlumno[]).map((reserva) => ({
      perfilId: reserva.perfilId,
      nombreCompleto: reserva.perfil.usuario.nombreCompleto,
      asistio: reserva.asistio,
    }));
  }
}
