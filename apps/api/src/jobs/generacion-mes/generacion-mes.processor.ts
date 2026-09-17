import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { JwtPayload, ResumenDelPlan } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { CalendarioDatos } from '../../calendario/calendario.datos';
import { GENERACION_MES_QUEUE, type DatosGeneracionMes } from './cola';
import { planificarMes } from './generacion-mes.service';
import { PublicacionService } from './publicacion.service';

@Processor(GENERACION_MES_QUEUE)
export class GeneracionMesProcessor extends WorkerHost {
  private readonly logger = new Logger(GeneracionMesProcessor.name);

  constructor(
    private readonly datos: CalendarioDatos,
    private readonly publicacion: PublicacionService,
  ) {
    super();
  }

  /**
   * Un job NO tiene request, asi que no hay middleware que abra el contexto de
   * tenant: `getTenantContext()` devolveria undefined y la extension de Prisma
   * lanzaria `MissingTenantContextError` en la primera query. Eso es el diseno
   * fail-closed funcionando, no un fallo — se verifico empiricamente antes de
   * escribir una linea de esta fase, incluido que sin contexto Prisma FALLA en
   * vez de devolver datos sin filtrar.
   *
   * Por eso todo el trabajo va envuelto en `runWithTenant` con el tenantId del
   * payload. Ese tenantId es un DATO DE SEGURIDAD: es lo unico que le dice al
   * worker sobre que gimnasio puede operar, y lo pone el controller desde el JWT
   * del actor, NUNCA el cuerpo de la peticion.
   */
  async process(job: Job<DatosGeneracionMes>): Promise<ResumenDelPlan> {
    const { tenantId, salaId, anio, mes, actorId } = job.data;

    this.logger.log(`Generando ${anio}-${mes} de la sala ${salaId} (job ${job.id})`);

    return await runWithTenant(tenantId, async () => {
      // El actor se reconstruye a mano porque aqui no hay JWT. El rol es el que
      // exigio el endpoint para poder encolar.
      const actor: JwtPayload = { sub: actorId, tenantId, rol: 'ADMIN_SALON' };

      // Se recargan los datos y se replanifica en vez de confiar en el plan que
      // vio el admin: entre la previsualizacion y la publicacion pueden haber
      // cambiado rutinas, cupos o vacaciones.
      const entrada = await this.datos.cargar(salaId, anio, mes);
      const plan = planificarMes(entrada);

      const resumen = await this.publicacion.aplicar(actor, salaId, anio, mes, plan);

      this.logger.log(
        `Mes ${anio}-${mes} publicado: ${resumen.turnos} turnos, ${resumen.reservas} reservas, ` +
          `${resumen.conflictos} conflictos`,
      );

      return resumen;
    });
  }

  /**
   * Errores del Worker, no de un job concreto: Redis caido, una clave que
   * desaparece a mitad de proceso, un fallo al mover el job a terminado.
   *
   * Sin este listener, BullMQ los emite como evento `error` de un EventEmitter
   * que nadie escucha, y en Node eso se convierte en un `ERR_UNHANDLED_ERROR`
   * que puede tumbar el proceso entero. Se detecto en los e2e de la Fase 2,
   * donde limpiar la cola mientras un job seguia vivo llenaba la salida de ruido
   * que no tenia nada que ver con el test que fallaba.
   */
  @OnWorkerEvent('error')
  alFallarElWorker(error: Error): void {
    this.logger.error(`Error del worker de generacion: ${error.message}`, error.stack);
  }

  /** Un job fallido no debe pasar desapercibido en el log. */
  @OnWorkerEvent('failed')
  alFallarUnJob(job: Job<DatosGeneracionMes> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? '(desconocido)'} de generacion fallido: ${error.message}`,
      error.stack,
    );
  }
}
