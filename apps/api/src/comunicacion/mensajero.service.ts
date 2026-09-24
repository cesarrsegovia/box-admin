import { Inject, Injectable, Logger } from '@nestjs/common';
import type { TipoPlantilla } from '@boxadmin/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { ConfigEmailService, motivoSeguro } from './config-email.service';
import { ENVIOS_DE_EMAIL, type EnviosDeEmail } from './envios.interface';
import { resolverMensaje, type DatosDePlantilla } from './plantillas';

export interface Destinatario {
  perfilId: string;
  email: string;
  nombre: string;
}

/**
 * Junta plantilla, SMTP y envio. Lo usan los cuatro processors, que asi no
 * repiten cinco veces la misma secuencia.
 *
 * NUNCA lanza. Un processor que reviente por un SMTP mal configurado se
 * reintenta en bucle y llena la cola de trabajo muerto; peor, en el caso de la
 * lista de espera dejaria sin marcar una asignacion que si ocurrio.
 */
@Injectable()
export class MensajeroService {
  private readonly logger = new Logger(MensajeroService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigEmailService,
    private readonly push: PushService,
    @Inject(ENVIOS_DE_EMAIL) private readonly envios: EnviosDeEmail,
  ) {}

  async avisar(
    destinatario: Destinatario,
    tipo: TipoPlantilla,
    datos: DatosDePlantilla,
    /**
     * A donde lleva la notificacion, CON EL SLUG DEL GIMNASIO DENTRO
     * (`/<slug>/calendario`). Las pantallas de la PWA viven bajo el slug, asi
     * que una ruta sin el —`/calendario`— es un 404 en cuanto el alumno toca la
     * notificacion con la aplicacion cerrada, que es el caso normal.
     *
     * `null` significa QUE NO SE PUEDE COMPONER LA RUTA, y entonces no se manda
     * push: el email sale igual, porque el email no depende de ninguna ruta.
     * Ver `porPush`.
     */
    urlPush: string | null,
  ): Promise<void> {
    let mensaje: { asunto: string; html: string };

    // Esta linea tambien va bajo try, aunque no toque el SMTP. Dos caminos
    // reales la hacen lanzar, y sin el try la promesa de la clase —NUNCA
    // lanza— seria falsa justo en su primera instruccion:
    //
    // 1. `plantillaDe` va a Postgres: base caida, pool agotado.
    // 2. `resolverMensaje` RENDERIZA, y una plantilla mal formada revienta al
    //    renderizar (no al compilar: ver `motivoDePlantillaInvalida`).
    //
    // El 2 lo cubre hoy la validacion de `guardarPlantilla`, que devuelve un
    // 400 antes de escribir. Este try no sobra por eso: cubre las filas
    // guardadas ANTES de que esa validacion existiera, que siguen en la base.
    // Un processor que reviente aqui se reintenta en bucle y llena la cola de
    // trabajo muerto, que es exactamente lo que la clase promete evitar.
    try {
      mensaje = resolverMensaje(await this.config.plantillaDe(tipo), tipo, datos);
    } catch (error) {
      // Por `motivoSeguro` aunque en este camino no haya credencial a la vista:
      // el error puede venir de Prisma, y en este archivo todo lo que se loguea
      // pasa por ahi. La excepcion que se argumenta es mas barata que la
      // excepcion que se olvida.
      this.logger.warn(`No se pudo resolver la plantilla ${tipo}: ${motivoSeguro(error, '', '')}`);
      return;
    }

    await this.porEmail(destinatario, tipo, mensaje.asunto, mensaje.html);
    await this.porPush(destinatario, mensaje.asunto, urlPush);
  }

