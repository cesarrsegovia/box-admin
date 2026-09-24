import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { RECORDATORIO_PAGO_QUEUE, VENCIMIENTO_PACK_QUEUE } from './colas';

/**
 * Todos los dias a las 9:00 **EN LA ZONA HORARIA DEL WORKER**, que no es la del
 * gimnasio ni la de nadie en particular. Leerlo como "las nueve de la manana" es
 * el error facil, y hoy es un error de verdad:
 *
 * - Un cron de BullMQ sin `tz` se interpreta en la zona del proceso que corre el
 *   worker. Este proyecto trabaja las fechas en UTC de punta a punta (ver
 *   `fechas.ts` en `@boxadmin/shared`) y los contenedores no traen zona, asi que
 *   en produccion esto es 09:00 UTC.
 * - 09:00 UTC son **las 6 de la manana en Argentina**. Es decir: tal como esta,
 *   el recordatorio de pago le llega al alumno de madrugada.
 * - Y la otra mitad, que no es la hora del correo sino QUE DIA SE CALCULA: si el
 *   contenedor NO corre en UTC, el cron dispara a las 09:00 LOCALES mientras
 *   `comienzoDeHoyUtc` —que es quien define la ventana de vencimiento— sigue
 *   razonando en UTC. Con un huso bastante adelantado (09:00 en Tokio son las
 *   00:00 UTC del mismo dia; mas al este, del dia siguiente) las dos nociones de
 *   "hoy" dejan de coincidir y la ventana se corre un dia.
 *
 * NO SE ARREGLA AQUI A PROPOSITO: que hora y en que zona salen estos correos es
 * una decision de producto, no de este archivo, y esta preguntada. Cuando se
 * decida, el sitio es el segundo argumento de `upsertJobScheduler`:
 * `{ pattern: PATRON_DIARIO, tz: '<Zona/Ciudad>' }`. Mientras tanto queda
 * escrito para que nadie de por hecho lo que no es.
 */
const PATRON_DIARIO = '0 9 * * *';

/**
 * EN UNA COLA DIARIA, EL NUMERO SON DIAS: 30 corridas completadas es un mes de
 * historial y 90 fallidas, un trimestre. No se copian el `removeOnComplete: 100`
 * / `removeOnFail: 500` de `NotificacionesService.encolar` porque alli cuentan
 * avisos —cientos por dia— y aqui contarian anios: un `removeOnFail: 500` sobre
 * dos jobs al dia no poda nunca, que es lo mismo que no ponerlo.
 *
 * Sin tope la clave de Redis crece dos entradas por dia. Eso no molesta a nadie
 * durante un anio y molesta despues, cuando ya nadie recuerda por que.
 */
const CORRIDAS_QUE_SE_GUARDAN = 30;
const CORRIDAS_FALLIDAS_QUE_SE_GUARDAN = 90;

/**
 * LOS DOS JOBS DIARIOS SON LOS UNICOS QUE MANDAN CORREO MASIVO, y este archivo
 * es el que decide cuantas veces lo mandan. Se encolan con `attempts: 1`, y ese
 * 1 esta ESCRITO A PROPOSITO aunque sea el valor por defecto de BullMQ: ver
 * `registrar()`.
 *
 * ⚠️ PERO `attempts: 1` NO GARANTIZA UNA SOLA EJECUCION, y creerlo es el error
 * que estos dos jobs no pueden permitirse. El camino de job ATASCADO (stalled)
 * de BullMQ re-encola sin mirar `attempts` siquiera, y con un repetible ni
 * siquiera tiene tope. La defensa de verdad es la marca por gimnasio que llevan
 * los dos processors; el detalle, con el archivo y la linea, esta en la cabecera
 * de `recordatorio-pago.processor.ts`.
 */
@Injectable()
export class RegistroDeCrones implements OnModuleInit {
  private readonly logger = new Logger(RegistroDeCrones.name);

  constructor(
    private readonly config: ConfigService,
    @InjectQueue(RECORDATORIO_PAGO_QUEUE) private readonly recordatorio: Queue,
    @InjectQueue(VENCIMIENTO_PACK_QUEUE) private readonly vencimiento: Queue,
  ) {}

