import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fechaLegible } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICACION_RESERVA_QUEUE, type DatosNotificacionReserva } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA VIVE EN LA BASE, en dos columnas nullable de
 * `Reserva` —`avisoConfirmacionEn` y `avisoCancelacionEn`, una por `accion`— y
 * se escribe COMO COMPARE-AND-SET. El processor hermano de la lista de espera
 * usa la tercera, `avisoCupoEn`, con el mismo mecanismo.
 *
 * POR QUE HACE FALTA UNA MARCA: `NotificacionesService.encolar` pone
 * `attempts: 3`, asi que este `process` puede correr dos veces con el mismo job
 * —por un reintento, o porque el worker se quedo sin lock y BullMQ lo
 * redistribuyo—, y la segunda vuelta no puede mandar el segundo email.
 *
 * DE DONDE VIENE ESTO. Hasta la Fase 5B la marca era un booleano en el propio
 * job (`job.updateData({ ...job.data, avisoMarcado: true })`), o sea en Redis,
 * en la clave del job; esta cabecera enumeraba entonces cuatro agujeros que eso
 * dejaba abiertos y anunciaba una columna como destino. La columna ya esta, y
 * lo que sigue dice cuales de esos cuatro se cerraron y cual no.
 *
 * Y sigue siendo verdad lo que se descarto por el camino, para que nadie lo
 * reabra:
 *
 *   - `ListaEspera.notificado` NO SIRVE, ni aqui ni en el processor hermano:
 *     su fila se borra en `ListaEsperaService.asignarPrimero` —dentro de la
 *     transaccion que crea la reserva, y el aviso se encola despues del
 *     commit—, asi que cuando el worker llega no hay fila que marcar y
 *     cualquier `updateMany` contra ella devuelve `count: 0`. Con un CAS eso no
 *     seria un duplicado de mas: seria CERO avisos, en silencio y en verde. El
 *     motivo entero esta en la cabecera de
 *     `notificacion-lista-espera.processor.ts`.
 *
 *   - `historial_acciones` TAMPOCO: esa tabla es la auditoria de lo que
 *     hicieron LAS PERSONAS, y un worker no es ninguna. La fila iria con
 *     `usuarioId` nulo y el e2e de la checklist 9 exige —con razon— que de toda
 *     entrada se sepa quien la hizo
 *     (`registros.every(r => r.usuarioId === adminId)`).
 *
 * ==========================================================================
 * LO QUE CIERRA EL AGUJERO ES EL TERMINO `null` DEL WHERE, NO LA COLUMNA.
 * ==========================================================================
 *
 *   const marcada = await this.prisma.db.reserva.updateMany({
 *     where: { id: reserva.id, avisoConfirmacionEn: null },
 *     data: { avisoConfirmacionEn: new Date() },
 *   });
 *   if (marcada.count === 0) return;   // otro ya la marco: este no manda
 *
 * Postgres resuelve ese `UPDATE ... WHERE id = ? AND "avisoConfirmacionEn" IS
 * NULL` en UNA sola operacion, con la fila bloqueada mientras dura: comprobar y
 * escribir no se pueden colar una entre otra. De dos ejecuciones simultaneas,
 * exactamente UNA se lleva el `count: 1` y manda; la otra recibe `count: 0` y
 * se calla. Y `updateMany` no se elige por gusto: `findUnique` y `upsert` estan
 * bloqueados por la extension de aislamiento, y `updateMany` es de las
 * operaciones que SI llevan el filtro de tenant inyectado.
 *
 * ⚠️ EL TERMINO `avisoConfirmacionEn: null` DEL WHERE NO ES DEFENSIVA DE MAS,
 * Y QUITARLO NO ES UNA SIMPLIFICACION. Sin el queda un `updateMany` que marca
 * SIEMPRE y devuelve SIEMPRE `count: 1`: la columna se escribe, la fecha queda
 * puesta, el codigo aparenta exactamente lo mismo y el comentario sigue
 * diciendo "compare-and-set" — pero la comprobacion ya no existe y el agujero
 * vuelve entero. Lo mismo vale para mandar aunque `count === 0`, que es la otra
 * forma de tirar la comprobacion a la basura. Por eso hay un test de DOS
 * EJECUCIONES SIMULTANEAS ("dos workers con el mismo job mandan UN solo
 * email"): es el que sujeta la propiedad que el CAS existe para dar, y el unico
 * que no depende de que el estado final "parezca" correcto.
 *
 * ⚠️ Y EL TERMINO `id: reserva.id` TAMPOCO ES DEFENSIVA DE MAS. Es el otro
 * termino del mismo where, y quitarlo no rompe nada visible: el `updateMany`
 * sigue devolviendo `count: 1`, el aviso sigue saliendo, la columna sigue
 * escribiendose. Lo que cambia es CUANTAS filas escribe —con el `tenantId` que
 * inyecta la extension, TODAS las reservas del gimnasio que tengan esa columna
 * en null—, y el resultado es estrictamente peor que el agujero que este CAS
 * viene a cerrar: el primer aviso que saliera marcaria la tabla entera y no
 * volveria a salir ninguno mas, en silencio. La cardinalidad la sujeta un test
 * hermano del de concurrencia ("marcar una reserva no marca las demas del
 * gimnasio"), porque ningun test de una sola reserva la puede ver.
 *
 * ⚠️ LA COLUMNA TIENE QUE SER LA DE LA `accion`. Marcar la cancelacion en
 * `avisoConfirmacionEn` no lanza ni cambia la forma de nada: simplemente, a
 * cualquier reserva que ya recibio su confirmacion —o sea, a todas— el CAS de
 * la cancelacion le devuelve `count: 0`, y el alumno no se entera de que le
 * cancelaron la clase. Hay un test para eso tambien.
 *
 * LOS CUATRO AGUJEROS DE LA MARCA EN REDIS, Y EN QUE QUEDARON:
 *
 * a. DOS JOBS DISTINTOS para el mismo aviso. CERRADO. La marca ya no cuelga del
 *    job sino de la reserva, asi que dos jobs distintos del mismo aviso compiten
 *    por el mismo CAS y solo uno pasa. Antes esto dependia de un 409 lejano
 *    —`crear` rechaza la reserva duplicada, `cancelar` la ya cancelada— que
 *    vive en otro servicio y que nadie iba a recordar que sostenia esta
 *    propiedad.
 *
 *    PERO SOLO PORQUE EL JOB NOMBRA LA FILA. Mover la marca a una columna
 *    cambia la pregunta: la marca identifica UNA FILA, y el job identificaba
 *    (perfil, turno, accion). `Reserva` no tiene unique sobre
 *    `(tenantId, turnoId, perfilId)` —y este processor lo daba por hecho: antes
 *    leia varias filas y ELEGIA una por su estado—, asi que dos avisos
 *    legitimos del mismo alumno en el mismo turno podian caer sobre la misma
 *    fila: el alumno cancela A, vuelve a reservar B y cancela B; si el job de A
 *    llega tarde, marca la fila de B y manda, y el job de B se encuentra con
 *    `count: 0` y se calla. DOS cancelaciones de verdad, UN solo email.
 *
 *    Por eso el payload lleva `reservaId` (ver `colas.ts`) y este processor
 *    VERIFICA la fila que el job nombra en vez de reconstruirla. La relectura
 *    del estado no se va: sigue haciendo falta comprobar que esa fila existe,
 *    es de ese perfil y esta en el estado que justifica el aviso. Lo que ya no
 *    se hace es elegirla.
 *
 * b. EL MISMO JOB EN DOS WORKERS A LA VEZ. CERRADO, y es el que motivo todo
 *    esto. `job.updateData` era un read-modify-write sin atomicidad: se leia la
 *    marca, se decidia, y luego se escribia. Si el lock del job vencia —una
 *    pausa larga del event loop, un GC, Redis lento— BullMQ lo redistribuia
 *    mientras el primer worker seguia vivo, los dos leian la marca ausente y
 *    los dos mandaban. El CAS lo cierra porque comprobar y escribir son la
 *    misma operacion.
 *
 * c. LA MARCA MUERE CON EL JOB (`removeOnComplete: 100` / `removeOnFail: 500`,
 *    o cualquier limpieza de la cola). CERRADO: la fecha esta en la fila de la
 *    reserva y dura lo que dure la reserva.
 *
 * d. Un job que agote sus intentos se queda en `failed` CON LA MARCA PUESTA,
 *    asi que un retry desde un panel de Bull no manda nada. SIGUE ABIERTO, y a
 *    proposito: cerrarlo seria borrar la marca al fallar, y entonces un fallo
 *    posterior al envio volveria a mandar el email —justo lo que la marca viene
 *    a evitar—. Lo que si mejora es el diagnostico: antes el operador no tenia
 *    forma de ver por que no salia nada; ahora la fila de la reserva dice la
 *    fecha exacta en que se intento.
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
 * Lo que el job NO lleva, y no debe volver a llevar, es ninguna marca: su
 * payload son identificadores y nada mas (ver `colas.ts`).
 *
 * LA VENTANA DEL DESPLIEGUE, que solo existe una vez y conviene no descubrirla
 * en caliente: los jobs que ya estuvieran en Redis al desplegar esto llevan el
 * viejo `avisoMarcado: true`, el codigo nuevo lo ignora y su columna esta en
 * `null`. Con `removeOnFail: 500` guardando fallidos, un retry manual de uno de
 * esos —desde un panel de Bull— manda un segundo email. Se agota sola en
 * cuanto la cola rota; si el despliegue coincide con una tanda grande, vaciar
 * los fallidos viejos antes de reintentar nada.
 */
type JobDeAviso = Job<DatosNotificacionReserva>;

@Processor(NOTIFICACION_RESERVA_QUEUE)
export class NotificacionReservaProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificacionReservaProcessor.name);

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
   * fail-closed funcionando, no un fallo. Mismo patron que el processor de
   * generacion de mes desde la Fase 2.
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
  async process(job: JobDeAviso): Promise<void> {
    const { tenantId, reservaId, perfilId, turnoId, accion } = job.data;

    await runWithTenant(tenantId, async () => {
      // ---------------------------------------------------------------------
      // 1 y 2. LA FILA QUE EL JOB NOMBRA SE VERIFICA; NO SE ELIGE NINGUNA.
      //
      // Cada termino de este where exige una cosa distinta, y ninguno sobra:
      //
      //   - `id`       -> ES ESTE AVISO Y NO OTRO. El payload trae `reservaId`
      //                   justamente para esto (ver `colas.ts`). Sin el habria
      //                   que buscar "la reserva de este perfil en este turno",
      //                   y esa frase no identifica una fila: no hay unique
      //                   sobre `(tenantId, turnoId, perfilId)` y un alumno
      //                   puede reservar, cancelar y volver a reservar. Dos
      //                   avisos legitimos acabarian sobre la misma fila y uno
      //                   de los dos se perderia en silencio. Esta en JobDeAviso.
      //
      //   - `perfilId` -> EL CONTRASTE DE PERFIL, que es de seguridad.
      //                   `MensajeroService` manda a quien se le diga y
      //                   `PushService.notificar` confia en el perfilId que
      //                   recibe; la extension de aislamiento NO va a atrapar el
      //                   error, porque filtra por gimnasio y esto seria un cruce
      //                   DENTRO del mismo gimnasio (dos alumnos del mismo
      //                   salon). Un aviso que llega a la persona equivocada no
      //                   da error: llega, y se lee.
      //
      //   - `turnoId`  -> la fila es de la clase que el aviso va a nombrar.
      //
      // EL ESTADO SE RELEE APARTE, mas abajo: el payload es una foto del pasado
      // y entre encolar y procesar pueden pasar minutos. Va despues y no aqui
      // porque "la fila no existe" y "la fila ya no justifica el aviso" son dos
      // cosas distintas que se loguean distinto.
      // ---------------------------------------------------------------------
      const reserva = await this.prisma.db.reserva.findFirst({
        where: { id: reservaId, turnoId, perfilId },
      });

      if (!reserva) {
        // -------------------------------------------------------------------
        // "No aparece la fila" tiene causas que no se parecen en nada, y por eso
        // se separan antes de decidir el tono. Loguearlas todas como error las
        // vuelve indistinguibles, y un error que salta por causas normales se
        // aprende a ignorar: el dia que saltara por el motivo de verdad, no lo
        // miraria nadie.
        //
        // BENIGNA: el turno ya no existe. `Reserva.turno` lleva
        // `onDelete: Cascade` (schema.prisma) y un admin puede borrar un turno
        // en cuanto no le quedan reservas ACTIVAS —que es justo el estado en que
        // queda despues de la ultima cancelacion—. Si lo borra entre el
        // encolado y el envio, las reservas se van con el. Es una carrera
        // esperable: no hay nada que avisar y no hay nada que investigar.
        // -------------------------------------------------------------------
        const turnoBorrado =
          (await this.prisma.db.turno.findFirst({ where: { id: turnoId } })) === null;

        if (turnoBorrado) {
          this.logger.log(
            `El turno ${turnoId} ya no existe; se omite el aviso ${accion} (job ${job.id})`,
          );
          return;
        }

        // -------------------------------------------------------------------
        // LA ALARMA: la fila existe, pero es de OTRO alumno. O hay un bug en
        // quien encola, o alguien esta pidiendo que se avise a un tercero. Ese
        // es el unico caso que merece nivel error, porque es la senial que el
        // contraste de perfil existe para poder vigilar.
        //
        // Se comprueba con una consulta APARTE y por id solo: el contraste
        // sigue viviendo en el where de arriba —que es lo que impide mandar—, y
        // esto es nada mas el diagnostico de por que no se mando. Va en el
        // camino triste, asi que la consulta de mas no la paga nadie.
        // -------------------------------------------------------------------
        const deOtro = await this.prisma.db.reserva.findFirst({ where: { id: reservaId } });

        if (deOtro && deOtro.perfilId !== perfilId) {
          this.logger.error(
            `La reserva ${reservaId} no es del perfil ${perfilId} que dice el job; se omite ` +
              `el aviso ${accion} (job ${job.id})`,
          );
          return;
        }

        // Resto: la fila nombrada ya no esta y el turno sigue vivo. Como las
        // reservas no se borran (la cancelacion es logica) esto no deberia
        // pasar, pero si pasa no hay nada que avisar y tampoco nada que
        // suplantar, asi que queda en log y no en alarma.
        this.logger.log(
          `La reserva ${reservaId} ya no esta; se omite el aviso ${accion} (job ${job.id})`,
        );
        return;
      }

      // ---------------------------------------------------------------------
      // 2. EL ESTADO SE RELEE. Entre encolar y procesar pueden pasar minutos, y
      // en ese rato la reserva pudo cancelarse. Que el encolado ocurra despues
      // del commit (Task 7) cierra la puerta de arriba —no hay jobs de reservas
      // que no llegaron a existir—, pero no esta.
      //
      // Cada aviso exige el estado que lo justifica: una CONFIRMACION solo vale
      // si la reserva sigue viva, y una CANCELACION solo si de verdad esta
      // cancelada (confirmarle una cancelacion a quien la tiene viva seria
      // mentirle).
      // ---------------------------------------------------------------------
      const enSuEstado =
        accion === 'CONFIRMACION' ? reserva.canceladaEn === null : reserva.canceladaEn !== null;

      if (!enSuEstado) {
        this.logger.log(
          `La reserva ${reservaId} ya no esta en el estado que justifica un aviso ${accion}; ` +
            `se omite (job ${job.id})`,
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
        // —con su cascada— caiga justo entre esta consulta y la de arriba.
        // Sin turno no hay ni clase ni fecha que poner en el texto, asi que se
        // omite en vez de mandar un email con huecos.
        this.logger.log(`Sin datos para el aviso ${accion} (job ${job.id}); se omite`);
        return;
      }

      // A quien esta dado de baja no se le escribe. La baja de un usuario es
      // logica —`activo: false`, la fila se queda—, asi que su perfil y sus
      // reservas siguen ahi y todo lo de arriba pasa sin enterarse; sin esta
      // comprobacion el correo sale igual. Es la misma condicion que filtran los
      // jobs diarios de la Task 10 (`usuario: { activo: true }` en su where),
      // puesta aqui donde el destinatario viene dado y no se elige con un where.
      if (!perfil.usuario.activo) {
        this.logger.log(
          `El usuario del perfil ${perfil.id} esta dado de baja; se omite el aviso ` +
            `${accion} (job ${job.id})`,
        );
        return;
      }

      // ---------------------------------------------------------------------
      // 3. EL COMPARE-AND-SET, que es el gate de este processor. Ver JobDeAviso
      // para por que es un `updateMany` con un termino `null` dentro del where
      // y no un `update` a secas.
      //
      // AQUI SE DECIDEN DOS COSAS, Y LAS DOS IMPORTAN:
      //
      // LA ATOMICIDAD la pone el `...En: null` del where. Comprobar "todavia no
      // se aviso" y escribir "ya se aviso" son un unico UPDATE de Postgres, asi
      // que entre las dos mitades no se puede colar otro worker. De dos
      // ejecuciones simultaneas del mismo aviso, una recibe `count: 1` y manda;
      // la otra recibe `count: 0` y se calla. Sin ese termino, el `updateMany`
      // marca siempre, devuelve siempre 1, y los dos mandan.
      //
      // EL ORDEN —marcar ANTES de mandar— es la otra mitad. Al reves, el
      // reintento de un fallo ocurrido en medio manda el email por segunda vez,
      // que es justo lo que esto viene a evitar. Asi el peor caso es el
      // contrario: si el envio falla despues de marcar, el aviso SE PIERDE. Es
      // el mismo intercambio que ya se acepto en `AvisosPendientes` y en
      // `NotificacionesService.encolar`, y por el mismo motivo: perder un aviso
      // molesta; mandar uno de mas le confirma a alguien algo que no ocurrio, y
      // eso no se puede desandar.
      //
      // Si el `updateMany` falla, se propaga sin haber mandado nada: el job se
      // reintenta entero y el alumno recibe su aviso una vez.
      //
      // LAS DOS RAMAS ESTAN ESCRITAS ENTERAS, una por `accion`, en vez de
      // calcular el nombre de la columna: con una clave computada, el where y
      // el data pierden los tipos de Prisma y confundir una columna con la otra
      // deja de ser un error de compilacion para pasar a ser un aviso que no
      // sale. Asi son dos literales que se leen de un vistazo.
      // ---------------------------------------------------------------------
      const ahora = new Date();
      const marcada =
        accion === 'CONFIRMACION'
          ? await this.prisma.db.reserva.updateMany({
              where: { id: reserva.id, avisoConfirmacionEn: null },
              data: { avisoConfirmacionEn: ahora },
            })
          : await this.prisma.db.reserva.updateMany({
              where: { id: reserva.id, avisoCancelacionEn: null },
              data: { avisoCancelacionEn: ahora },
            });

      if (marcada.count === 0) {
        // Ni error ni rareza: es el gate haciendo su trabajo. O este job ya
        // mando su aviso en un intento anterior, o otro worker se lo acaba de
        // llevar. En los dos casos el aviso ya se intento una vez.
        this.logger.log(
          `El aviso ${accion} de la reserva ${reserva.id} ya estaba marcado; se omite ` +
            `(job ${job.id})`,
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
        accion,
        {
          alumno: perfil.usuario.nombreCompleto,
          gimnasio: tenant?.nombre ?? '',
          clase: turno.nombre,
          // LEGIBLE, no ISO: esto lo lee un alumno. `aFechaISO` daria
          // "2026-09-07" y el email diria "Te reservamos Pilates el 2026-09-07",
          // que suena a sistema. `resolverMensaje` no formatea a proposito —es
          // pura y no sabe de idiomas—, asi que le toca a quien arma los datos.
          fecha: fechaLegible(turno.fecha),
          hora: turno.horaInicio,
        },
        // CON EL SLUG DEL GIMNASIO DENTRO. Las pantallas de la PWA viven en
        // `/<slug>/calendario`: un `/calendario` pelado es un 404 en cuanto el
        // alumno toca la notificacion con la aplicacion cerrada, que es el caso
        // normal. Adivinar el slug en el cliente —mirando una ventana ya
        // abierta— funciona en desarrollo, donde siempre hay una pestana, y
        // falla justo cuando hace falta; peor, a un socio de dos gimnasios puede
        // abrirle el que no es. El destino viaja entero desde aqui.
        //
        // Si no hay tenant no hay slug, y sin slug la ruta estaria rota: se
        // manda `null`, que `MensajeroService` traduce en "email si, push no".
        // Una notificacion que lleva a un 404 es peor que ninguna.
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
    this.logger.error(`Error del worker de avisos de reserva: ${error.message}`, error.stack);
  }

  /** Un job fallido no debe pasar desapercibido en el log. */
  @OnWorkerEvent('failed')
  alFallarUnJob(job: Job<DatosNotificacionReserva> | undefined, error: Error): void {
    this.logger.error(
      `Job ${job?.id ?? '(desconocido)'} de aviso de reserva fallido: ${error.message}`,
      error.stack,
    );
  }
}
