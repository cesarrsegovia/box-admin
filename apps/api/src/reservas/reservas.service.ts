import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Reserva } from '@prisma/client';
import type {
  Advertencia,
  JwtPayload,
  ReservaCreada,
  ReservaPublica,
  TipoCancelacion,
} from '@boxadmin/shared';
import {
  conReintentoSerializable,
  esConflictoDeSerializacion,
} from '../common/prisma/serializable';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearReservaDto } from './dto/crear-reserva.dto';
import type { ReasignarReservaDto } from './dto/reasignar-reserva.dto';
import { topeDelPack, ventanaDeConteo } from './ventana-pack';

export function aReservaPublica(reserva: Reserva): ReservaPublica {
  return {
    id: reserva.id,
    tenantId: reserva.tenantId,
    turnoId: reserva.turnoId,
    perfilId: reserva.perfilId,
    origen: reserva.origen,
    esPrueba: reserva.esPrueba,
    pagoRealizado: reserva.pagoRealizado,
    canceladaEn: reserva.canceladaEn === null ? null : reserva.canceladaEn.toISOString(),
    cancelacionTipo: reserva.cancelacionTipo,
  };
}

/** El perfil con lo que hace falta para decidir sobre una reserva. */
const PERFIL_PARA_RESERVAR = { pack: true, salas: { select: { salaId: true } } } as const;