  private async porEmail(
    destinatario: Destinatario,
    tipo: TipoPlantilla,
    asunto: string,
    html: string,
  ): Promise<void> {
    // Declarado FUERA del try aunque se asigne dentro: el catch lo necesita
    // para sanear el mensaje del error, y dentro no estaria en alcance. Sigue
    // todo bajo el try, que el contrato de la clase es no lanzar nunca.
    let envio: Awaited<ReturnType<ConfigEmailService['datosDeEnvio']>> = null;

    try {
      envio = await this.config.datosDeEnvio();

      if (envio === null) {
        // Un gimnasio sin SMTP configurado no es un error: es un gimnasio que
        // todavia no quiere mandar emails.
        //
        // Se loguea el TIPO, no el asunto: el asunto ya viene renderizado y
        // lleva el nombre del alumno dentro. El tipo identifica igual de bien
        // que fue lo que no se mando, y no arrastra datos personales a un log
        // que se guarda, se rota y acaba en un agregador.
        this.logger.log(`Sin SMTP configurado; no se envia un aviso de ${tipo}`);
        return;
      }

      await this.envios.enviar(envio.smtp, {
        para: destinatario.email,
        copia: envio.copia,
        asunto,
        html,
      });
    } catch (error) {
      // Se traga el error a proposito y se deja rastro. Ver el comentario de la
      // clase. NUNCA se loguea el objeto de configuracion: lleva la clave.
      //
      // Y TAMPOCO el mensaje crudo del error. `(error as Error).message` de un
      // fallo de nodemailer es exactamente el texto del que la Task 5 saco la
      // contrasena: el EAUTH se arma como `Invalid login: <respuesta literal
      // del servidor>`, y un servidor verboso reimprime ahi el base64 de la
      // clave. Se demostro con servidores SMTP falsos, no de palabra. El 400 de
      // `guardarSmtp` ya esta protegido por `motivoSeguro`; este log seria la
      // MISMA fuga por otra puerta, y encima a un sitio que se queda escrito.
      //
      // Un log no es menos grave que una respuesta HTTP: la respuesta la ve una
      // persona y se va, el log se guarda, se rota, se envia a un agregador y
      // acaba en mas manos que la propia respuesta.
      //
      // Si el fallo fue del propio `datosDeEnvio`, `envio` sigue en null y no
      // hay credencial que pasarle: `motivoSeguro` con agujas vacias degrada a
      // la red de base64 y sigue haciendo su trabajo. Por eso los `?? ''`.
      this.logger.warn(
        `Fallo el email a ${destinatario.email}: ` +
          `${motivoSeguro(error, envio?.smtp.clave ?? '', envio?.smtp.usuario ?? '')}`,
      );
    }
  }

  /**
   * OJO CON `titulo`: es el asunto del email, y llega SIN ESCAPAR. No es un
   * descuido — escapar el asunto de un email es un error, porque lo codifica
   * nodemailer al armar la cabecera y escaparlo antes estropea nombres
   * corrientes ("Martin & Co" acabaria como "Martin &amp; Co"). Pero el mismo
   * texto se usa aqui como titulo de una notificacion del navegador, y su
   * contenido lo escribe el admin del gimnasio en la plantilla.
   *
   * Quien lo pinte en la PWA tiene que tratarlo como TEXTO, nunca como HTML.
   */
  private async porPush(
    destinatario: Destinatario,
    titulo: string,
    url: string | null,
  ): Promise<void> {
    // SIN RUTA NO HAY PUSH, y es deliberado. Un push lleva a una pantalla; si no
    // se pudo componer la ruta —hoy, que no se encontro el gimnasio del que sale
    // el slug— la notificacion llevaria a un 404. Mandar una notificacion que
    // termina en un 404 es peor que no mandarla: el alumno la toca, no ve nada,
    // y la proxima ya no la toca. El email, que no depende de ninguna ruta, sale
    // igual.
    if (url === null) {
      this.logger.warn(`Sin ruta para el push a ${destinatario.perfilId}; solo se manda el email`);
      return;
    }

    try {
      await this.push.notificar(this.prisma.db, destinatario.perfilId, {
        titulo,
        cuerpo: `Hola ${destinatario.nombre}`,
        url,
      });
    } catch (error) {
      // SI, aqui va el mensaje crudo, y es la unica linea del archivo que lo
      // hace. No contradice el bloque de veinte lineas de `porEmail`: este error
      // nace en `push.notificar`, que nunca ve un `DatosSmtp` ni nada
      // descifrado —trabaja con endpoints del navegador y con la base—, asi que
      // no hay credencial que pueda venir dentro. Queda dicho para que esta
      // linea no acabe copiada a un catch donde si la haya.
      this.logger.warn(`Fallo el push a ${destinatario.perfilId}: ${(error as Error).message}`);
    }
  }
}
