import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PagosService } from '../../pagos/pagos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RECORDATORIO_PAGO_QUEUE, type DatosDiarios } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA DE LOS JOBS DIARIOS, Y POR QUE VA POR GIMNASIO.
 *
 * ⚠️ LO PRIMERO, PORQUE DESMIENTE LO QUE PARECE OBVIO: **`attempts: 1` NO
 * garantiza que este `process` corra una sola vez.** No es una sutileza teorica
 * y no se deduce leyendo la documentacion; esta en el codigo de la BullMQ
 * instalada (5.81.5):
 *
 * - `bullmq/dist/cjs/scripts/moveStalledJobsToWait-9.js` re-encola un job
 *   ATASCADO con `moveJobToWait` **sin consultar `attempts` en absoluto**.
 * - Y para un repetible ni siquiera hay tope: la unica salida por fallo es
 *   `if stalledCount > maxStalledJobCount and not isRepeatableJob`, y estos dos
 *   jobs SON repetibles.
 * - Se dispara con los defaults del worker (`lockDuration: 30000`,
 *   `stalledInterval: 30000`, y `app.module.ts` no los cambia) cada vez que el
 *   worker muere o se reinicia a mitad de tanda —UN DEPLOY A LAS 09:00—, que el
 *   event loop se bloquee mas de 30 segundos, o que Redis pierda el lock.
 * - Y `attemptsMade` no sirve para detectarlo: el atasco incrementa `stc`, no
 *   `atm`.
 *
 * O sea que sin marca, la tanda entera se manda otra vez. La ventana no es
 * corta: `MensajeroService.avisar` hace por CADA destinatario una consulta de
 * plantilla, una de SMTP, un descifrado y un envio, todo secuencial — un
 * gimnasio de 300 alumnos son minutos de exposicion.
 *
 * POR GIMNASIO, Y NO EN LAS OTRAS DOS GRANULARIDADES POSIBLES:
 *
 * - POR JOB ENTERO (`if (job.data.iniciado) return;`) convierte "re-mandar
 *   cientos" en "no mandar NADA hoy", y se lleva por delante a todos los
 *   gimnasios que aun no se habian procesado. Cambia un problema por otro.
 * - POR DESTINATARIO es una escritura a Redis por email —cara— y deja el payload
 *   creciendo sin control.
 * - POR GIMNASIO acota la perdida a UNA tanda parcial, la del gimnasio que
 *   estaba en curso cuando se corto, y garantiza que ningun alumno reciba dos.
 *
 * Y SE MARCA ANTES DE MANDAR, como en los dos processors hermanos: al reves, un
 * corte entre el envio y la marca repite el gimnasio entero. Asi el peor caso es
 * el contrario —la tanda de ese gimnasio se pierde— y es el mismo intercambio
 * que eligio toda la fase: perder antes que duplicar.
 *
 * EL PRECIO DE ESA MARCA, ENTERO, PORQUE ES MAS CARO DE LO QUE PARECE: si
 * `updateData` falla, se propaga sin haber mandado nada de ese gimnasio —esa es
 * la mitad buena— pero al propagarse ABORTA EL `process` COMPLETO, y con
 * `attempts: 1` no hay reintento: los gimnasios que aun no se habian recorrido
 * se quedan sin tanda ese dia. Un blip de Redis en el gimnasio 2 de 30 cuesta 28
 * gimnasios sin aviso.
 *
 * Se acepta igual, y no se envuelve en un try/catch para seguir con el
 * siguiente: eso dejaria el gimnasio en curso SIN marcar despues de haber
 * mandado —o a medio mandar—, y volveria a mandarle entero en la proxima
 * ejecucion. Seguir es justo lo que reintroduce la duplicacion que esta marca
 * viene a evitar.
 *
 * Y LO QUE UN ABORTO NO ROMPE, que es lo que hace esto llevadero: NO mata el
 * cron. La siguiente iteracion se programa al RECOGER el job, no al completarlo
 * (`nextJobFromJobData`, en `bullmq/dist/cjs/classes/worker.js`), asi que un job
 * que revienta a mitad no rompe la cadena: manana el cron vuelve a disparar, y
 * la condicion que dispara cada aviso —seguir sin pagar, seguir cerca del
 * vencimiento— sigue ahi.
 *
 * NO es un dato del payload en el sentido de `colas.ts`: no lo pone quien
 * encola, no se lee como identificador y no sale de `datosDeEnvio()`. Es una
 * lista que el worker se escribe a si mismo.
 */