  /**
   * Registra los jobs repetitivos al arrancar, y SOLO si JOBS_RECURRENTES=1.
   *
   * La bandera no es opcional ni cosmetica:
   *
   * - Sin ella, cada `jest` que levanta la aplicacion —y son muchos— registraria
   *   un cron diario en el Redis COMPARTIDO. No falla nada al hacerlo, no sale
   *   ningun error: el cron se queda vivo ahi, y eso no se nota hasta que la
   *   maquina lleva dias encendida y empiezan a salir correos de verdad desde
   *   una corrida de tests de hace una semana.
   * - Con dos instancias de API, las dos lo registrarian. El identificador fijo
   *   del planificador hace que la segunda actualice la primera en vez de crear
   *   otra, pero apagarlo donde no hace falta es mas barato que confiar en eso.
   *
   * En produccion se enciende en UNA instancia, o en todas: con el identificador
   * fijo da igual, pero encenderlo en una sola deja mas claro quien manda.
   */
  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('JOBS_RECURRENTES') !== '1') {
      this.logger.log('JOBS_RECURRENTES no esta en 1: no se registran los jobs diarios.');
      return;
    }

    await this.registrar(this.recordatorio, 'recordatorio-pago-diario');
    await this.registrar(this.vencimiento, 'vencimiento-pack-diario');
    this.logger.log(`Jobs diarios registrados con el patron ${PATRON_DIARIO}`);
  }

  /**
   * `upsertJobScheduler` Y NO `add(..., { repeat })`, y esto NO es una
   * preferencia de estilo: es lo unico que hace que cambiar la hora del cron
   * REEMPLACE el cron en vez de anadir otro.
   *
   * `add` con `repeat` es la API vieja, y guarda el repetible bajo una clave que
   * se arma —`getRepeatConcatOptions`, en `bullmq/dist/cjs/classes/repeat.js`—
   * como `nombre:jobId:endDate:tz:patron`. **El patron y la `tz` son parte de la
   * clave**, y un `add` solo hace upsert de SU clave. Consecuencia: el dia que
   * alguien cambie la hora —o anada el `tz` que la cabecera de `PATRON_DIARIO`
   * recomienda anadir— nace un repetible nuevo Y EL VIEJO SIGUE DISPARANDO. Dos
   * tandas de correo masivo al dia, para siempre, sin un solo sintoma en el
   * codigo ni en el log: los dos crones son validos y los dos hacen su trabajo.
   *
   * `upsertJobScheduler` esta cifrado SOLO por su `jobSchedulerId`, que es el
   * primer argumento, asi que cambiar patron o zona actualiza el planificador en
   * su sitio. Existe exactamente para esto.
   *
   * Sobre ese identificador fijo, y para no prometer de mas: NO es "lo unico que
   * impide que dos instancias registren dos crones" —sin el, la clave saldria
   * igual en las dos instancias y deduplicarian igual—, sino la IDENTIDAD del
   * planificador: es lo que hace que un segundo registro, con los parametros que
   * sean, actualice este y no cree otro. Tampoco es el id de cada ejecucion:
   * `createNextJob` le pone a cada iteracion `repeat:<hash>:<millis>`.
   */
  private async registrar(cola: Queue, planificador: string): Promise<void> {
    await cola.upsertJobScheduler(
      planificador,
      { pattern: PATRON_DIARIO },
      {
        name: 'diario',
        // Un job diario no tiene gimnasio —los recorre todos— y su reloj es el
        // del worker. Una fecha aqui se congelaria para siempre en Redis.
        data: {},
        opts: {
          // -----------------------------------------------------------------
          // `attempts: 1`, EXPLICITO, Y NO SE UNIFICA CON EL `attempts: 3` DE
          // `NotificacionesService.encolar`.
          //
          // Hoy BullMQ ya usa 1 cuando no se dice nada, asi que esta linea no
          // cambia el comportamiento: lo que cambia es que deja de ser una
          // omision y pasa a ser una decision. Sin ella, cualquiera que vea el
          // 3 de al lado va a "unificar esto por coherencia" — y ahi el 3
          // convierte un fallo a mitad de tanda en TRES TANDAS DE CORREO a los
          // mismos alumnos, porque estos dos jobs no mandan un aviso, mandan
          // cientos.
          //
          // Y no hace falta reintentar: un recordatorio diario que falla hoy se
          // manda manana igual, porque la condicion que lo dispara —seguir sin
          // pagar, seguir cerca del vencimiento— sigue ahi. Reintentar una
          // tanda a medias no recupera los avisos que no salieron y duplica los
          // que si.
          //
          // LO QUE ESTE 1 NO COMPRA: que el `process` corra una sola vez. El
          // camino de job atascado lo re-encola sin mirar `attempts`. Ver la
          // cabecera de esta clase y la del processor.
          // -----------------------------------------------------------------
          attempts: 1,
          // Que la cola no crezca sin limite con corridas ya hechas. Ver las
          // dos constantes: en una cola diaria el numero son dias.
          removeOnComplete: CORRIDAS_QUE_SE_GUARDAN,
          removeOnFail: CORRIDAS_FALLIDAS_QUE_SE_GUARDAN,
        },
      },
    );
  }
}
