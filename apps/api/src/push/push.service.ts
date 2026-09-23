import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { ENVIOS_PUSH, type EnviosPush, type MensajePush } from '../comunicacion/envios.interface';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { SuscribirDto } from './dto/suscribir.dto';

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENVIOS_PUSH) private readonly envios: EnviosPush,
  ) {}

  async suscribir(actor: JwtPayload, dto: SuscribirDto): Promise<void> {
    // Sin VAPID no hay push. 503 y no 400: no es que el cliente mande algo mal,
    // es que este despliegue no tiene la capacidad.
    if (!this.envios.habilitado) {
      throw new ServiceUnavailableException(
        'Este gimnasio no tiene las notificaciones push configuradas.',
      );
    }

    const perfil = await this.perfilDelActor(actor);

    // Un endpoint identifica UN NAVEGADOR, no una persona, asi que se borra
    // cualquier fila que lo tenga DENTRO DE ESTE GIMNASIO —sea de quien sea—
    // antes de crear la nueva.
    //
    // El escenario: Ana se suscribe en el navegador del gimnasio, cierra
    // sesion, entra Beto y se suscribe. Sin este borrado quedan dos filas con
    // el mismo endpoint y distinto perfilId (el @@unique es
    // (tenantId, perfilId, endpoint), asi que la base las admite), y ese
    // dispositivo recibe las notificaciones de las dos.
    //
    // Y no se arregla solo con el tiempo: la fila de Ana nunca caduca, porque
    // el endpoint SIGUE SIENDO VALIDO para ese navegador y web-push responde
    // 200. El 404/410 que dispara la limpieza de `notificar` no llega jamas.
    //
    // "Dentro de este gimnasio" es literal y es el limite de la regla: el
    // deleteMany no lleva tenantId escrito porque se lo inyecta la extension de
    // aislamiento, asi que un mismo navegador suscrito en el gimnasio A y en el
    // B conserva las dos filas y recibe los avisos de los dos. Queda abierto a
    // proposito: taparlo exigiria un runUnscoped(), que es justo lo que la
    // extension existe para impedir, y quien es socio de dos gimnasios quiere
    // los avisos de los dos. Lo que el where SI omite a proposito es el
    // perfilId, y ahi esta la gracia.
    //
    // Lo que aporta el $transaction es ATOMICIDAD ANTE FALLO: que no quede la
    // fila de Ana borrada sin la de Beto creada, porque eso deja al navegador
    // sin push y sin que nadie se entere.
    //
    // Lo que NO hace, pese a lo que sugiere envolver dos escrituras: cerrar la
    // carrera de dos suscripciones simultaneas. Con READ COMMITTED —el
    // aislamiento por defecto de Postgres— el deleteMany de la segunda
    // transaccion no ve la fila que la primera inserto y aun no commiteo, asi
    // que no la borra; y tampoco se bloquea, porque el @@unique lleva perfilId
    // y los perfilId difieren. Las dos filas commitean.
    //
    // Esa carrera se deja abierta porque es practicamente inalcanzable: exige
    // que el MISMO navegador actue como dos personas a la vez, y un navegador
    // tiene una sesion. Dos perfiles distintos, o una ventana de incognito,
    // reciben endpoints distintos y ni siquiera colisionan. Si ese supuesto
    // dejara de valer, lo que la cerraria es un @@unique([tenantId, endpoint])
    // en el schema — con el matiz de que entonces el perdedor de la carrera
    // recibe un P2002: hay que capturarlo y reintentar, no basta el indice.
    await this.prisma.db.$transaction(async (tx) => {
      await tx.suscripcionPush.deleteMany({ where: { endpoint: dto.endpoint } });

      await tx.suscripcionPush.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: perfil.id,
          endpoint: dto.endpoint,
          p256dh: dto.p256dh,
          auth: dto.auth,
        },
      });
    });
  }

  async desuscribir(actor: JwtPayload, endpoint: string | undefined): Promise<void> {
    // Presente pero vacio es una peticion malformada, no "todas". Sin este 400,
    // `?endpoint=` cae en la rama de abajo por ser falsy y borra las
    // suscripciones de todos los dispositivos del alumno. Son datos suyos, asi
    // que no es un agujero, pero es una sorpresa fea. Ausente sigue
    // significando "todas", que es lo que pide el boton "desactivar".
    if (endpoint !== undefined && endpoint.trim() === '') {
      throw new BadRequestException('El endpoint no puede venir vacio.');
    }

    const perfil = await this.perfilDelActor(actor);

    // El perfilId sale SIEMPRE de `perfilDelActor`, nunca del request: es lo
    // que impide que un alumno borre la suscripcion de otro pasando en el query
    // string un endpoint ajeno.
    await this.prisma.db.suscripcionPush.deleteMany({
      where: { perfilId: perfil.id, ...(endpoint ? { endpoint } : {}) },
    });
  }

  /**
   * Manda a todos los dispositivos de un alumno y limpia los que ya no existen.
   *
   * Nunca lanza, y lo garantiza ella misma: lo llaman los processors, y un push
   * fallido no puede tumbar el email que iba en el mismo job. No basta con que
   * el adaptador capture lo suyo —lo hace—, porque la base tambien puede fallar
   * aqui (conexion caida, timeout) y eso propagaria.
   */
  async notificar(
    cliente: ClientePrismaTx,
    perfilId: string,
    mensaje: MensajePush,
  ): Promise<number> {
    if (!this.envios.habilitado) return 0;

    let destinos;
    try {
      destinos = await cliente.suscripcionPush.findMany({ where: { perfilId } });
    } catch (error) {
      // Solo el perfilId y el motivo: ni el mensaje ni el endpoint entero
      // tienen por que quedar en los logs.
      this.logger.warn(`No se pudieron leer las suscripciones de ${perfilId}: ${String(error)}`);
      return 0;
    }

    let enviados = 0;

    for (const destino of destinos) {
      // El try va DENTRO del bucle a proposito: que falle el envio a un
      // dispositivo no puede dejar sin notificacion a los demas.
      try {
        const resultado = await this.envios.enviar(destino, mensaje);

        if (resultado === 'ENVIADO') enviados += 1;
        if (resultado === 'CADUCADA') {
          // 404 o 410: la suscripcion ya no existe en el navegador. Sin esto, la
          // tabla se llena de endpoints muertos a los que se reintenta cada dia.
          await cliente.suscripcionPush.deleteMany({ where: { id: destino.id } });
        }
      } catch (error) {
        this.logger.warn(`Fallo el push de ${perfilId}: ${String(error)}`);
      }
    }

    return enviados;
  }

  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil');

    return perfil;
  }
}
