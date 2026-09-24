import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fechaLegible } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICACION_LISTA_ESPERA_QUEUE, type DatosNotificacionListaEspera } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA, la misma que usa el processor hermano
 * (`notificacion-reserva.processor.ts`) y por el mismo motivo: `attempts: 3`
 * hace que este `process` pueda correr dos veces con el mismo job, y la segunda
 * vuelta no puede mandar el segundo email.
 *
 * ==========================================================================
 * POR QUE NO SE USA `ListaEspera.notificado`, AUNQUE LA COLUMNA EXISTA Y
 * PAREZCA HECHA A MEDIDA DE ESTE PROCESSOR. LEER ESTO ANTES DE "ARREGLARLO".
 * ==========================================================================
 *
 * La columna existe desde la Fase 3A con el comentario "Lo escribira el modulo
 * de notificaciones de la Fase 5. Hoy siempre false", y el plan de esta fase
 * daba por hecho que esta era la linea que lo cumpliria. NO LO ES, y no puede
 * serlo, porque **la fila ya no existe cuando este processor corre**:
 *
 *   `ListaEsperaService.asignarPrimero` BORRA la entrada de la cola
 *   (`listaEspera.deleteMany({ where: { id: entrada.id } })`) DENTRO de la
 *   misma transaccion que crea la reserva, y el aviso se encola DESPUES del
 *   commit (`ReservasService.encolarAvisos`). Para cuando el worker toma el
 *   job, esa fila lleva borrada desde antes de que el job existiera.
 *
 * El borrado es la semantica querida, no un descuido: `CupoRepartido.entradaId`
 * se documenta como "la entrada de la cola de la que salio, YA BORRADA de la
 * tabla", hay un test que lo fija ("borra la fila de la cola al asignar") y la
 * propia plantilla LISTA_ESPERA le dice al alumno "Ya no estas en la lista de
 * espera".
 *
 * CONSECUENCIA DE INTENTARLO IGUAL, que es la trampa fina: un
 * `updateMany({ where: { id: entradaId }, data: { notificado: true } })`
 * devolveria `count: 0` SIEMPRE. No lanza, no rompe ningun test, y no escribe
 * nada — la columna seguiria en false para siempre y el codigo aparentaria
 * cumplir el comentario de la Fase 3A. Y si encima se escribe como
 * compare-and-set —`where: { id, notificado: false }` mandando solo si
 * `count === 1`, que es la forma CORRECTA de escribir esa columna— el gate que
 * existe para evitar UN duplicado se convierte en un gate que **no deja pasar
 * NINGUN aviso**: cero emails de lista de espera, en silencio y en verde.
 *
 * Asi que la marca vive donde la del hermano: en el propio job, con
 * `job.updateData`. Persiste en Redis, en la clave del job, asi que la ve
 * cualquier intento posterior del MISMO job, que es exactamente el escenario
 * que `attempts: 3` crea.
 *
 * LO QUE ESTA MARCA NO CUBRE son los mismos cuatro agujeros enumerados en
 * `JobDeAviso` de `notificacion-reserva.processor.ts` (dos jobs distintos para
 * el mismo aviso; el mismo job en dos workers a la vez; la marca muere con el
 * job al limpiarse la cola; un job agotado queda en `failed` con la marca
 * puesta). Vale la pena repetir el segundo, porque es el que el CAS habria
 * cerrado: esto es un read-modify-write SIN atomicidad, asi que si el lock del
 * job vence —una pausa larga del event loop, un GC, Redis lento— BullMQ lo
 * redistribuye mientras el primer worker sigue vivo, los dos leen la marca
 * ausente y los dos mandan.
 *
 * Y DOS COSAS QUE LA MARCA NO DICE, que son el caso FRECUENTE y no el raro:
 *
 * e. `MensajeroService.avisar` NUNCA LANZA. Si el SMTP esta caido o mal
 *    configurado, este `process` termina bien, el job se completa y la marca se
 *    queda puesta: NO HAY REINTENTO POSIBLE. Asi que "en el peor caso el aviso
 *    se pierde" es optimista — se pierde SIEMPRE que falle el envio, y el unico
 *    rastro es un `logger.warn` dentro del mensajero. Es deliberado (reintentar
 *    el job entero por un SMTP caido le mandaria el aviso tres veces a quien si
 *    lo recibio), pero la marca no es una garantia de entrega: garantiza que se
 *    intento, una vez.
 *
 * f. EL EMAIL Y EL PUSH FALLAN POR SEPARADO —`avisar` los manda en dos pasos— y
 *    esta marca es un booleano POR JOB, no por canal. Si sale uno y el otro no,
 *    la marca dice "hecho" para los dos y nadie reintenta el que falto. Se
 *    acepta por lo mismo de arriba; queda escrito para que no sorprenda.
 *
 * COMO SE CIERRA, cuando se pueda migrar: una columna NUEVA en `Reserva` —no
 * en `ListaEspera`, por todo lo de arriba— escrita como compare-and-set. Eso
 * sirve a los DOS processors con el mismo mecanismo, que era lo que se queria
 * conseguir dandole a este una columna propia. Esta pendiente por Docker caido:
 * una migracion que no se puede aplicar ni validar es peor que esta marca, que
 * funciona para lo que tiene que cubrir.
 */
