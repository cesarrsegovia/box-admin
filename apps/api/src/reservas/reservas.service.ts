import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
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
import { ListaEsperaService, type CupoRepartido } from '../lista-espera/lista-espera.service';
import {
  NotificacionesService,
  type ReservaCambiada,
} from '../notificaciones/notificaciones.service';
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
    asistio: reserva.asistio,
  };
}

/**
 * Lo que queda por avisar CUANDO LA TRANSACCION HAYA HECHO COMMIT.
 *
 * POR QUE NO SE ENCOLA DENTRO. `crear` y `cancelar` corren bajo
 * `conReintentoDeCupo` con aislamiento Serializable: Postgres puede abortar la
 * transaccion con 40001 despues de haber ejecutado el cuerpo entero, y el
 * reintento la vuelve a ejecutar. Redis NO participa de ese rollback, asi que
 * un `cola.add` de adentro deja el job vivo y el reintento encola otro.
 *
 * Y la ventana no es un rincon raro: un aborto por serializacion ocurre justo
 * cuando dos personas compiten por el ultimo lugar de un turno, que es
 * exactamente cuando el aviso importa.
 *
 * El comentario de la Fase 3A decia que el hook iba dentro "cuando ya se sabe
 * que la reserva se creo". Era verdad cuando el hook SOLO ESCRIBIA EN EL LOG:
 * un log duplicado no le hace dano a nadie. Desde que encola, adentro no se
 * sabe que la reserva se creo, se sabe que esta a punto de crearse. La certeza
 * llega con el commit.
 *
 * EL INTERCAMBIO QUE SE ACEPTA A CAMBIO: si el proceso se muere entre el commit
 * y el `add`, el aviso SE PIERDE. Es la mitad buena del trato. Perder un aviso
 * molesta; mandar uno fantasma le dice a alguien que tiene una clase que no
 * tiene, o le confirma dos veces una que pidio una vez — y eso no se puede
 * desandar: un aviso mal mandado no da error, llega y se lee.
 */
interface AvisosPendientes {
  cambios: ReservaCambiada[];
  /** El cupo que `asignarPrimero` repartio dentro de la misma transaccion. */
  cupo: CupoRepartido | null;
}

/** El perfil con lo que hace falta para decidir sobre una reserva. */
const PERFIL_PARA_RESERVAR = { pack: true, salas: { select: { salaId: true } } } as const;

