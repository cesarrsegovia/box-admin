import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { comienzoDeHoyUtc, fechaLegible } from '@boxadmin/shared';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PrismaService } from '../../prisma/prisma.service';
import { VENCIMIENTO_PACK_QUEUE, type DatosDiarios } from './colas';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * La marca de idempotencia, POR GIMNASIO y escrita ANTES de mandar. El porque
 * entero —que `attempts: 1` no impide una segunda ejecucion porque el camino de
 * job atascado de BullMQ re-encola sin mirarlo, y por que la marca no va por job
 * ni por destinatario— esta en la cabecera de `recordatorio-pago.processor.ts`,
 * con el archivo y la linea de BullMQ que lo demuestran. No se repite aqui para
 * no tener dos copias que algun dia digan cosas distintas.
 *
 * SI VALE LA PENA REPETIR EL PRECIO, porque es lo que mas sorprende: un fallo de
 * `updateData` no solo se lleva la tanda de ese gimnasio, ABORTA EL `process`
 * ENTERO, y con `attempts: 1` los gimnasios que aun no se habian recorrido se
 * quedan sin aviso ese dia. Lo que NO rompe es el cron: la siguiente iteracion
 * se programa al recoger el job, no al completarlo (`nextJobFromJobData`, en
 * `bullmq/dist/cjs/classes/worker.js`), asi que manana vuelve a disparar.
 */
type JobDiario = Job<DatosDiarios & { gimnasiosHechos?: string[] }>;

/**
 * EL AVISO DE VENCIMIENTO DE PACK. UN JOB, N EMAILS, igual que su gemelo el
 * recordatorio de pago, y con las mismas tres consecuencias:
 *
 * 1. SE ENCOLA CON `attempts: 1`, explicito en `RegistroDeCrones`. Reintentar
 *    una tanda a medias no recupera nada y duplica lo ya mandado. Y como eso NO
 *    basta —el camino de job atascado re-encola sin mirar `attempts`—, lleva
 *    ademas la marca por gimnasio de `JobDiario`.
 * 2. SE CUENTA ANTES DE MANDAR, un `logger.log` por gimnasio.
 * 3. UN JOB DIARIO NO TIENE TENANT: `runUnscoped` para listar los gimnasios y
 *    un `runWithTenant` por cada uno.
 *
 * La cabecera de `recordatorio-pago.processor.ts` desarrolla los tres; aqui no
 * se repiten para no tener dos copias que algun dia digan cosas distintas.
 *
 * ⚠️ DEUDA ACEPTADA, NO LA ARREGLES EN ESTA FASE: **el aviso se repite cada dia
 * de la ventana.** Un pack que vence dentro de siete dias, con
 * `diasAvisoVencimiento = 7`, entra en la ventana hoy y sigue dentro manana y
 * pasado: son **OCHO** correos, no siete, porque la ventana `[hoy, hoy + dias]`
 * es inclusiva por los dos lados y el ultimo es el dia que vence. Arreglarlo
 * pide una columna de "ultima vez que
 * avisamos" en `Perfil`, y esa columna conviene pensarla junto al resto de los
 * "ya avisado" del sistema, no sola. **Esta hablado con Cesar: lo quiere, pero
 * en una fase posterior.** Queda anotado en el tracker de la fase.
 *
 * Y LA VENTANA LA MANDA EL TENANT, `tenant.diasAvisoVencimiento`, no una
 * constante de este archivo. Es configuracion por gimnasio desde la Task 0 del
 * plan (el 7 es solo su valor por defecto): una constante aqui la ignoraria en
 * silencio y el gimnasio que la cambie no notaria nada.
 */
@Processor(VENCIMIENTO_PACK_QUEUE)
export class VencimientoPackProcessor extends WorkerHost {
  private readonly logger = new Logger(VencimientoPackProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensajero: MensajeroService,
  ) {
    super();
  }

  async process(job: JobDiario): Promise<{ avisados: number }> {
    const ahora = job.data.ahoraISO ? new Date(job.data.ahoraISO) : new Date();

    // Deliberadamente global, y visible: el cron no viene de ningun gimnasio.
    // Ver la cabecera del processor hermano.
    const tenants = await runUnscoped(() =>
      this.prisma.db.tenant.findMany({
        where: { activo: true },
        // `slug` no es decorativo: la ruta del push es `/<slug>/mi-pack`, y
        // sin el la notificacion lleva a un 404. Ver el `avisar` de abajo.
        select: { id: true, nombre: true, slug: true, diasAvisoVencimiento: true },
      }),
    );

    const hechos = new Set(job.data.gimnasiosHechos ?? []);

    let avisados = 0;
    for (const tenant of tenants) {
      if (hechos.has(tenant.id)) {
        this.logger.log(
          `${tenant.nombre} ya se proceso en una ejecucion anterior del job ${job.id}; se omite`,
        );
        continue;
      }

      // SE MARCA ANTES DE MANDAR: al reves, un corte entre el envio y la marca
      // repite el gimnasio entero. Ver `JobDiario`.
      hechos.add(tenant.id);
      await job.updateData({ ...job.data, gimnasiosHechos: [...hechos] });

      avisados += await this.deUnGimnasio(tenant, ahora);
    }

    // Cuenta lo de ESTA ejecucion: los avisos de una anterior no estan aqui.
    this.logger.log(
      `Vencimiento de pack: ${avisados} avisos en ${tenants.length} gimnasios (job ${job.id})`,
    );
    return { avisados };
  }

