import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { runUnscoped, runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PagosService } from '../../pagos/pagos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { marcarAvisoDeHoy } from './aviso-diario';
import { RECORDATORIO_PAGO_QUEUE, type DatosDiarios } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA DE LOS JOBS DIARIOS, Y POR QUE VA POR PERSONA.
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
 * LA MARCA, DESDE LA FASE 20: UNA FILA DE `AvisoDiario` POR PERSONA, TIPO Y DIA,
 * con la clave unica `(tenantId, tipo, perfilId, dia)`. Antes de mandarle el
 * aviso a alguien se INSERTA su fila (`marcarAvisoDeHoy`, en `aviso-diario.ts`):
 *
 * - si entra, se le manda;
 * - si choca con la clave unica (P2002), ya se le aviso hoy —una ejecucion
 *   anterior del mismo job— y se salta;
 * - si falla por cualquier otra cosa, se registra con el logger y se salta a
 *   ESA persona. Sin marca no se sabe si ya lo recibio, y mandar a ciegas es lo
 *   que duplica. Las demas siguen.
 *
 * EL INTERCAMBIO NUEVO, frente a la marca por gimnasio en `job.updateData` que
 * habia hasta la Fase 19:
 *
 * - UN CORTE PIERDE A LO SUMO UN AVISO: el de la persona marcada y todavia no
 *   enviada. Antes se perdia la tanda entera del gimnasio en curso.
 * - UN FALLO DE MARCA YA NO ABORTA: cuesta el aviso de esa persona y nada mas.
 *   Antes un `updateData` que fallaba propagaba, abortaba el `process` y, con
 *   `attempts: 1`, dejaba sin tanda a todos los gimnasios que faltaban — un blip
 *   de Redis en el gimnasio 2 de 30 costaba 28 gimnasios sin aviso.
 * - La marca vive en la base y no en el payload: el job ya no se escribe nada a
 *   si mismo, y `DatosDiarios` vuelve a ser solo lo que pone quien encola.
 *
 * LO QUE SIGUE IGUAL:
 *
 * - BullMQ re-encola el job atascado sin mirar `attempts` (lo de arriba). La
 *   marca existe por eso, y `attempts: 1` se queda igual.
 * - SE MARCA ANTES DE MANDAR: perder antes que duplicar. Al reves, un corte
 *   entre el envio y la marca le repite el correo a esa persona.
 * - Un aborto —ahora solo por algo que no sea marcar, como el `findMany` de los
 *   perfiles— NO mata el cron: la siguiente iteracion se programa al RECOGER el
 *   job, no al completarlo (`nextJobFromJobData`, en
 *   `bullmq/dist/cjs/classes/worker.js`), y la condicion que dispara cada aviso
 *   —seguir sin pagar, seguir cerca del vencimiento— sigue ahi manana.
 *
 * EL DIA es el del job (`ahoraISO` si viene, si no el reloj del worker al
 * empezar), a medianoche UTC porque la columna es `@db.Date`. El cron corre a
 * las 09:00 de `ZONA_HORARIA`: una re-ejecucion por atasco cae el mismo dia UTC
 * salvo que tarde horas, y ahi lo peor es un segundo aviso, que es lo que haria
 * el cron de manana de todos modos.
 *
 * EL COSTO: un INSERT por destinatario —al lado de las cuatro consultas y el
 * envio que ya hace `avisar`, no se nota— y UNA FILA POR PERSONA AVISADA Y DIA,
 * que se queda. No hay limpieza: las filas son chicas y el volumen es el de los
 * correos que ya se mandan (la cuenta esta en PROGRESO, Fase 20). Si algun dia
 * pesa, se borran las de dias pasados sin riesgo: solo la de HOY tiene uso.
 */
type JobDiario = Job<DatosDiarios>;

