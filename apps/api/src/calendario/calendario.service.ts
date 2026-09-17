import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import type {
  EstadoJob,
  EstadoPublicacion,
  JwtPayload,
  MesCalendarioPublico,
  PlanDeMes,
  PublicacionEncolada,
  ResumenDelPlan,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { planificarMes } from '../jobs/generacion-mes/generacion-mes.service';
import { GENERACION_MES_QUEUE, type DatosGeneracionMes } from '../jobs/generacion-mes/cola';
import { CalendarioDatos } from './calendario.datos';

@Injectable()
export class CalendarioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly datos: CalendarioDatos,
    @InjectQueue(GENERACION_MES_QUEUE) private readonly cola: Queue,
  ) {}

  /**
   * Calcula el plan del mes sin escribir NADA.
   *
   * Es sincrono a proposito: no hay razon para mandar a una cola una operacion
   * de solo lectura que el admin esta esperando en pantalla. El job existe para
   * la publicacion, que si escribe y puede tardar.
   */
  async previsualizar(
    _actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<PlanDeMes> {
    this.exigirMesGenerable(anio, mes);
    const entrada = await this.datos.cargar(salaId, anio, mes);
    return planificarMes(entrada);
  }

  async encolarPublicacion(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<PublicacionEncolada> {
    this.exigirMesGenerable(anio, mes);

    // Se comprueba que la sala existe ANTES de encolar: un 404 inmediato es
    // mucho mas util que un job que falla en segundo plano.
    await this.datos.cargar(salaId, anio, mes);

    const datosDelJob: DatosGeneracionMes = {
      tenantId: actor.tenantId,
      salaId,
      anio,
      mes,
      actorId: actor.sub,
    };

    // El jobId se genera AQUI, antes de encolar, y no se deja a BullMQ.
    //
    // Es lo que elimina una carrera real: la fila de MesCalendario es el cerrojo
    // que el worker toma con un updateMany condicional, asi que tiene que existir
    // ANTES de que el job pueda empezar. Encolando primero y escribiendo despues,
    // un worker rapido llegaba a ejecutarse antes que el insert, no encontraba
    // fila, su updateMany devolvia 0 y abortaba sin escribir nada: la primera
    // publicacion se perdia en silencio y solo funcionaba la segunda.
    //
    // Se detecto en los e2e, de forma intermitente, que es como se manifiestan
    // las carreras.
    const jobId = `gen-${salaId}-${anio}-${mes}-${Date.now()}`;

    await this.anotarJobDelMes(actor, salaId, anio, mes, jobId);

    await this.cola.add('generar-mes', datosDelJob, {
      jobId,
      removeOnComplete: false,
      removeOnFail: false,
      attempts: 1,
    });

    return { jobId, salaId, anio, mes };
  }

  /**
   * Deja la fila del mes apuntando al ultimo job encolado, creandola si es la
   * primera publicacion. El estado sigue siendo BORRADOR: quien lo pasa a
   * HABILITADO es el worker, cuando termina de escribir.
   *
   * Desviacion respecto al plan, que aqui hacia un `upsert` sobre la clave
   * compuesta `tenantId_salaId_anio_mes`. La extension de aislamiento clasifica
   * `upsert` como operacion de where unico y la RECHAZA sin excepciones
   * (UnsafeUniqueOperationError), porque no hay donde inyectarle el filtro de
   * tenant. Se sustituye por findFirst + create/updateMany —a los que la
   * extension si les inyecta el tenant— dentro de una transaccion, que es lo
   * que recupera la atomicidad que daba el upsert.
   */
  private async anotarJobDelMes(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
    jobId: string,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Sin `tenantId` en el where: lo inyecta la extension de aislamiento.
      const fila = await cliente.mesCalendario.findFirst({ where: { salaId, anio, mes } });

      if (!fila) {
        // En el `data` de un create si va explicito, como en el resto de
        // servicios: el tipo generado de Prisma lo exige, y la extension acaba
        // sobrescribiendolo con el tenant del contexto de todas formas.
        await cliente.mesCalendario.create({
          data: { tenantId: actor.tenantId, salaId, anio, mes, ultimoJobId: jobId },
        });
        return;
      }

      await cliente.mesCalendario.updateMany({
        where: { id: fila.id },
        data: { ultimoJobId: jobId },
      });
    });
  }

  async obtenerMes(
    actor: JwtPayload,
    salaId: string,
    anio: number,
    mes: number,
  ): Promise<MesCalendarioPublico> {
    const fila = await this.prisma.db.mesCalendario.findFirst({
      where: { salaId, anio, mes },
    });

    if (!fila) {
      // Un mes que nunca se publico no tiene fila, y eso no es un error: es su
      // estado inicial.
      return {
        id: null,
        tenantId: actor.tenantId,
        salaId,
        anio,
        mes,
        estado: 'BORRADOR',
        publicadoEn: null,
        publicadoPor: null,
        publicacion: null,
      };
    }

    return {
      id: fila.id,
      tenantId: fila.tenantId,
      salaId: fila.salaId,
      anio: fila.anio,
      mes: fila.mes,
      estado: fila.estado,
      publicadoEn: fila.publicadoEn === null ? null : fila.publicadoEn.toISOString(),
      publicadoPor: fila.publicadoPor,
      publicacion: await this.estadoDePublicacion(fila.ultimoJobId),
    };
  }

  private async estadoDePublicacion(jobId: string | null): Promise<EstadoPublicacion | null> {
    if (!jobId) return null;

    const job = await this.cola.getJob(jobId);
    if (!job) return { jobId, estado: 'sin_job', resumen: null, error: null };

    const estado = traducirEstado(await job.getState());

    return {
      jobId,
      estado,
      resumen: estado === 'terminado' ? ((job.returnvalue ?? null) as ResumenDelPlan | null) : null,
      error: estado === 'fallido' ? (job.failedReason ?? 'Error desconocido') : null,
    };
  }

  /**
   * Regenerar un mes pasado crearia reservas para clases que ya ocurrieron, y
   * ninguna de las reglas del motor tiene sentido hacia atras.
   */
  private exigirMesGenerable(anio: number, mes: number): void {
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
      throw new BadRequestException('El mes debe estar entre 1 y 12');
    }

    const ahora = new Date();
    const actual = ahora.getUTCFullYear() * 12 + ahora.getUTCMonth();
    const pedido = anio * 12 + (mes - 1);

    if (pedido < actual) {
      throw new BadRequestException('No se puede generar un mes que ya paso');
    }
  }
}

function traducirEstado(estado: string): EstadoJob {
  switch (estado) {
    case 'completed':
      return 'terminado';
    case 'failed':
      return 'fallido';
    case 'active':
      return 'procesando';
    case 'waiting':
    case 'delayed':
    case 'prioritized':
      return 'en_cola';
    default:
      return 'sin_job';
  }
}