@Injectable()
export class ReservasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  /**
   * Envuelve una transaccion Serializable que pelea por el cupo.
   *
   * Dos cosas por encima de `conReintentoSerializable` a secas:
   *
   * 1. **Cinco intentos, no tres.** Con tres, diez peticiones simultaneas sobre
   *    el mismo turno agotaban los reintentos de alguna: medido, fallaba en 3 de
   *    cada 7 corridas del e2e de concurrencia.
   * 2. **Si aun asi se agotan, sale un 409, no un 500.** Que la base aborte la
   *    transaccion por solape no es un fallo del servidor: es un conflicto, y la
   *    respuesta util para el cliente es "reintenta". Sin esto el `P2034` llegaba
   *    crudo al `AllExceptionsFilter`, que no traduce errores de Prisma, y el
   *    cliente veia "Error interno" ante algo perfectamente normal.
   */
  private async conReintentoDeCupo<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await conReintentoSerializable(fn, { intentos: 5 });
    } catch (error) {
      if (esConflictoDeSerializacion(error)) {
        throw new ConflictException(
          'Otra peticion esta tocando este turno ahora mismo; reintenta en unos segundos.',
        );
      }
      throw error;
    }
  }

  /**
   * Asigna una reserva a un turno.
   *
   * Todo va dentro de una transaccion Serializable porque el cupo es un
   * invariante que dos peticiones simultaneas pueden romper: sin aislamiento,
   * ambas leen "quedan 1" y ambas insertan. Postgres detecta el solape y aborta
   * una de las dos con 40001; `conReintentoDeCupo` la repite, y la segunda vez
   * ya lee el cupo lleno y devuelve un 409 honesto.
   *
   * El reintento NO cubre los errores de negocio: un turno lleno sigue lleno.
   */
  async crear(actor: JwtPayload, turnoId: string, dto: CrearReservaDto): Promise<ReservaCreada> {
    return this.conReintentoDeCupo(() =>
      this.prisma.db.$transaction(
        async (tx) => {
          const cliente = tx as ClientePrismaTx;

          const turno = await cliente.turno.findFirst({ where: { id: turnoId } });
          if (!turno) throw new NotFoundException('Turno inexistente');

          const perfil = await cliente.perfil.findFirst({
            where: { id: dto.perfilId },
            include: PERFIL_PARA_RESERVAR,
          });
          if (!perfil) throw new NotFoundException('Perfil inexistente');

          const tieneAcceso = perfil.salas.some((union) => union.salaId === turno.salaId);
          if (!tieneAcceso) {
            throw new ForbiddenException(
              'El usuario no tiene acceso a la sala de este turno. ' +
                'Asignasela con PATCH /usuarios/:id/salas.',
            );
          }

          const duplicada = await cliente.reserva.findFirst({
            where: { turnoId, perfilId: dto.perfilId, canceladaEn: null },
          });
          if (duplicada) {
            throw new ConflictException('El usuario ya tiene una reserva activa en este turno');
          }

          const activas = await cliente.reserva.count({
            where: { turnoId, canceladaEn: null },
          });
          if (activas >= turno.cupo) {
            throw new ConflictException(`El turno esta completo (${activas}/${turno.cupo}).`);
          }

          // Se calcula ANTES de insertar: "agotado" significa que esta reserva
          // queda por encima del tope, no que lo alcanzo justo.
          const advertencias = await this.advertenciasDePack(cliente, perfil, turno.fecha);

          const creada = await cliente.reserva.create({
            data: {
              tenantId: actor.tenantId,
              turnoId,
              perfilId: dto.perfilId,
              origen: dto.origen ?? 'ADMIN',
              esPrueba: dto.esPrueba ?? false,
              pagoRealizado: dto.pagoRealizado ?? false,
            },
          });

          await this.historial.registrar(
            {
              actor,
              entidad: 'Reserva',
              entidadId: creada.id,
              accion: 'CREADA',
              detalle: { turnoId, perfilId: dto.perfilId, origen: creada.origen },
            },
            cliente,
          );

          return { ...aReservaPublica(creada), advertencias };
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  /**
   * Cancela una reserva. Nunca borra la fila: el historial de un alumno se
   * calcula sobre sus reservas, y borrarlas reescribiria el pasado.
   *
   * RECUPERABLE deja de contar contra el pack; DEFINITIVA sigue contando. El
   * efecto es automatico porque el consumo se deriva de las reservas — no hay
   * ningun contador que ajustar aqui.
   */
  async cancelar(actor: JwtPayload, id: string, tipo: TipoCancelacion): Promise<ReservaPublica> {
    return this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const reserva = await cliente.reserva.findFirst({
        where: { id },
        include: { perfil: true },
      });
      if (!reserva) throw new NotFoundException('Reserva inexistente');
      if (reserva.canceladaEn !== null) {
        throw new ConflictException('La reserva ya estaba cancelada');
      }

      const cancelada = await cliente.reserva.update({
        where: { id },
        data: { canceladaEn: new Date(), cancelacionTipo: tipo },
      });

      // cancelacionesUsadas mide las cancelaciones DEL ALUMNO, no las
      // correcciones del salon. En la Fase 1 este endpoint solo lo alcanza el
      // personal, asi que la rama del alumno no se ejercita en produccion
      // todavia — pero la regla queda escrita y probada para la Fase 3.
      if (actor.sub === reserva.perfil.usuarioId) {
        await cliente.perfil.update({
          where: { id: reserva.perfilId },
          data: { cancelacionesUsadas: { increment: 1 } },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Reserva',
          entidadId: id,
          accion: 'CANCELADA',
          detalle: { tipo, turnoId: reserva.turnoId, perfilId: reserva.perfilId },
        },
        cliente,
      );

      return aReservaPublica(cancelada);
    });
  }

  /**
   * Mueve una reserva a otro turno.
   *
   * Tambien va en Serializable: si el turno destino tiene un solo lugar y
   * alguien mas lo esta reservando en ese momento, es la misma carrera que en
   * `crear`.
   */
  async reasignar(
    actor: JwtPayload,
    id: string,
    dto: ReasignarReservaDto,
  ): Promise<ReservaPublica> {
    return this.conReintentoDeCupo(() =>
      this.prisma.db.$transaction(
        async (tx) => {
          const cliente = tx as ClientePrismaTx;

          const reserva = await cliente.reserva.findFirst({
            where: { id },
            include: { perfil: { include: PERFIL_PARA_RESERVAR } },
          });
          if (!reserva) throw new NotFoundException('Reserva inexistente');
          if (reserva.canceladaEn !== null) {
            throw new ConflictException(
              'La reserva esta cancelada; crea una nueva en vez de reasignarla',
            );
          }

          const destino = await cliente.turno.findFirst({ where: { id: dto.turnoId } });
          if (!destino) throw new NotFoundException('Turno destino inexistente');

          const tieneAcceso = reserva.perfil.salas.some((union) => union.salaId === destino.salaId);
          if (!tieneAcceso) {
            throw new ForbiddenException('El usuario no tiene acceso a la sala del turno destino');
          }

          const duplicada = await cliente.reserva.findFirst({
            where: { turnoId: dto.turnoId, perfilId: reserva.perfilId, canceladaEn: null },
          });
          if (duplicada) {
            throw new ConflictException(
              'El usuario ya tiene una reserva activa en el turno destino',
            );
          }

          // El cupo que importa es el del destino: el origen solo se vacia.
          const activas = await cliente.reserva.count({
            where: { turnoId: dto.turnoId, canceladaEn: null },
          });
          if (activas >= destino.cupo) {
            throw new ConflictException(
              `El turno destino esta completo (${activas}/${destino.cupo}).`,
            );
          }

          const movida = await cliente.reserva.update({
            where: { id },
            data: { turnoId: dto.turnoId },
          });

          await this.historial.registrar(
            {
              actor,
              entidad: 'Reserva',
              entidadId: id,
              accion: 'REASIGNADA',
              detalle: { desde: reserva.turnoId, hasta: dto.turnoId },
            },
            cliente,
          );

          return aReservaPublica(movida);
        },
        { isolationLevel: 'Serializable' },
      ),
    );
  }

  /**
   * ¿Esta reserva deja al alumno por encima de su pack?
   *
   * Cuenta las reservas que consumen clase: las que siguen activas y las
   * canceladas como DEFINITIVA. Las canceladas como RECUPERABLE no cuentan —
   * ahi es exactamente donde "la clase vuelve al perfil".
   */
  private async advertenciasDePack(
    cliente: ClientePrismaTx,
    perfil: {
      id: string;
      clasesExtra: number;
      vigenciaDesde: Date | null;
      vigenciaHasta: Date | null;
      pack: {
        tipo: 'MENSUAL' | 'TOTAL';
        clasesPorMes: number | null;
        clasesTotales: number | null;
      } | null;
    },
    fechaDelTurno: Date,
  ): Promise<Advertencia[]> {
    const tope = topeDelPack(perfil.pack, perfil);
    if (tope === null) return [];

    const ventana = ventanaDeConteo(perfil.pack, perfil, fechaDelTurno);

    const consumidas = await cliente.reserva.count({
      where: {
        perfilId: perfil.id,
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: { fecha: ventana },
      },
    });

    if (consumidas < tope) return [];

    return [
      {
        codigo: 'PACK_AGOTADO',
        mensaje:
          `El alumno ya tiene ${consumidas} de ${tope} clases de su pack en este periodo. ` +
          'La reserva se creo igualmente.',
      },
    ];
  }
}