  private async deUnGimnasio(
    tenant: { id: string; nombre: string; slug: string; diasAvisoVencimiento: number },
    ahora: Date,
  ): Promise<number> {
    return await runWithTenant(tenant.id, async () => {
      // LA VENTANA: desde la medianoche de hoy hasta hoy + los dias que diga
      // ESTE gimnasio. `comienzoDeHoyUtc` y no `ahora` a secas porque
      // `vigenciaHasta` es una fecha a medianoche UTC: comparar contra la hora
      // actual dejaria fuera lo que vence hoy mismo, que es justo a quien mas
      // urge avisar.
      //
      // Y LA VENTANA ES INCLUSIVA POR LOS DOS LADOS, lo que fija el significado
      // de un caso que nadie escribio en ningun sitio: `diasAvisoVencimiento: 0`
      // NO quiere decir "no avisar", quiere decir "avisar el mismo dia que
      // vence" — el limite cae en la medianoche de hoy y solo entra quien vence
      // hoy. Hay dos tests que fijan ese borde, porque un `lte` que se volviera
      // `lt` lo cambiaria en silencio.
      const hoy = comienzoDeHoyUtc(ahora);
      const limite = new Date(hoy.getTime() + tenant.diasAvisoVencimiento * MS_POR_DIA);

      const perfiles = await this.prisma.db.perfil.findMany({
        where: {
          vigenciaHasta: { gte: hoy, lte: limite },
          // Misma regla que el recordatorio de pago: a quien esta dado de baja
          // no se le escribe. La baja es logica, la fila se queda, y su
          // `vigenciaHasta` sigue ahi para siempre.
          usuario: { rol: 'ALUMNO', activo: true },
        },
        include: { usuario: { select: { nombreCompleto: true, email: true } } },
      });

      // El `where` de arriba ya excluye los nulos —un rango sobre una columna
      // nullable no los devuelve—, asi que esto no descarta a nadie en la
      // practica: es lo que le dice al compilador que `vigenciaHasta` es una
      // fecha, y una red por si alguien afloja el rango. Si algun dia pasara,
      // el alumno se queda sin aviso en vez de recibir un email con la fecha en
      // blanco.
      const aAvisar = perfiles.filter(
        (perfil): perfil is (typeof perfiles)[number] & { vigenciaHasta: Date } =>
          perfil.vigenciaHasta !== null,
      );

      // EL CONTADOR, ANTES DEL BUCLE: un numero absurdo aqui se ve el mismo dia.
      this.logger.log(
        `${tenant.nombre}: ${aAvisar.length} avisos de vencimiento con ventana de ` +
          `${tenant.diasAvisoVencimiento} dias`,
      );

      for (const perfil of aAvisar) {
        await this.mensajero.avisar(
          {
            perfilId: perfil.id,
            email: perfil.usuario.email,
            nombre: perfil.usuario.nombreCompleto,
          },
          'VENCIMIENTO_PACK',
          {
            alumno: perfil.usuario.nombreCompleto,
            gimnasio: tenant.nombre,
            // LEGIBLE, no ISO: esto lo lee un alumno. `resolverMensaje` no
            // formatea a proposito —es pura y no sabe de idiomas—, asi que le
            // toca a quien arma los datos. `clase` y `hora` no se pasan: esta
            // plantilla no los usa y `DatosDePlantilla` no los exige.
            fecha: fechaLegible(perfil.vigenciaHasta),
          },
          // CON EL SLUG del gimnasio de ESTA vuelta: las pantallas viven en
          // `/<slug>/mi-pack` y un `/mi-pack` pelado es un 404 con la PWA
          // cerrada. El motivo entero esta en el processor de recordatorio.
          `/${tenant.slug}/mi-pack`,
        );
      }

      return aAvisar.length;
    });
  }

  /**
   * Errores del Worker, no de un job concreto: Redis caido, un fallo al mover el
   * job a terminado. Sin este listener BullMQ los emite como evento `error` de
   * un EventEmitter que nadie escucha, y en Node eso es un `ERR_UNHANDLED_ERROR`
   * que puede tumbar el proceso. Cada Worker necesita el suyo.
   */
  @OnWorkerEvent('error')
  alFallarElWorker(error: Error): void {
    this.logger.error(`Error del worker de vencimiento de pack: ${error.message}`, error.stack);
  }

  /** Un job fallido no debe pasar desapercibido en el log. */
  @OnWorkerEvent('failed')
  alFallarUnJob(job: Job<DatosDiarios> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? '(desconocido)'} de vencimiento de pack fallido: ${error.message}`,
      error.stack,
    );
  }
}
