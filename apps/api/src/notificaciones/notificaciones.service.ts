import { Injectable, Logger } from '@nestjs/common';

export interface CupoAsignado {
  tenantId: string;
  perfilId: string;
  turnoId: string;
  reservaId: string;
}

/**
 * El enganche que la Fase 5 va a llenar con push y email.
 *
 * Hoy solo deja rastro en el log. Existe igualmente porque el punto exacto
 * donde hay que notificar —dentro de la transaccion que asigna el cupo, cuando
 * ya se sabe que la reserva se creo— es facil de perder de vista despues, y
 * mucho mas barato de dejar marcado ahora.
 *
 * INVARIANTE: este metodo NUNCA debe lanzar. Se llama dentro de la transaccion
 * que asigna el cupo, asi que una excepcion aqui revertiria una reserva
 * perfectamente valida. Cuando la Fase 5 meta aqui una llamada de red, tiene
 * que ir envuelta en su propio try/catch o salir de la transaccion.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  async cupoAsignado(evento: CupoAsignado): Promise<void> {
    this.logger.log(
      `Cupo liberado asignado desde lista de espera: perfil ${evento.perfilId}, ` +
        `turno ${evento.turnoId}, reserva ${evento.reservaId}. ` +
        'Sin notificacion real hasta la Fase 5.',
    );
  }
}
