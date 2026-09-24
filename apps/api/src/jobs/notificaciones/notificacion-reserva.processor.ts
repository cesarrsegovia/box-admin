import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fechaLegible } from '@boxadmin/shared';
import { runWithTenant } from '../../common/tenant/tenant-context';
import { MensajeroService } from '../../comunicacion/mensajero.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NOTIFICACION_RESERVA_QUEUE, type DatosNotificacionReserva } from './colas';

/**
 * LA MARCA DE IDEMPOTENCIA. **ES PROVISIONAL: su sitio definitivo es una columna
 * de `Reserva`, y esto se cambia en cuanto se pueda migrar.** Lo primero que
 * dice este comentario es eso para que nadie lo lea como una decision cerrada.
 *
 * `NotificacionesService.encolar` pone `attempts: 3`, asi que este `process`
 * puede correr dos veces con el mismo job —por un reintento o porque el worker
 * se quedo sin lock y BullMQ lo redistribuyo—, y la segunda vuelta no puede
 * mandar el segundo email. Hace falta una marca, y hay tres sitios donde
 * ponerla:
 *
 * 1. UNA COLUMNA del modelo. ES EL DESTINO, y sigue siendolo. Aviso para quien
 *    venga de la Fase 3A buscando `ListaEspera.notificado`: esa columna existe
 *    y parece hecha para esto, pero NO SE PUEDE USAR, ni aqui ni en el
 *    processor hermano de la lista de espera. Su fila se borra en
 *    `ListaEsperaService.asignarPrimero` —dentro de la transaccion que crea la
 *    reserva, y el aviso se encola despues del commit—, asi que cuando el
 *    worker llega no hay fila que marcar y cualquier `updateMany` contra ella
 *    devuelve `count: 0`. El motivo entero, con la trampa que esconde, esta en
 *    la cabecera de `notificacion-lista-espera.processor.ts`.
 *
 *    De modo que los dos processors hermanos marcan HOY igual, en el propio
 *    job, y los dos se mudaran igual: a una columna NUEVA de `Reserva`. Se
 *    pospuso solo por no poder aplicar ni validar la migracion (Docker caido).
 *    Hablado con Cesar y anotado en el plan de la fase.
 *
 * 2. Una fila en `historial_acciones`. SE DESCARTO, y no vuelve: esa tabla es
 *    la auditoria de lo que hicieron LAS PERSONAS, y un worker no es ninguna.
 *    La fila iria con `usuarioId` nulo, y el e2e de la checklist 9 exige —con
 *    razon— que de toda entrada se sepa quien la hizo
 *    (`registros.every(r => r.usuarioId === adminId)`). Marcar ahi no solo
 *    ensucia la auditoria: rompe esa comprobacion.
 *
 * 3. EL PROPIO JOB, con `job.updateData`, que es lo que hace hoy. Persiste en
 *    Redis, en la misma clave del job, asi que la ve cualquier intento
 *    posterior del MISMO job —que es exactamente el escenario que
 *    `attempts: 3` crea— sin tocar la base ni el schema.
 *
 * LO QUE ESTA MARCA NO CUBRE, que es la otra mitad de por que se va a mover a
 * una columna. Son cuatro agujeros, y conviene tenerlos los cuatro a la vista:
 *
 * a. DOS JOBS DISTINTOS para el mismo aviso. Hoy no puede haber dos, porque
 *    `crear` rechaza la reserva duplicada con un 409 y `cancelar` rechaza la ya
 *    cancelada con otro — pero eso es un 409 que vive lejos, en otro servicio,
 *    y nadie va a recordar que sostiene esta propiedad.
 *
 * b. EL MISMO JOB EN DOS WORKERS A LA VEZ. Esto es un read-modify-write sin
 *    atomicidad: se lee `avisoMarcado`, se decide, y luego se escribe. Si el
 *    lock del job vence —una pausa larga del event loop, un GC, Redis lento—
 *    BullMQ lo redistribuye mientras el primer worker sigue vivo; los dos leen
 *    la marca ausente y los dos mandan.
 *
 *    ⚠️ QUIEN HAGA LA MIGRACION DEL PUNTO 1, QUE LEA ESTO: la columna solo
 *    cierra este agujero si se escribe como COMPARE-AND-SET sobre una fila QUE
 *    SIGA EXISTIENDO cuando el worker llega, es decir
 *    `reserva.updateMany({ where: { id, avisado: false }, data: { avisado: true } })`
 *    mirando el `count` que devuelve y mandando solo si vale 1. Un `update` a
 *    secas mueve la marca de sitio y se lleva el agujero puesto, con la
 *    apariencia de haberlo arreglado; y un CAS sobre una fila ya borrada es
 *    peor todavia, porque no deja pasar ningun aviso.
 *
 * c. LA MARCA MUERE CON EL JOB: `removeOnComplete: 100` / `removeOnFail: 500`,
 *    o cualquier limpieza de la cola, se la llevan.
 *
 * d. Un job que agote sus intentos se queda en `failed` CON LA MARCA PUESTA, asi
 *    que un retry desde un panel de Bull no manda nada y el operador no tiene
 *    forma de ver por que.
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
 * Y NO es un dato del payload en el sentido de `colas.ts`: no lo pone quien
 * encola, no se lee como identificador y no sale de `datosDeEnvio()`. Es un
 * booleano que el worker se escribe a si mismo.
 */
