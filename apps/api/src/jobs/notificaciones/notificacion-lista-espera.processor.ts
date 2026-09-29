import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fechaLegible } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICACION_LISTA_ESPERA_QUEUE, type DatosNotificacionListaEspera } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA VIVE EN LA BASE, en `Reserva.avisoCupoEn`, y se
 * escribe COMO COMPARE-AND-SET. Es el mismo mecanismo que usa el processor
 * hermano (`notificacion-reserva.processor.ts`) con sus dos columnas
 * —`avisoConfirmacionEn` y `avisoCancelacionEn`— y por el mismo motivo:
 * `attempts: 3` hace que este `process` pueda correr dos veces con el mismo
 * job, y la segunda vuelta no puede mandar el segundo email.
 *
 * Son TRES columnas y no una porque una misma reserva puede generar los tres
 * avisos: el alumno entra por la lista de espera (este), se le confirma, y
 * despues cancela.
 *
 * ==========================================================================
 * POR QUE LA MARCA CUELGA DE `Reserva` Y NO DE `ListaEspera.notificado`,
 * AUNQUE ESA COLUMNA EXISTA Y PAREZCA HECHA A MEDIDA DE ESTE PROCESSOR.
 * LEER ESTO ANTES DE "ARREGLARLO".
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
 * nada. Y escrito como compare-and-set —que es la forma CORRECTA de escribir
 * esa columna— el gate que existe para evitar UN duplicado se convierte en un
 * gate que **no deja pasar NINGUN aviso**: cero emails de lista de espera, en
 * silencio y en verde. De ahi que la marca cuelgue de la reserva, que es la
 * fila que SI sigue viva cuando el worker llega.
 *
 * ==========================================================================
 * LO QUE CIERRA EL AGUJERO ES EL TERMINO `null` DEL WHERE, NO LA COLUMNA.
 * ==========================================================================
 *
 *   const marcada = await this.prisma.db.reserva.updateMany({
 *     where: { id: reserva.id, avisoCupoEn: null },
 *     data: { avisoCupoEn: new Date() },
 *   });
 *   if (marcada.count === 0) return;   // otro ya la marco: este no manda
 *
 * Postgres resuelve ese `UPDATE ... WHERE id = ? AND "avisoCupoEn" IS NULL` en
 * UNA sola operacion, con la fila bloqueada mientras dura: comprobar y escribir
 * no se pueden colar una entre otra. De dos ejecuciones simultaneas, exactamente
 * UNA se lleva el `count: 1` y manda; la otra recibe `count: 0` y se calla.
 *
 * ⚠️ EL TERMINO `avisoCupoEn: null` DEL WHERE NO ES DEFENSIVA DE MAS, Y
 * QUITARLO NO ES UNA SIMPLIFICACION. Sin el queda un `updateMany` que marca
 * SIEMPRE y devuelve SIEMPRE `count: 1`: la columna se escribe, la fecha queda
 * puesta, el codigo aparenta exactamente lo mismo y el comentario sigue
 * diciendo "compare-and-set" — pero la comprobacion ya no existe y el agujero
 * vuelve entero. Lo mismo vale para mandar aunque `count === 0`. Por eso hay un
 * test de DOS EJECUCIONES SIMULTANEAS ("dos workers con el mismo job mandan UN
 * solo email"): es el que sujeta la propiedad que el CAS existe para dar.
 *
 * ⚠️ Y EL TERMINO `id: reserva.id` TAMPOCO ES DEFENSIVA DE MAS. Es el otro
 * termino del mismo where, y quitarlo no rompe nada visible: el `updateMany`
 * sigue devolviendo `count: 1` y el aviso sigue saliendo. Lo que cambia es
 * CUANTAS filas escribe —con el `tenantId` que inyecta la extension, TODAS las
 * reservas del gimnasio con esa columna en null—, y eso es estrictamente peor
 * que el agujero que el CAS viene a cerrar: el primer aviso marcaria la tabla
 * entera y no volveria a salir ninguno, en silencio. La cardinalidad la sujeta
 * un test hermano del de concurrencia ("marcar una reserva no marca las demas
 * del gimnasio"), porque ningun test de una sola reserva la puede ver.
 *
 * DE QUE FILA HABLA EL JOB: del `reservaId` de su payload, no del par
 * `(perfilId, turnoId)`. `Reserva` no tiene unique sobre
 * `(tenantId, turnoId, perfilId)`, asi que ese par no identifica una fila y un
 * processor que la reconstruyera podria marcar la de otro aviso y callarlo. El
 * desarrollo esta en el agujero (a) de la cabecera del processor hermano. Aqui
 * el id ademas estaba a mano desde siempre: `CupoRepartido` ya lo llevaba.
 *
 * LOS CUATRO AGUJEROS QUE DEJABA LA MARCA VIEJA —un booleano en el propio job,
 * `job.updateData({ ...job.data, avisoMarcado: true })`, o sea en Redis— Y EN
 * QUE QUEDARON. Estan desarrollados en la cabecera del processor hermano; aqui
 * el resumen:
 *
 * a. DOS JOBS DISTINTOS para el mismo aviso. CERRADO: la marca cuelga de la
 *    reserva, asi que los dos compiten por el mismo CAS y solo uno pasa.
 *
 * b. EL MISMO JOB EN DOS WORKERS A LA VEZ. CERRADO, y es el que motivo todo
 *    esto: `job.updateData` era un read-modify-write SIN atomicidad, asi que si
 *    el lock del job vencia —una pausa larga del event loop, un GC, Redis
 *    lento— BullMQ lo redistribuia mientras el primer worker seguia vivo, los
 *    dos leian la marca ausente y los dos mandaban.
 *
 * c. LA MARCA MUERE CON EL JOB al limpiarse la cola. CERRADO: la fecha esta en
 *    la fila de la reserva.
 *
 * d. Un job que agote sus intentos queda en `failed` con la marca puesta, asi
 *    que un retry desde un panel de Bull no manda nada. SIGUE ABIERTO, y a
 *    proposito: borrar la marca al fallar reabriria el duplicado. Lo que si
 *    mejora es el diagnostico, porque ahora la fecha se puede mirar en la fila.
 *
 * Y DOS COSAS QUE LA MARCA NO DICE, que son el caso FRECUENTE y no el raro, y
 * que el CAS no cambia en nada:
 *
 * e. `MensajeroService.avisar` NUNCA LANZA. Si el SMTP esta caido o mal
 *    configurado, este `process` termina bien, el job se completa y la marca se
 *    queda puesta: NO HAY REINTENTO POSIBLE. Asi que "en el peor caso el aviso
 *    se pierde" es optimista — se pierde SIEMPRE que falle el envio, y el unico
 *    rastro es un `logger.warn` dentro del mensajero. Es deliberado (reintentar
 *    el job entero por un SMTP caido le mandaria el aviso tres veces a quien si
 *    lo recibio), pero la fecha de la columna NO ES UNA FECHA DE ENTREGA:
 *    significa "aqui se intento", una vez.
 *
 * f. EL EMAIL Y EL PUSH FALLAN POR SEPARADO —`avisar` los manda en dos pasos—
 *    y la marca es UNA por aviso, no una por canal. Si sale uno y el otro no, la
 *    fecha dice "hecho" para los dos y nadie reintenta el que falto. Se acepta
 *    por lo mismo de arriba; queda escrito para que no sorprenda.
 *
 * LA VENTANA DEL DESPLIEGUE, que solo existe una vez y conviene no descubrirla
 * en caliente: los jobs que ya estuvieran en Redis al desplegar esto llevan el
 * viejo `avisoMarcado: true`, el codigo nuevo lo ignora y su columna esta en
 * `null`. Con `removeOnFail: 500` guardando fallidos, un retry manual de uno de
 * esos —desde un panel de Bull— manda un segundo email. Se agota sola en cuanto
 * la cola rota; si el despliegue coincide con una tanda grande, vaciar los
 * fallidos viejos antes de reintentar nada.
 */
type JobDeCupo = Job<DatosNotificacionListaEspera>;

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
    const { tenantId, reservaId, perfilId, turnoId, entradaId } = job.data;

    await runWithTenant(tenantId, async () => {
      // ---------------------------------------------------------------------
      // 1 y 2. LA FILA QUE EL JOB NOMBRA SE VERIFICA —con su estado—, y se
      // verifica contra la RESERVA, no contra la entrada de la cola, que ya no
      // existe (ver JobDeCupo).
      //
      // Cada termino de este where exige una cosa distinta, y ninguno sobra:
      //
      //   - `id`            -> ES ESTE AVISO Y NO OTRO, y es la fila sobre la
      //                        que se hara el compare-and-set. Viene en el
      //                        payload (`reservaId`) porque `(perfilId,
      //                        turnoId)` no identifica una fila: no hay unique
      //                        sobre esa pareja. Ver JobDeCupo.
      //   - `perfilId`      -> EL CONTRASTE, y es de seguridad.
      //                        `MensajeroService` manda a quien se le diga y
      //                        `PushService.notificar` confia en el perfilId que
      //                        recibe. La extension de aislamiento NO va a
      //                        atrapar un error aqui, porque filtra por gimnasio
      //                        y esto seria un cruce DENTRO del mismo gimnasio:
      //                        dos alumnos de la misma cola. Un aviso que llega
      //                        a la persona equivocada no da error: llega, se
      //                        lee, y ademas le dice que tiene una clase que no
      //                        tiene.
      //   - `turnoId`       -> la fila es de la clase que el aviso va a nombrar.
      //   - `origen`        -> se lo dio la cola. Una reserva que el alumno hizo
      //                        por su cuenta no justifica un "se libero un lugar
      //                        y te lo asignamos".
      //   - `canceladaEn`   -> el lugar sigue siendo suyo AHORA. El payload es
      //                        una foto del pasado: entre encolar y enviar
      //                        pueden pasar minutos, y en ese rato el alumno
      //                        pudo soltar el lugar que le acababan de dar.
      // ---------------------------------------------------------------------
      const reserva = await this.prisma.db.reserva.findFirst({
        where: { id: reservaId, turnoId, perfilId, origen: 'LISTA_ESPERA', canceladaEn: null },
      });

      if (!reserva) {
        // -------------------------------------------------------------------
        // "No hay reserva que avisar" tiene causas que no se parecen en nada, y
        // se separan antes de decidir el tono. Un log de error que salta por
        // causas normales se aprende a ignorar, y entonces el dia que salta por
        // el motivo de verdad no lo mira nadie.
        //
        // BENIGNA 1: es su fila, salio de la cola, pero ya no esta activa. Pasa
        // de verdad —el alumno entra a la app, ve la clase que no pidio y la
        // suelta antes de que le llegue el correo—, y avisarle de un lugar que
        // ya solto seria mentirle.
        // -------------------------------------------------------------------
        const cancelada = await this.prisma.db.reserva.findFirst({
          where: { id: reservaId, turnoId, perfilId, origen: 'LISTA_ESPERA' },
        });

        if (cancelada) {
          this.logger.log(
            `El cupo de ${perfilId} en ${turnoId} (entrada ${entradaId}) ya no esta activo; ` +
              `se omite el aviso (job ${job.id})`,
          );
          return;
        }

        // BENIGNA 1b: es su fila, pero no es la que este aviso describe —otro
        // turno, u `origen` distinto de LISTA_ESPERA—. El texto del aviso dice
        // "se libero un lugar y TE LO ASIGNAMOS", y de una reserva que el alumno
        // hizo por su cuenta eso es falso; peor, taparia el hecho de que el cupo
        // de verdad se lo quedo otro.
        const suyaPeroNo = await this.prisma.db.reserva.findFirst({
          where: { id: reservaId, perfilId },
        });

        if (suyaPeroNo) {
          this.logger.log(
            `La reserva ${reservaId} de ${perfilId} no es el cupo que describe este aviso ` +
              `(entrada ${entradaId}); se omite (job ${job.id})`,
          );
          return;
        }

        // BENIGNA 2: el turno ya no existe. `Reserva.turno` lleva
        // `onDelete: Cascade`, asi que borrar el turno se lleva sus reservas y
        // aqui no queda ninguna. No hay nada que avisar.
        const turnoBorrado =
          (await this.prisma.db.turno.findFirst({ where: { id: turnoId } })) === null;

        if (turnoBorrado) {
          this.logger.log(
            `El turno ${turnoId} ya no existe; se omite el aviso de cupo (job ${job.id})`,
          );
          return;
        }

        // -------------------------------------------------------------------
        // LA QUE SI ES UNA ALARMA: la fila existe y es de OTRO alumno. O hay un
        // bug en quien encola, o alguien esta pidiendo que se avise a un
        // tercero. Es el caso que el contraste de perfil existe para vigilar.
        //
        // Con `entradaId`: este es el log que alguien va a ir a investigar, y es
        // el id con el que se cruza con el `ASIGNADA_DESDE_LISTA` del historial
        // (`detalle.desdeListaEspera`) para ver a quien se le dio el cupo de
        // verdad. Un log de alarma sin la clave para investigarlo es media
        // alarma.
        // -------------------------------------------------------------------
        const deOtro = await this.prisma.db.reserva.findFirst({ where: { id: reservaId } });

        if (deOtro) {
          this.logger.error(
            `La reserva ${reservaId} no es del perfil ${perfilId} que dice el job ` +
              `(turno ${turnoId}, entrada ${entradaId}); se omite el aviso de cupo ` +
              `(job ${job.id})`,
          );
          return;
        }

        // Resto: la fila nombrada ya no esta y el turno sigue vivo. Como las
        // reservas no se borran (la cancelacion es logica) esto no deberia
        // pasar, pero si pasa no hay nada que avisar ni nada que suplantar.
        this.logger.log(
          `La reserva ${reservaId} ya no esta (entrada ${entradaId}); se omite el aviso ` +
            `de cupo (job ${job.id})`,
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
      // 3. EL COMPARE-AND-SET, que es el gate de este processor. Ver JobDeCupo
      // para por que la columna es `Reserva.avisoCupoEn` y no
      // `ListaEspera.notificado`, y por que es un `updateMany` con el termino
      // `null` dentro del where y no un `update` a secas.
      //
      // AQUI SE DECIDEN DOS COSAS, Y LAS DOS IMPORTAN:
      //
      // LA ATOMICIDAD la pone el `avisoCupoEn: null` del where. Comprobar
      // "todavia no se aviso" y escribir "ya se aviso" son un unico UPDATE de
      // Postgres, asi que entre las dos mitades no se puede colar otro worker.
      // De dos ejecuciones simultaneas, una recibe `count: 1` y manda; la otra
      // recibe `count: 0` y se calla. Sin ese termino, el `updateMany` marca
      // siempre, devuelve siempre 1, y los dos mandan.
      //
      // EL ORDEN —marcar ANTES de mandar— es la otra mitad. Al reves, el
      // reintento de un fallo ocurrido en medio manda el email por segunda vez,
      // que es justo lo que esto viene a evitar. Asi el peor caso es el
      // contrario: si el envio falla despues de marcar, el aviso SE PIERDE. Es
      // el mismo intercambio que ya se acepto en `AvisosPendientes`, en
      // `NotificacionesService.encolar` y en el processor hermano, y por el
      // mismo motivo: perder un aviso molesta; mandar uno de mas le confirma a
      // alguien una clase que no tiene, y eso no se puede desandar.
      //
      // Ojo con leer "se marca despues de avisar" en el plan de la Task 9: eso
      // se escribio pensando en la columna `notificado`, que ademas no se puede
      // usar. Despues es sencillamente el orden malo.
      //
      // Si el `updateMany` falla, se propaga sin haber mandado nada: el job se
      // reintenta entero y el alumno recibe su aviso una vez.
      // ---------------------------------------------------------------------
      const marcada = await this.prisma.db.reserva.updateMany({
        where: { id: reserva.id, avisoCupoEn: null },
        data: { avisoCupoEn: new Date() },
      });

      if (marcada.count === 0) {
        // Ni error ni rareza: es el gate haciendo su trabajo. O este job ya
        // mando su aviso en un intento anterior, o otro worker se lo acaba de
        // llevar. En los dos casos el aviso ya se intento una vez.
        this.logger.log(
          `El aviso de cupo de la reserva ${reserva.id} (entrada ${entradaId}) ya estaba ` +
            `marcado; se omite (job ${job.id})`,
        );
        return;
      }

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