@Injectable()
export class ReservasService {
  private readonly logger = new Logger(ReservasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
    private readonly listaEspera: ListaEsperaService,
    private readonly notificaciones: NotificacionesService,
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
    const { resultado, avisos } = await this.conReintentoDeCupo(() =>
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

          // El aviso NO se encola aqui: se devuelve. Ver AvisosPendientes.
          return {
            resultado: { ...aReservaPublica(creada), advertencias },
            avisos: {
              cambios: [
                {
                  tenantId: actor.tenantId,
                  perfilId: creada.perfilId,
                  turnoId: creada.turnoId,
                  origen: creada.origen,
                  accion: 'CONFIRMACION' as const,
                },
              ],
              cupo: null,
            },
          };
        },
        { isolationLevel: 'Serializable' },
      ),
    );

    await this.encolarAvisos(actor, avisos);

    return resultado;
  }

  /**
   * Cancela una reserva. Nunca borra la fila: el historial de un alumno se
   * calcula sobre sus reservas, y borrarlas reescribiria el pasado.
   *
   * RECUPERABLE deja de contar contra el pack; DEFINITIVA sigue contando. El
   * efecto es automatico porque el consumo se deriva de las reservas — no hay
   * ningun contador que ajustar aqui.
   *
   * CAMBIO DE LA FASE 3A: pasa a Serializable con reintento. Hasta ahora
   * cancelar no competia por ningun cupo, asi que no hacia falta; desde que
   * libera un lugar y se lo da al primero de la lista de espera, dos
   * cancelaciones simultaneas sobre el mismo turno podrian asignar el mismo
   * lugar a dos personas distintas.
   */
  async cancelar(actor: JwtPayload, id: string, tipo: TipoCancelacion): Promise<ReservaPublica> {
    const { resultado, avisos } = await this.conReintentoDeCupo(() =>
      this.prisma.db.$transaction(
        async (tx) => {
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
          // correcciones del salon. La rama se escribio en la Fase 1 pensando en
          // la Fase 3; desde DELETE /mis-reservas/:id ya se ejercita de verdad.
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

          // DESPUES de marcar la cancelacion: al reves, el cupo seguiria
          // ocupado y la asignacion encontraria el turno lleno. Y con el MISMO
          // cliente, para que la reserva asignada se revierta junto con la
          // cancelacion si algo falla mas abajo.
          const cupo = await this.listaEspera.asignarPrimero(actor, reserva.turnoId, cliente);

          // Los dos avisos salen juntos, y los dos DESPUES del commit: el del
          // alumno que cancelo y el del que se quedo con su lugar.
          return {
            resultado: aReservaPublica(cancelada),
            avisos: {
              cambios: [
                {
                  tenantId: actor.tenantId,
                  perfilId: cancelada.perfilId,
                  turnoId: cancelada.turnoId,
                  origen: cancelada.origen,
                  accion: 'CANCELACION' as const,
                },
              ],
              cupo,
            },
          };
        },
        { isolationLevel: 'Serializable' },
      ),
    );

    await this.encolarAvisos(actor, avisos);

    return resultado;
  }

  /**
   * Encola lo que quedo pendiente, ya con la transaccion cerrada.
   *
   * Los metodos de NotificacionesService siguen sin lanzar nunca, y su
   * `try/catch` sigue haciendo falta — pero por otro motivo que antes. Ya no
   * protege una transaccion abierta, porque aqui no hay ninguna: protege de que
   * un Redis caido convierta un POST perfectamente correcto en un 500 DESPUES
   * de haber guardado bien la reserva.
   */
  private async encolarAvisos(actor: JwtPayload, avisos: AvisosPendientes): Promise<void> {
    // El try NO es redundante con el de `NotificacionesService.encolar`, aunque
    // haga lo mismo. Son dos capas porque responden a dos preguntas distintas:
    // alli, "¿que hace el hook cuando Redis falla?"; aqui, "¿que le pasa a una
    // reserva ya guardada cuando el hook falla?".
    //
    // Sin este try, la correccion de `reservas` queda a merced de la disciplina
    // interna de otra clase: basta que alguien quite aquel try/catch —o escriba
    // un hook nuevo que no lo tenga— para que un POST que creo la reserva
    // devuelva 500. Comprobado con un doble del hook que rechaza: propagaba,
    // con la reserva ya creada.
    //
    // Y NO va en silencio: si se pierde un aviso tiene que quedar dicho.
    try {
      for (const cambio of avisos.cambios) {
        await this.notificaciones.reservaCambiada(cambio);
      }

      // Los dos avisos de `cancelar` van EN SERIE, y eso tiene un precio que
      // conviene ver escrito: si el primero entra y Redis se cae en medio, el
      // `cupoAsignado` se pierde solo. Alguien se queda con una reserva que no
      // pidio y de la que nadie le avisa. Es la misma perdida que se acepta mas
      // arriba, pero parcial, que es la version dificil de notar.
      if (avisos.cupo !== null) {
        await this.notificaciones.cupoAsignado({ tenantId: actor.tenantId, ...avisos.cupo });
      }
    } catch (error) {
      this.logger.warn(`No se pudieron encolar los avisos de la reserva: ${String(error)}`);
    }
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
    // PENDIENTE DE DECISION, no es un olvido: mover una reserva de turno NO
    // avisa a nadie. La Fase 5B solo pide notificar `crear` y `cancelar`; si
    // aqui hace falta un aviso (y con que plantilla, porque no es ninguna de las
    // que hay) se decide aparte.
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
