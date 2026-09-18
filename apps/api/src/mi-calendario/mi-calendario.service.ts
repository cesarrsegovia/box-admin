import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aFechaISO,
  desdeFechaISO,
  puedeCancelar,
  type Disponibilidad,
  type JwtPayload,
  type MiClase,
  type ReservaCreada,
  type ReservaPublica,
  type TurnoDisponible,
} from '@boxadmin/shared';
import { DisponibilidadService } from '../disponibilidad/disponibilidad.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { ReservasService } from '../reservas/reservas.service';

export interface RangoDeConsulta {
  desde: string;
  hasta: string;
  salaId?: string;
  /** Inyectable para los tests; en produccion es el reloj. */
  ahora?: Date;
}

/** Columnas de Sala que hacen falta para resolver la ventana de cancelacion. */
const SALA_PARA_VENTANA = {
  activa: true,
  visibleAlumnos: true,
  soloCuposLiberados: true,
  minMinutosCancelar: true,
  minMinutosAnotarse: true,
  listaEsperaHabilitada: true,
} as const;

/**
 * Motivos que hacen que un turno no deba ni aparecer en el calendario del
 * alumno. Un mes sin publicar o una sala oculta no se muestran ni en gris.
 */
const MOTIVOS_QUE_OCULTAN = new Set(['MES_NO_PUBLICADO', 'SALA_NO_VISIBLE', 'SIN_ACCESO_A_SALA']);