/**
 * PAUSA ENTRE CORREOS DE LA TANDA MASIVA, en milisegundos.
 *
 * POR QUE HAY RITMO Y NO TOPE, que es la pregunta que se hace quien lee esto:
 * el bucle de abajo es secuencial, asi que nunca fue una avalancha simultanea
 * —pero eran 500 correos SEGUIDOS contra el mismo SMTP sin una sola pausa, y
 * eso es exactamente lo que los proveedores frenan o directamente bloquean.
 *
 * La alternativa obvia —un tope de N por ejecucion— esta DESCARTADA: cortar la
 * tanda significa que a algun moroso no se le avisa, y no avisarle es peor que
 * tardar. El job puede durar mas; nadie se queda sin su recordatorio.
 *
 * EL DEFECTO, 200 ms = 5 envios por segundo:
 *
 * - Por abajo, es el orden de magnitud que respetan los limites de los SMTP
 *   compartidos, que es lo que tiene un gimnasio y no un relay propio.
 * - Por arriba, 500 morosos son ~100 s de tanda. Sigue siendo corta para un
 *   cron de madrugada y no se acerca a nada que duela: el lock del job lo
 *   renueva el worker cada 15 s y esta pausa deja el event loop LIBRE (es un
 *   timer, no trabajo), asi que no acerca el job al camino de "atascado".
 * - Y el riesgo de una tanda mas larga es conocido y acotado: una tanda
 *   interrumpida pierde a lo sumo el aviso de la persona en curso, y la
 *   re-ejecucion salta a los ya marcados (ver `JobDiario`).
 *
 * CONFIGURABLE, con el mismo molde que `common/throttling.ts`: constante de
 * modulo leida de `process.env` con el valor de produccion como DEFECTO, para
 * que olvidarse de la variable deje el sistema en el lado seguro. No es un dato
 * del payload: no depende del job sino del SMTP del despliegue, y
 * `RegistroDeCrones` —que es quien encola— no tiene nada que decir al respecto.
 *
 * `validar-entorno.ts` la rechaza si viene con algo que no sea un entero >= 0:
 * `Number('rapido')` es NaN, `setTimeout(fn, NaN)` dispara al instante, y eso
 * seria un despliegue que cree tener ritmo y manda los 500 correos pegados sin
 * una linea de log que lo diga.
 */
export const PAUSA_ENTRE_EMAILS_MS = Number(process.env.PAUSA_ENTRE_EMAILS_MS ?? 200);

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
 *    mirarlo—, y por eso hay ademas una marca por persona: ver `JobDiario`.
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
 * ES IDEMPOTENTE POR PERSONA Y DIA, no por job: si este `process` vuelve a
 * correr el mismo dia, quien ya tiene su marca se salta y, como mucho, se pierde
 * el aviso de quien estaba en curso. Ver `JobDiario`, que explica por que esa
 * granularidad y por que `attempts: 1` no basta.
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

    let avisados = 0;
    for (const tenant of tenants) {
      avisados += await this.deUnGimnasio(tenant, ahora);
    }

    // Cuenta lo de ESTA ejecucion: a quien ya tenia la marca de hoy no se le
    // mando nada, y no esta aqui.
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

      let avisados = 0;
      for (const perfil of pendientes) {
        // SE MARCA ANTES DE MANDAR, persona por persona: al reves, un corte
        // entre el envio y la marca le repite el correo. Ya marcada hoy, o un
        // fallo al marcar, y se salta SOLO a esta persona. Ver `JobDiario`.
        const marcada = await marcarAvisoDeHoy(this.prisma.db, this.logger, {
          tenantId: tenant.id,
          perfilId: perfil.id,
          tipo: 'recordatorio-pago',
          ahora,
        });
        if (!marcada) continue;

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

        // EL RITMO. Va DESPUES de cada envio y no entre los de este gimnasio: de
        // la otra forma el ultimo correo de un gimnasio y el primero del
        // siguiente salen pegados, y con treinta gimnasios de pocos alumnos no
        // habria ritmo en absoluto. El precio es una pausa de mas al final de la
        // tanda, que no le importa a nadie.
        //
        // Ver `PAUSA_ENTRE_EMAILS_MS` para por que es ritmo y no tope.
        await this.pausar(PAUSA_ENTRE_EMAILS_MS);
        avisados += 1;
      }

      return avisados;
    });
  }

  /**
   * La unica linea de este processor que toca el reloj, y esta sola en un
   * metodo por eso: es la costura por la que los tests la sustituyen.
   *
   * Sin ella, un test que manda tres correos costaria tres pausas de verdad, y
   * el precio lo pagaria la suite entera cada vez que corre. Es el mismo criterio
   * que el `ahoraISO` del payload, que existe para que la fecha de corte no sea
   * el reloj real: aqui el dato configurable vive en el entorno —es del SMTP del
   * despliegue, no del job— y lo inyectable es el que espera.
   */
  protected pausar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