type JobDiario = Job<DatosDiarios & { gimnasiosHechos?: string[] }>;

/**
 * EL RECORDATORIO DE PAGO. UN JOB, N EMAILS — y ahi esta toda la diferencia con
 * sus dos hermanos.
 *
 * `notificacion-reserva` y `notificacion-lista-espera` mandan UN aviso por job,
 * a una persona que acaba de hacer algo. Este recorre TODOS los gimnasios y
 * manda tantos correos como alumnos deban: es el unico camino del sistema capaz
 * de mandar correo masivo sin que nadie lo este mirando. Tres consecuencias que
 * conviene tener presentes antes de tocar nada aqui:
 *
 * 1. SE ENCOLA CON `attempts: 1`, y esta puesto EXPLICITO en `RegistroDeCrones`
 *    con su motivo escrito. No se hereda del default de BullMQ por casualidad y
 *    no se "unifica" con el `attempts: 3` de `NotificacionesService`: un
 *    reintento de este job es una segunda tanda de correo a los mismos alumnos.
 *    Pero `attempts: 1` NO ALCANZA —el camino de job atascado re-encola sin
 *    mirarlo—, y por eso hay ademas una marca por gimnasio: ver `JobDiario`.
 *
 * 2. SE CUENTA ANTES DE MANDAR. Hay un `logger.log` por gimnasio con cuantos
 *    avisos van a salir, ANTES del bucle de envio. Si algun dia `perfilesAlDia`
 *    o el `where` de abajo se rompen, la diferencia entre "3 avisos" y "180
 *    avisos" en el log es lo unico que permite enterarse el mismo dia, en vez
 *    de por las quejas.
 *
 * 3. UN JOB DIARIO NO TIENE TENANT. Los otros dos lo reciben en el payload
 *    porque los encola alguien que ya esta dentro de un gimnasio; a este lo
 *    dispara un cron, que no viene de ninguno. De ahi el `runUnscoped` para
 *    listar los gimnasios y un `runWithTenant` por cada uno.
 *
 * ES IDEMPOTENTE POR GIMNASIO, no por job: si este `process` vuelve a correr con
 * el mismo job, los gimnasios ya procesados se saltan y el que se estaba
 * procesando se pierde. Ver `JobDiario`, que explica por que esa granularidad y
 * por que `attempts: 1` no basta.
 *
 * `MensajeroService.avisar` NUNCA LANZA: si el SMTP esta caido, el job termina
 * OK, el contador dice que se avisaron N y los N avisos se pierden con un
 * `logger.warn` dentro del mensajero como unico rastro. Es deliberado —lo
 * contrario seria reintentar la tanda entera por un SMTP caido—, pero significa
 * que "avisados" cuenta intentos, no entregas.
 *
 * LO QUE LA PLANTILLA NO DICE, y esta hablado: `RECORDATORIO_PAGO` NO lleva
 * importe ni periodo. Un importe escrito en un email queda desactualizado en
 * cuanto hay un pago parcial o una cortesia, y discutir por correo un numero
 * viejo es peor que no ponerlo. No se anaden esas variables.
 */
@Processor(RECORDATORIO_PAGO_QUEUE)
export class RecordatorioPagoProcessor extends WorkerHost {
  private readonly logger = new Logger(RecordatorioPagoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pagos: PagosService,
    private readonly mensajero: MensajeroService,
  ) {
    super();
  }

