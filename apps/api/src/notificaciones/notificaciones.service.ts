import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { OrigenReserva } from '@boxadmin/shared';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
  type DatosNotificacionListaEspera,
  type DatosNotificacionReserva,
} from '../jobs/notificaciones/colas';

export interface CupoAsignado {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  reservaId: string;
  entradaId: string;
}

export interface ReservaCambiada {
  tenantId: string;
  reservaId: string;
  perfilId: string;
  turnoId: string;
  origen: OrigenReserva;
  accion: 'CONFIRMACION' | 'CANCELACION';
}

/**
 * El enganche que la Fase 3A dejo preparado. Desde la 5B **encola**, no envia.
 *
 * INVARIANTE, el de la 3A: estos metodos NUNCA deben lanzar. **El motivo
 * cambio**, asi que ojo con leer aqui el de antes. Ya NO se llaman dentro de la
 * transaccion —`ReservasService` los llama despues del commit, ver
 * `AvisosPendientes` alli—, de modo que una excepcion aqui ya no revertiria
 * nada. Lo que haria es peor de explicar: convertir en un 500 un POST que
 * guardo la reserva perfectamente bien, solo porque Redis estaba caido. Encolar
 * es una escritura a una red ajena y puede fallar; por eso el try/catch.
 *
 * Y se encola en vez de enviar porque un SMTP lento o caido en el camino de una
 * peticion es un bloqueo esperando a una red que no controlamos.
 *
 * Lo que se encola son IDENTIFICADORES Y NADA MAS. Ver el comentario de
 * `colas.ts`: un job vive en Redis serializado en JSON, asi que cualquier cosa
 * que se meta aqui queda escrita en claro.
 *
 * EL `reservaId` SI VIAJA, y hasta la Fase 5B no lo hacia —el comentario de
 * aqui decia "quien lo quiera lo busca"—. Buscarla no vale: la marca de
 * idempotencia de los processors es un compare-and-set sobre UNA FILA, y
 * `(perfilId, turnoId)` no identifica una —no hay unique sobre esa pareja, y un
 * alumno puede reservar, cancelar y volver a reservar el mismo turno—. Un
 * processor que reconstruya la fila puede marcar la de OTRO aviso y callarlo.
 * Es un identificador, asi que la regla del payload se respeta entera.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @InjectQueue(NOTIFICACION_RESERVA_QUEUE) private readonly colaReserva: Queue,
    @InjectQueue(NOTIFICACION_LISTA_ESPERA_QUEUE) private readonly colaListaEspera: Queue,
  ) {}

  async cupoAsignado(evento: CupoAsignado): Promise<void> {
    const datos: DatosNotificacionListaEspera = {
      tenantId: evento.tenantId,
      reservaId: evento.reservaId,
      perfilId: evento.perfilId,
      turnoId: evento.turnoId,
      entradaId: evento.entradaId,
    };

    await this.encolar(this.colaListaEspera, datos, `cupo asignado a ${evento.perfilId}`);
  }

  async reservaCambiada(evento: ReservaCambiada): Promise<void> {
    // Las de RUTINA no avisan. Publicar un mes con treinta alumnos son ciento
    // veinte correos en el mismo minuto, y el alumno ya sabe que va todos los
    // martes: lo que no sabe es lo que cambia.
    //
    // Hoy las de RUTINA ni siquiera pasan por aqui —las crea el aplicador del
    // plan directamente contra Prisma—, pero `origen` llega del DTO en el alta
    // manual y nada impide mandarlo. La comprobacion es barata.
    if (evento.origen === 'RUTINA') return;

    const datos: DatosNotificacionReserva = {
      tenantId: evento.tenantId,
      reservaId: evento.reservaId,
      perfilId: evento.perfilId,
      turnoId: evento.turnoId,
      accion: evento.accion,
    };

    await this.encolar(this.colaReserva, datos, `${evento.accion} de ${evento.perfilId}`);
  }

  private async encolar(cola: Queue, datos: object, descripcion: string): Promise<void> {
    try {
      await cola.add('aviso', datos, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        // Que la cola no crezca sin limite con jobs ya hechos.
        removeOnComplete: 100,
        removeOnFail: 500,
      });
    } catch (error) {
      // EL PRECIO, escrito: si Redis esta caido el aviso SE PIERDE. No se
      // reintenta, no queda en ningun sitio, no hay outbox. Lo unico que queda
      // es esta linea de log, asi que es lo unico con lo que alguien puede
      // enterarse.
      //
      // Y este es el caso FRECUENTE. El otro camino de perdida —morir entre el
      // commit y el `add`, documentado en `AvisosPendientes`— es el raro.
      //
      // Se acepta igual, y por lo mismo: perder un aviso molesta; mandar uno
      // fantasma le dice a alguien que tiene una clase que no tiene, y eso no se
      // puede desandar.
      this.logger.warn(`No se pudo encolar el aviso (${descripcion}): ${(error as Error).message}`);
    }
  }
}