type JobDeAviso = Job<DatosNotificacionReserva & { avisoMarcado?: true }>;

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
    const { tenantId, perfilId, turnoId, accion } = job.data;

    // La marca se comprueba ANTES DE TODO: si este job ya mando su email en un
    // intento anterior, no hay nada que releer ni que decidir. Ver JobDeAviso.
    if (job.data.avisoMarcado === true) {
      this.logger.log(
        `El aviso ${accion} del job ${job.id} ya salio en un intento anterior; se omite`,
      );
      return;
    }

    await runWithTenant(tenantId, async () => {
      // ---------------------------------------------------------------------
      // 1. EL PERFIL DEL PAYLOAD SE CONTRASTA, NO SE CREE.
      //
      // `MensajeroService` manda a quien se le diga: `PushService.notificar`
      // recibe el perfilId y confia en el, y la extension de aislamiento NO va a
      // atrapar el error, porque filtra por gimnasio y esto seria un cruce
      // DENTRO del mismo gimnasio (dos alumnos del mismo salon). Un aviso que
      // llega a la persona equivocada no da error: llega, y se lee.
      //
      // El contraste es el `perfilId` de este where. Sin el, la consulta
      // encontraria la reserva de OTRO alumno en ese turno y el email saldria
      // igual, dirigido al del payload.
      // ---------------------------------------------------------------------
      const reservas = await this.prisma.db.reserva.findMany({
        where: { turnoId, perfilId },
        orderBy: { createdAt: 'desc' },
      });

      if (reservas.length === 0) {
        // -------------------------------------------------------------------
        // "No hay reserva" tiene DOS causas que no se parecen en nada, y por
        // eso se separan releyendo el turno antes de decidir el tono.
        //
        // La benigna la fabrica el schema: `Reserva.turno` lleva
        // `onDelete: Cascade` (schema.prisma) y un admin puede borrar un turno
        // en cuanto no le quedan reservas ACTIVAS — que es exactamente el
        // estado en que queda un turno despues de la ultima cancelacion. Si lo
        // borra entre el encolado y el envio, las canceladas se van con el y
        // aqui no queda ninguna. Es una carrera esperable: no hay nada que
        // avisar y no hay nada que investigar.
        //
        // La otra es que el turno siga vivo y aun asi este perfil no tenga
        // reserva en el. Ahi si: o hay un bug en quien encola, o alguien esta
        // pidiendo que se avise a un tercero. Ese es el unico caso que merece
        // nivel error, porque es la senial que la regla del contraste de perfil
        // existe para poder vigilar.
        //
        // Loguear los dos como error las vuelve indistinguibles, y un error que
        // salta por causas normales se aprende a ignorar: el dia que saltara por
        // el motivo de verdad, no lo miraria nadie.
        // -------------------------------------------------------------------
        const turnoBorrado =
          (await this.prisma.db.turno.findFirst({ where: { id: turnoId } })) === null;

        if (turnoBorrado) {
          this.logger.log(
            `El turno ${turnoId} ya no existe; se omite el aviso ${accion} (job ${job.id})`,
          );
          return;
        }

        this.logger.error(
          `El perfil ${perfilId} no tiene ninguna reserva en el turno ${turnoId}, ` +
            `que sigue existiendo; se omite el aviso ${accion} (job ${job.id})`,
        );
        return;
      }

      // ---------------------------------------------------------------------
      // 2. EL ESTADO SE RELEE. El payload es una foto del pasado: entre encolar
      // y procesar pueden pasar minutos, y en ese rato la reserva pudo
      // cancelarse. Que el encolado ocurra despues del commit (Task 7) cierra la
      // puerta de arriba —no hay jobs de reservas que no llegaron a existir—,
      // pero no esta.
      //
      // Cada aviso exige el estado que lo justifica: una CONFIRMACION solo vale
      // si la reserva sigue viva, y una CANCELACION solo si de verdad esta
      // cancelada (si el alumno volvio a reservar, la fila nueva no la cancelo
      // nadie y confirmarle una cancelacion seria mentirle).
      // ---------------------------------------------------------------------
      const reserva = reservas.find((fila) =>
        accion === 'CONFIRMACION' ? fila.canceladaEn === null : fila.canceladaEn !== null,
      );

      if (!reserva) {
        this.logger.log(
          `La reserva de ${perfilId} en ${turnoId} ya no esta en el estado que justifica ` +
            `un aviso ${accion}; se omite (job ${job.id})`,
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
      // 3. SE MARCA ANTES DE MANDAR, y ese orden es la mitad que importa.
      //
      // Al reves —mandar y luego marcar— el reintento de un fallo ocurrido en
      // medio manda el email por segunda vez, que es justo lo que la marca viene
      // a evitar. Asi el peor caso es el contrario: si el envio falla despues de
      // marcar, el aviso SE PIERDE. Es el mismo intercambio que ya se acepto en
      // `AvisosPendientes` y en `NotificacionesService.encolar`, y por el mismo
      // motivo: perder un aviso molesta; mandar uno de mas le confirma a alguien
      // algo que no ocurrio, y eso no se puede desandar.
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