type JobDeCupo = Job<DatosNotificacionListaEspera & { avisoMarcado?: true }>;

@Processor(NOTIFICACION_LISTA_ESPERA_QUEUE)
export class NotificacionListaEsperaProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacionListaEsperaProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensajero: MensajeroService,
  ) {
    super();
  }

  /**
   * Un job NO tiene request, asi que no hay middleware que abra el contexto de
   * tenant: `getTenantContext()` devolveria undefined y la extension de Prisma
   * lanzaria `MissingTenantContextError` en la primera query. Eso es el diseno
   * fail-closed funcionando, no un fallo.
   *
   * El `tenantId` del payload es un DATO DE SEGURIDAD: es lo unico que le dice
   * al worker sobre que gimnasio puede operar, y lo pone quien encola desde su
   * contexto ya abierto, NUNCA el cuerpo de una peticion.
   *
   * LO QUE NO ESTA EN EL PAYLOAD, y es deliberado: la configuracion SMTP. Se
   * resuelve aqui dentro —`MensajeroService` se la pide a `ConfigEmailService`,
   * que ya corre en este contexto de tenant— porque un job de BullMQ se
   * serializa a JSON y se queda en Redis hasta que caduque. Ver `colas.ts`.
   */
  async process(job: JobDeCupo): Promise<void> {
    // `entradaId` ya no identifica ninguna fila viva (ver el comentario de
    // JobDeCupo), pero sigue en el payload y se usa: es lo unico que ata este
    // aviso a la entrada de la cola de la que salio el lugar, y sin el los logs
    // de abajo no se pueden cruzar con el `ASIGNADA_DESDE_LISTA` del historial,
    // que guarda ese mismo id en `detalle.desdeListaEspera`.
    const { tenantId, perfilId, turnoId, entradaId } = job.data;

    // La marca se comprueba ANTES DE TODO: si este job ya mando su email en un
    // intento anterior, no hay nada que releer ni que decidir. Ver JobDeCupo.
    if (job.data.avisoMarcado === true) {
      this.logger.log(
        `El aviso de cupo del job ${job.id} ya salio en un intento anterior; se omite`,
      );
      return;
    }

    await runWithTenant(tenantId, async () => {
      // ---------------------------------------------------------------------
      // 1 y 2. EL PERFIL SE CONTRASTA Y EL ESTADO SE RELEE, en la misma
      // consulta y contra la RESERVA, no contra la entrada de la cola (que ya
      // no existe).
      //
      // EL CONTRASTE: `MensajeroService` manda a quien se le diga, y
      // `PushService.notificar` confia en el perfilId que recibe. La extension
      // de aislamiento NO va a atrapar un error aqui, porque filtra por
      // gimnasio y esto seria un cruce DENTRO del mismo gimnasio: dos alumnos
      // de la misma cola. Un aviso que llega a la persona equivocada no da
      // error: llega, y se lee — y este aviso ademas le dice que tiene una
      // clase que no tiene.
      //
      // LA RELECTURA: el payload es una foto del pasado. Entre encolar y
      // enviar pueden pasar minutos, y en ese rato el alumno pudo cancelar el
      // lugar que le acababan de dar. Cada termino del where exige una parte
      // del estado que justifica el aviso:
      //
      //   - `perfilId`         -> es SU lugar, no el de otro de la cola.
      //   - `origen`           -> se lo dio la cola. Una reserva que el alumno
      //                           hizo por su cuenta no justifica un
      //                           "se libero un lugar y te lo asignamos".
      //   - `canceladaEn: null`-> el lugar sigue siendo suyo AHORA.
      // ---------------------------------------------------------------------
      const reserva = await this.prisma.db.reserva.findFirst({
        where: { turnoId, perfilId, origen: 'LISTA_ESPERA', canceladaEn: null },
        orderBy: { createdAt: 'desc' },
      });

      if (!reserva) {
        // -------------------------------------------------------------------
        // "No hay reserva que avisar" tiene causas que no se parecen en nada, y
        // se separan antes de decidir el tono. Un log de error que salta por
        // causas normales se aprende a ignorar, y entonces el dia que salta por
        // el motivo de verdad no lo mira nadie.
        //
        // BENIGNA 1: la reserva existio y se cancelo entre el encolado y el
        // envio. Pasa de verdad —el alumno entra a la app, ve la clase que no
        // pidio y la suelta antes de que le llegue el correo—, y avisarle de un
        // lugar que ya solto seria mentirle.
        //
        // BENIGNA 2: el turno ya no existe. `Reserva.turno` lleva
        // `onDelete: Cascade`, asi que borrar el turno se lleva sus reservas y
        // aqui no queda ninguna. No hay nada que avisar.
        //
        // LA QUE SI ES UNA ALARMA: el turno sigue vivo y este perfil nunca tuvo
        // una reserva de lista de espera en el. O hay un bug en quien encola, o
        // alguien esta pidiendo que se avise a un tercero. Ese es el caso que la
        // regla del contraste de perfil existe para poder vigilar.
        // -------------------------------------------------------------------
        const cancelada = await this.prisma.db.reserva.findFirst({
          where: { turnoId, perfilId, origen: 'LISTA_ESPERA' },
        });

        if (cancelada) {
          this.logger.log(
            `El cupo de ${perfilId} en ${turnoId} (entrada ${entradaId}) ya no esta activo; ` +
              `se omite el aviso (job ${job.id})`,
          );
          return;
        }

        const turnoBorrado =
          (await this.prisma.db.turno.findFirst({ where: { id: turnoId } })) === null;

        if (turnoBorrado) {
          this.logger.log(
            `El turno ${turnoId} ya no existe; se omite el aviso de cupo (job ${job.id})`,
          );
          return;
        }

        // Con `entradaId`: este es el log que alguien va a ir a investigar, y es
        // el id con el que se cruza con el `ASIGNADA_DESDE_LISTA` del historial
        // (`detalle.desdeListaEspera`) para ver a quien se le dio el cupo de
        // verdad. Un log de alarma sin la clave para investigarlo es media
        // alarma.
        this.logger.error(
          `El perfil ${perfilId} no tiene ninguna reserva de lista de espera en el turno ` +
            `${turnoId}, que sigue existiendo (entrada ${entradaId}); se omite el aviso de ` +
            `cupo (job ${job.id})`,
        );
        return;
      }

      // `reserva.perfilId`, NO el `perfilId` del payload, y esto es LO QUE
      // DECIDE A QUIEN LE LLEGA EL EMAIL. De aqui salen `email` y `nombre`, asi
      // que buscar por el del payload dejaria la garantia a medias: el push
      // iria al perfil contrastado y el correo —el canal que de verdad llega a
      // una persona— al que dijo el payload. Los dos identificadores valen lo
      // mismo hoy por el where de arriba; si alguien lo afloja, que sea un
      // aviso que no sale, no un aviso que sale a otro.
      const perfil = await this.prisma.db.perfil.findFirst({
        where: { id: reserva.perfilId },
        include: { usuario: { select: { nombreCompleto: true, email: true, activo: true } } },
      });
      const turno = await this.prisma.db.turno.findFirst({ where: { id: turnoId } });
      const tenant = await this.prisma.db.tenant.findFirst({ where: { id: tenantId } });

      if (!perfil || !turno) {
        // Queda como red, no como camino esperado: llegados aqui hay una reserva
        // de este perfil en este turno, y las FK compuestas obligan a que los dos
        // existan. Lo unico que puede vaciar esto es que el borrado del turno
        // —con su cascada— caiga justo entre esta consulta y la de arriba. Sin
        // turno no hay ni clase ni fecha que poner en el texto, asi que se omite
        // en vez de mandar un email con huecos.
        this.logger.log(`Sin datos para el aviso de cupo (job ${job.id}); se omite`);
        return;
      }

      // A quien esta dado de baja no se le escribe. La baja de un usuario es
      // logica —`activo: false`, la fila se queda—, asi que su perfil y sus
      // reservas siguen ahi y todo lo de arriba pasa sin enterarse; sin esta
      // comprobacion el correo sale igual.
      if (!perfil.usuario.activo) {
        this.logger.log(
          `El usuario del perfil ${perfil.id} esta dado de baja; se omite el aviso de cupo ` +
            `(job ${job.id})`,
        );
        return;
      }

      // ---------------------------------------------------------------------
      // 3. SE MARCA ANTES DE MANDAR, y ese orden es la mitad que importa.
      //
      // Al reves —mandar y luego marcar— el reintento de un fallo ocurrido en
      // medio manda el email por segunda vez, que es justo lo que la marca viene
      // a evitar. Asi el peor caso es el contrario: si el envio falla despues de
      // marcar, el aviso SE PIERDE. Es el mismo intercambio que ya se acepto en
      // `AvisosPendientes`, en `NotificacionesService.encolar` y en el processor
      // hermano, y por el mismo motivo: perder un aviso molesta; mandar uno de
      // mas le confirma a alguien una clase que no tiene, y eso no se puede
      // desandar.
      //
      // Ojo con leer "se marca despues de avisar" en el plan de la Task 9: eso
      // se escribio pensando en la columna `notificado`, que ademas no se puede
      // usar. Con la marca en el job, despues es sencillamente el orden malo.
      //
      // Si `updateData` falla, se propaga sin haber mandado nada: el job se
      // reintenta entero y el alumno recibe su aviso una vez.
      // ---------------------------------------------------------------------
      await job.updateData({ ...job.data, avisoMarcado: true });

      await this.mensajero.avisar(
        {
          // EL DESTINATARIO ENTERO SALE DE `perfil`, y `perfil` salio de
          // `reserva.perfilId`: los tres campos vienen de la misma fila
          // contrastada, no dos de ella y uno del payload. Un destinatario
          // mezclado es peor que uno equivocado, porque manda el push a una
          // persona y el email a otra. Hay un test que lo fija con un doble
          // deliberadamente laxo.
          perfilId: perfil.id,
          email: perfil.usuario.email,
          nombre: perfil.usuario.nombreCompleto,
        },
        'LISTA_ESPERA',
        {
          alumno: perfil.usuario.nombreCompleto,
          gimnasio: tenant?.nombre ?? '',
          clase: turno.nombre,
          // LEGIBLE, no ISO: esto lo lee un alumno. `aFechaISO` daria
          // "2026-10-07" y el email diria "Se libero un lugar en Pilates del
          // 2026-10-07", que suena a sistema. `resolverMensaje` no formatea a
          // proposito —es pura y no sabe de idiomas—, asi que le toca a quien
          // arma los datos.
          fecha: fechaLegible(turno.fecha),
          hora: turno.horaInicio,
        },
        // CON EL SLUG DEL GIMNASIO DENTRO: las pantallas viven en
        // `/<slug>/calendario` y un `/calendario` pelado es un 404 cuando el
        // alumno toca la notificacion con la PWA cerrada. El motivo entero esta
        // en el mismo sitio del processor de reserva. Sin tenant no hay slug, y
        // entonces `null`: email si, push no.
        tenant ? `/${tenant.slug}/calendario` : null,
      );
    });
  }

  /**
   * Errores del Worker, no de un job concreto: Redis caido, un fallo al mover el
   * job a terminado. Sin este listener BullMQ los emite como evento `error` de
   * un EventEmitter que nadie escucha, y en Node eso es un `ERR_UNHANDLED_ERROR`
   * que puede tumbar el proceso. Se detecto en los e2e de la Fase 2; cada Worker
   * necesita el suyo, asi que esta cola tambien.
   */
  @OnWorkerEvent('error')
  alFallarElWorker(error: Error): void {
    this.logger.error(
      `Error del worker de avisos de lista de espera: ${error.message}`,
      error.stack,
    );
  }

  /** Un job fallido no debe pasar desapercibido en el log. */
  @OnWorkerEvent('failed')
  alFallarUnJob(job: Job<DatosNotificacionListaEspera> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? '(desconocido)'} de aviso de lista de espera fallido: ${error.message}`,
      error.stack,
    );
  }
}