  async process(job: JobDiario): Promise<{ avisados: number }> {
    const ahora = job.data.ahoraISO ? new Date(job.data.ahoraISO) : new Date();

    // Listar los gimnasios es deliberadamente global: el cron no viene de
    // ninguno. `runUnscoped` lo deja VISIBLE en el codigo en vez de esconderlo
    // detras de `prisma.base`, que es la otra forma de salirse del aislamiento
    // y no se le nota al leerla. Es la unica consulta sin tenant de este
    // archivo, y no toca ninguna fila de ningun alumno.
    const tenants = await runUnscoped(() =>
      this.prisma.db.tenant.findMany({
        where: { activo: true },
        // `slug` no es decorativo: la ruta del push es `/<slug>/mi-pack`, y
        // sin el la notificacion lleva a un 404. Ver el `avisar` de abajo.
        select: { id: true, nombre: true, slug: true },
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

      // SE MARCA ANTES DE MANDAR, y ese orden es la mitad que importa: al reves,
      // un corte entre el envio y la marca repite el gimnasio ENTERO. Ver
      // `JobDiario`. Si esto falla, se propaga sin haber mandado nada.
      hechos.add(tenant.id);
      await job.updateData({ ...job.data, gimnasiosHechos: [...hechos] });

      avisados += await this.deUnGimnasio(tenant, ahora);
    }

    // Cuenta lo de ESTA ejecucion. Si el job ya venia con gimnasios marcados, los
    // avisos que salieron en la anterior no estan aqui.
    this.logger.log(
      `Recordatorio de pago: ${avisados} avisos en ${tenants.length} gimnasios (job ${job.id})`,
    );
    return { avisados };
  }

  private async deUnGimnasio(
    tenant: { id: string; nombre: string; slug: string },
    ahora: Date,
  ): Promise<number> {
    return await runWithTenant(tenant.id, async () => {
      // A QUIEN SE LE AVISA: alumnos ACTIVOS y CON PACK.
      //
      // `usuario: { activo: true }` no es un detalle: la baja de un usuario es
      // logica —la fila se queda—, asi que sin esta condicion un alumno dado de
      // baja hace seis meses recibiria este recordatorio todos los meses para
      // siempre. Es la misma regla que los otros dos processors comprueban
      // sobre el destinatario ya elegido; aqui va en el `where` porque aqui el
      // destinatario se ELIGE.
      //
      // `packId: { not: null }` es la otra mitad: quien no tiene pack no debe
      // nada, y reclamarle por correo una cuota que no tiene es peor que no
      // escribirle.
      const perfiles = await this.prisma.db.perfil.findMany({
        where: { packId: { not: null }, usuario: { rol: 'ALUMNO', activo: true } },
        include: { usuario: { select: { nombreCompleto: true, email: true } } },
      });
      if (perfiles.length === 0) return 0;

      // La regla de "estar al dia" NO se reimplementa aqui. Vive entera en
      // `estaAlDia`, y `perfilesAlDia` la resuelve para todos los perfiles en
      // una sola consulta: copiarla en un `where` crearia dos versiones que
      // algun dia discrepan, y discrepar aqui significa escribirle a quien ya
      // pago.
      const alDia = await this.pagos.perfilesAlDia(
        this.prisma.db,
        perfiles.map((p) => p.id),
        ahora,
      );

      const pendientes = perfiles.filter((perfil) => !alDia.has(perfil.id));

      // EL CONTADOR, ANTES DEL BUCLE. Ver el punto 2 de la cabecera: este log es
      // el unico sitio donde un numero absurdo se ve ANTES de que los correos
      // hayan salido.
      this.logger.log(
        `${tenant.nombre}: ${pendientes.length} recordatorios de pago sobre ${perfiles.length} alumnos con pack`,
      );

      for (const perfil of pendientes) {
        await this.mensajero.avisar(
          {
            perfilId: perfil.id,
            email: perfil.usuario.email,
            nombre: perfil.usuario.nombreCompleto,
          },
          'RECORDATORIO_PAGO',
          // Solo lo que la plantilla usa. `DatosDePlantilla` es un
          // `Record<string, string>`: no obliga a rellenar `fecha`, `clase` ni
          // `hora` con cadenas vacias, y pasarlas vacias solo invita a que
          // alguien las interpole en el texto y mande un email con huecos.
          { alumno: perfil.usuario.nombreCompleto, gimnasio: tenant.nombre },
          // CON EL SLUG, y con el del gimnasio DE ESTA VUELTA. Las pantallas de
          // la PWA viven en `/<slug>/mi-pack`: un `/mi-pack` pelado es un 404 en
          // cuanto el alumno toca la notificacion con la aplicacion cerrada, que
          // es el caso normal, y adivinar el slug en el cliente le puede abrir a
          // un socio de dos gimnasios el que no es.
          //
          // Aqui no hay caso "sin slug": `slug` es NOT NULL y sale del mismo
          // `findMany` que trajo el gimnasio. El que si existe es el de mezclar
          // gimnasios entre vueltas del bucle, y hay un test que lo fija.
          `/${tenant.slug}/mi-pack`,
        );
      }

      return pendientes.length;
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
    this.logger.error(`Error del worker de recordatorio de pago: ${error.message}`, error.stack);
  }

  /** Un job fallido no debe pasar desapercibido en el log. */
  @OnWorkerEvent('failed')
  alFallarUnJob(job: Job<DatosDiarios> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? '(desconocido)'} de recordatorio de pago fallido: ${error.message}`,
      error.stack,
    );
  }
}
