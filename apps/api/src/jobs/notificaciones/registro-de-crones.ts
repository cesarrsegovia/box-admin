import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { RECORDATORIO_PAGO_QUEUE, VENCIMIENTO_PACK_QUEUE } from './colas';

/**
 * Todos los dias a las 9:00 **EN LA ZONA DEL DESPLIEGUE**: el patron viaja con
 * el `tz` de `ZONA_HORARIA` desde la Fase 6B. Antes eran las 9:00 del proceso
 * que corre el worker, que no es la de nadie en particular —un contenedor no
 * trae zona, asi que en produccion eran las 09:00 UTC, o sea **las 6 de la
 * manana en Argentina**: el recordatorio de pago le llegaba al alumno de
 * madrugada—.
 *
 * LA DECISION YA NO ESTA PENDIENTE. Lo que la 5B dejo preguntado era "que hora
 * y en que zona"; la hora siguen siendo las nueve, y la zona es la del
 * despliegue. Lo que faltaba era que fueran las nueve DE ALGUN LADO.
 *
 * QUE ARREGLA EL `tz` Y QUE NO:
 *
 * - Arregla a que hora sale el correo, cambios de horario de verano incluidos:
 *   quien resuelve el patron es cron-parser con esa zona, no una resta fija de
 *   horas. Es la misma razon por la que `instanteEnZona` le pregunta a `Intl`.
 * - NO cambia QUE DIA SE CALCULA, y es deliberado: la ventana de vencimiento la
 *   define `comienzoDeHoyUtc`, que razona en UTC como todas las fechas del
 *   sistema. Con una zona bastante adelantada respecto de UTC las dos nociones
 *   de "hoy" podrian dejar de coincidir y la ventana se correria un dia (en
 *   Tokio, las 09:00 locales son las 00:00 UTC del mismo dia; mas al este, del
 *   dia anterior). Con UTC-3, que es lo que hay, las 09:00 locales son las
 *   12:00 UTC del MISMO dia y no hay desacuerdo posible. Queda escrito por si
 *   algun dia la zona se mueve al este.
 *
 * ANADIR ESTE `tz` FUE SEGURO GRACIAS A LA MIGRACION DE LA 5B, y no es casual:
 * con el `add(..., { repeat })` viejo la zona es parte de la clave del
 * repetible, asi que este mismo cambio habria creado un cron NUEVO dejando el
 * viejo disparando —dos tandas de correo masivo al dia, para siempre, sin un
 * solo sintoma—. `upsertJobScheduler` esta cifrado solo por su
 * `jobSchedulerId`, asi que actualiza el planificador en su sitio. El detalle
 * esta en `registrar()`.
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

    // `validarEntorno` la exige al arrancar y comprueba que `Intl` la conoce,
    // asi que aqui no puede faltar: un despliegue sin ella no levanta. Lo que
    // SI importa saber es que pasaria si alguien la sacara de las requeridas
    // —`tz: undefined` es un `tz` ausente para BullMQ, y el cron volveria en
    // silencio a la zona del worker, que es exactamente el bug de arriba—.
    const zona = this.config.get<string>('ZONA_HORARIA') as string;

    await this.registrar(this.recordatorio, 'recordatorio-pago-diario', zona);
    await this.registrar(this.vencimiento, 'vencimiento-pack-diario', zona);
    this.logger.log(`Jobs diarios registrados con el patron ${PATRON_DIARIO} en la zona ${zona}`);
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
   * alguien cambie la hora —o anada una `tz`, que es justo lo que hizo la Fase
   * 6B— nace un repetible nuevo Y EL VIEJO SIGUE DISPARANDO. Dos tandas de
   * correo masivo al dia, para siempre, sin un solo sintoma en el codigo ni en
   * el log: los dos crones son validos y los dos hacen su trabajo.
   *
   * Y NO ES UN EJEMPLO INVENTADO: el `tz` de abajo se le anadio a un cron que
   * ya existia. Alla donde este registro ya hubiera corrido, con la API vieja
   * habria nacido un segundo repetible y el primero habria seguido disparando;
   * con esta, el planificador se actualiza en su sitio. La migracion de la 5B
   * se hizo para que este cambio fuera seguro.
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
  private async registrar(cola: Queue, planificador: string, zona: string): Promise<void> {
    await cola.upsertJobScheduler(
      planificador,
      { pattern: PATRON_DIARIO, tz: zona },
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