@Injectable()
export class MiCalendarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly disponibilidad: DisponibilidadService,
    private readonly reservas: ReservasService,
  ) {}

  /**
   * El perfil del actor. Es la puerta de entrada de las seis rutas del alumno:
   * todas operan sobre SU perfil, nunca sobre un perfilId del cuerpo.
   *
   * Un usuario sin perfil —un admin, por ejemplo— recibe 404, y es correcto: no
   * tiene calendario propio que mostrar.
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
        'Este usuario no tiene perfil de alumno, asi que no tiene calendario propio.',
      );
    }

    return perfil;
  }

  /**
   * Las clases que el alumno tiene reservadas.
   *
   * NO exige que el mes este publicado, a diferencia de `turnosDisponibles`: el
   * gate de HABILITADO aplica a DESCUBRIR turnos, no a ver los propios. Si el
   * admin despublicara un mes, hacer desaparecer de la pantalla del alumno una
   * clase que tiene reservada seria peor que mostrarla.
   */
  async misClases(actor: JwtPayload, rango: RangoDeConsulta): Promise<MiClase[]> {
    const perfil = await this.perfilDelActor(actor);
    const ahora = rango.ahora ?? new Date();

    const reservas = await this.prisma.db.reserva.findMany({
      where: {
        perfilId: perfil.id,
        canceladaEn: null,
        turno: {
          fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
          ...(rango.salaId ? { salaId: rango.salaId } : {}),
        },
      },
      include: { turno: { include: { sala: { select: SALA_PARA_VENTANA } } } },
      orderBy: [{ turno: { fecha: 'asc' } }, { turno: { horaInicio: 'asc' } }],
    });

    const clases: MiClase[] = [];

    for (const reserva of reservas) {
      const config = await this.disponibilidad.configuracionDeSala(reserva.turno.sala);

      clases.push({
        reservaId: reserva.id,
        turnoId: reserva.turno.id,
        salaId: reserva.turno.salaId,
        nombre: reserva.turno.nombre,
        fecha: aFechaISO(reserva.turno.fecha),
        horaInicio: reserva.turno.horaInicio,
        horaFin: reserva.turno.horaFin,
        origen: reserva.origen,
        puedeCancelar: puedeCancelar(reserva.turno.fecha, reserva.turno.horaInicio, config, ahora),
      });
    }

    return clases;
  }

  /**
   * Los turnos que el alumno puede descubrir, con su disponibilidad calculada.
   *
   * Solo de salas a las que tiene acceso. Pedir una sala ajena devuelve la lista
   * vacia y NO un 403: contestar "no tienes acceso" confirmaria que esa sala
   * existe, y para descubrir un calendario el silencio es la respuesta honesta.
   */
  async turnosDisponibles(actor: JwtPayload, rango: RangoDeConsulta): Promise<TurnoDisponible[]> {
    const perfil = await this.perfilDelActor(actor);
    const ahora = rango.ahora ?? new Date();

    const accesos = await this.prisma.db.usuarioSala.findMany({
      where: { perfilId: perfil.id },
      select: { salaId: true },
    });

    let salaIds = accesos.map((union) => union.salaId);
    if (rango.salaId) {
      salaIds = salaIds.filter((id) => id === rango.salaId);
    }
    // Sin salas no hay nada que buscar. Un `in: []` funcionaria, pero pedirle a
    // la base que busque en un conjunto vacio es trabajo tirado.
    if (salaIds.length === 0) return [];

    const turnos = await this.prisma.db.turno.findMany({
      where: {
        salaId: { in: salaIds },
        fecha: { gte: desdeFechaISO(rango.desde), lte: desdeFechaISO(rango.hasta) },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }],
    });

    const disponibles: TurnoDisponible[] = [];

    for (const turno of turnos) {
      const disponibilidad = await this.disponibilidad.paraTurno(actor, perfil.id, turno.id, ahora);

      if (disponibilidad.motivo !== null && MOTIVOS_QUE_OCULTAN.has(disponibilidad.motivo)) {
        continue;
      }

      disponibles.push({
        turnoId: turno.id,
        salaId: turno.salaId,
        nombre: turno.nombre,
        fecha: aFechaISO(turno.fecha),
        horaInicio: turno.horaInicio,
        horaFin: turno.horaFin,
        disponibilidad,
      });
    }

    return disponibles;
  }

  /**
   * Reserva del alumno para si mismo.
   *
   * Comprueba la disponibilidad ANTES de delegar, para poder dar un error
   * especifico. `ReservasService.crear` volveria a comprobar el cupo dentro de
   * su transaccion Serializable —que es la unica comprobacion con garantias—,
   * pero sus mensajes son los del admin y no saben nada de ventanas ni de mes
   * publicado.
   *
   * El `perfilId` sale del actor y NUNCA del cuerpo: si viniera del cliente, un
   * alumno podria reservar a nombre de otro.
   */
  async reservar(
    actor: JwtPayload,
    turnoId: string,
    ahora: Date = new Date(),
  ): Promise<ReservaCreada> {
    const perfil = await this.perfilDelActor(actor);
    const estado = await this.disponibilidad.paraTurno(actor, perfil.id, turnoId, ahora);

    this.exigirQuePuedaReservar(estado);

    return this.reservas.crear(actor, turnoId, { perfilId: perfil.id, origen: 'ALUMNO' });
  }

  /**
   * Cancelacion de la propia reserva.
   *
   * DECISION DE LA FASE: fuera de la ventana se BLOQUEA con 409. El PDF dice
   * "respetando las ventanas minimas configuradas" y se lee como bloqueo. La
   * alternativa considerada era permitirla contandola como DEFINITIVA
   * ("cancelaste tarde, perdes la clase"); se descarto por fidelidad al PDF. El
   * admin conserva la capacidad de cancelarla desde DELETE /reservas/:id.
   *
   * El alumno NO elige el tipo: dentro de ventana siempre es RECUPERABLE, que
   * es lo que significa cancelar a tiempo.
   */
  async cancelarPropia(
    actor: JwtPayload,
    reservaId: string,
    ahora: Date = new Date(),
  ): Promise<ReservaPublica> {
    const perfil = await this.perfilDelActor(actor);

    const reserva = await this.prisma.db.reserva.findFirst({
      where: { id: reservaId },
      include: { turno: { include: { sala: { select: SALA_PARA_VENTANA } } } },
    });
    if (!reserva) throw new NotFoundException('Reserva inexistente');
    // 403 y no 404: el actor sabe que existe porque acaba de pasar su id.
    if (reserva.perfilId !== perfil.id) {
      throw new ForbiddenException('Solo puedes cancelar tus propias reservas');
    }
    if (reserva.canceladaEn !== null) {
      throw new ConflictException('La reserva ya estaba cancelada');
    }

    const config = await this.disponibilidad.configuracionDeSala(reserva.turno.sala);

    if (!puedeCancelar(reserva.turno.fecha, reserva.turno.horaInicio, config, ahora)) {
      throw new ConflictException(
        `Ya paso el plazo para cancelar esta clase (${config.minMinutosCancelar} minutos ` +
          'antes de que empiece). Hablalo con el salon.',
      );
    }

    return this.reservas.cancelar(actor, reservaId, 'RECUPERABLE');
  }

  /**
   * Traduce el `motivo` de la disponibilidad al error HTTP que le corresponde.
   *
   * 403 para lo que es cuestion de permisos y 409 para lo que es cuestion de
   * estado. El caso de LISTA_ESPERA tiene mensaje propio porque es un punto
   * explicito del checklist: un turno lleno tiene que OFRECER la cola, no
   * devolver un error generico.
   */
  private exigirQuePuedaReservar(estado: Disponibilidad): void {
    if (estado.puedeReservar) return;

    switch (estado.motivo) {
      case 'SIN_ACCESO_A_SALA':
      case 'SALA_NO_VISIBLE':
        throw new ForbiddenException('No tienes acceso a la sala de este turno');
      case 'MES_NO_PUBLICADO':
        throw new ConflictException('El mes de este turno todavia no esta publicado');
      case 'YA_RESERVADO':
        throw new ConflictException('Ya tienes una reserva activa en este turno');
      case 'VENTANA_CERRADA':
        throw new ConflictException(
          'Ya paso el plazo para anotarse a esta clase. Hablalo con el salon.',
        );
      case 'SOLO_CUPOS_LIBERADOS':
        throw new ConflictException(
          'En esta sala solo puedes tomar lugares que se liberen. Todavia no se libero ninguno.',
        );
      default:
        break;
    }

    if (estado.estado === 'LISTA_ESPERA') {
      throw new ConflictException(
        `Este turno esta completo (${estado.ocupados}/${estado.cupo}), pero puedes anotarte ` +
          'en la lista de espera con POST /turnos/:id/lista-espera.',
      );
    }

    throw new ConflictException(`Este turno esta completo (${estado.ocupados}/${estado.cupo}).`);
  }
}
