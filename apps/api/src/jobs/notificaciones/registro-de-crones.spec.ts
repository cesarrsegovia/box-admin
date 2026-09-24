import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { RegistroDeCrones } from './registro-de-crones';

type Opciones = Record<string, any>;

function crearEscenario(bandera: string | undefined) {
  const recordatorio = jest.fn().mockResolvedValue(undefined);
  const vencimiento = jest.fn().mockResolvedValue(undefined);

  const config = { get: jest.fn().mockReturnValue(bandera) } as unknown as ConfigService;

  return {
    registro: new RegistroDeCrones(
      config,
      { upsertJobScheduler: recordatorio } as unknown as Queue,
      { upsertJobScheduler: vencimiento } as unknown as Queue,
    ),
    recordatorio,
    vencimiento,
  };
}

/** Las opciones del job que el planificador va a crear en cada disparo. */
function opcionesDe(upsert: jest.Mock): Opciones {
  return (upsert.mock.calls[0]?.[2] as Opciones)?.opts as Opciones;
}

describe('RegistroDeCrones', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // LA BANDERA. Sin ella, cada `jest` que levanta la aplicacion —y son muchos—
  // deja un cron diario vivo en el Redis COMPARTIDO, y eso no se nota hasta que
  // la maquina lleva dias encendida.
  // --------------------------------------------------------------------------

  it('con la bandera apagada no se registra nada', async () => {
    const { registro, recordatorio, vencimiento } = crearEscenario('0');

    await registro.onModuleInit();

    expect(recordatorio).not.toHaveBeenCalled();
    expect(vencimiento).not.toHaveBeenCalled();
  });

  it('sin la variable definida tampoco se registra nada', async () => {
    const { registro, recordatorio, vencimiento } = crearEscenario(undefined);

    await registro.onModuleInit();

    expect(recordatorio).not.toHaveBeenCalled();
    expect(vencimiento).not.toHaveBeenCalled();
  });

  it("solo el '1' exacto enciende los crones", async () => {
    // Ni 'true', ni 'si', ni '01'. La comparacion es estricta a proposito: esta
    // bandera enciende el unico camino del sistema que manda correo masivo.
    const { registro, recordatorio, vencimiento } = crearEscenario('true');

    await registro.onModuleInit();

    expect(recordatorio).not.toHaveBeenCalled();
    expect(vencimiento).not.toHaveBeenCalled();
  });

  // --------------------------------------------------------------------------
  // Con la bandera encendida.
  // --------------------------------------------------------------------------

  it('con la bandera en 1 registra los dos jobs diarios, uno en cada cola', async () => {
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    expect(recordatorio).toHaveBeenCalledTimes(1);
    expect(vencimiento).toHaveBeenCalledTimes(1);
    expect((recordatorio.mock.calls[0]?.[2] as Opciones).name).toBe('diario');
    expect((vencimiento.mock.calls[0]?.[2] as Opciones).name).toBe('diario');
  });

  it('SE REGISTRAN CON upsertJobScheduler, no con add({ repeat })', async () => {
    // No es estilo. La clave del repetible de la API vieja se arma como
    // `nombre:jobId:endDate:tz:patron` (`getRepeatConcatOptions`, en
    // `bullmq/dist/cjs/classes/repeat.js`), asi que el patron y la zona SON
    // parte de la clave: cambiar la hora —o anadir el `tz` que hay pendiente de
    // decidir— crearia un cron nuevo y dejaria el viejo disparando. Dos tandas
    // de correo masivo al dia y ni un sintoma. `upsertJobScheduler` esta
    // cifrado solo por su id, asi que actualiza en su sitio.
    //
    // Los dobles de cola NO tienen `add`: una implementacion que volviera a la
    // API vieja reventaria aqui con un TypeError en vez de pasar en verde.
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    // El patron viaja como opciones de repeticion del PLANIFICADOR (segundo
    // argumento), no dentro de las opciones del job.
    expect(recordatorio.mock.calls[0]?.[1]).toEqual({ pattern: '0 9 * * *' });
    expect(vencimiento.mock.calls[0]?.[1]).toEqual({ pattern: '0 9 * * *' });
    expect(opcionesDe(recordatorio).repeat).toBeUndefined();
    expect(opcionesDe(vencimiento).repeat).toBeUndefined();
  });

  it('cada cron lleva un jobSchedulerId FIJO, que es la identidad del planificador', async () => {
    // Lo que compra: que un segundo registro —otra instancia de la API, un
    // reinicio, un cambio de hora— ACTUALICE este planificador en vez de crear
    // otro. No es "lo unico que impide que dos instancias registren dos crones"
    // (sin el, la clave saldria igual en las dos y deduplicarian igual), y
    // tampoco es el id de cada ejecucion: a cada iteracion BullMQ le pone
    // `repeat:<hash>:<millis>`.
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    expect(recordatorio.mock.calls[0]?.[0]).toBe('recordatorio-pago-diario');
    expect(vencimiento.mock.calls[0]?.[0]).toBe('vencimiento-pack-diario');
  });

  it('las dos colas podan sus corridas viejas', async () => {
    // Sin tope, la clave de Redis crece dos entradas por dia para siempre: no
    // molesta en un anio y molesta despues, cuando nadie recuerda por que. Los
    // numeros no son los de `NotificacionesService.encolar` (100 / 500) porque
    // alli cuentan avisos y aqui cuentan DIAS: 30 corridas es un mes, 90
    // fallidas un trimestre, y un 500 sobre dos jobs al dia no podaria nunca.
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    expect(opcionesDe(recordatorio).removeOnComplete).toBe(30);
    expect(opcionesDe(recordatorio).removeOnFail).toBe(90);
    expect(opcionesDe(vencimiento).removeOnComplete).toBe(30);
    expect(opcionesDe(vencimiento).removeOnFail).toBe(90);
  });

  // --------------------------------------------------------------------------
  // `attempts: 1`, y este test es su unica defensa.
  // --------------------------------------------------------------------------

  it('LOS RECURRENTES VAN CON attempts: 1, EXPLICITO', async () => {
    // BullMQ ya usa 1 por defecto, asi que esta comprobacion no protege del
    // presente: protege del dia que alguien vea el `attempts: 3` de
    // `NotificacionesService.encolar` y "unifique esto por coherencia".
    //
    // Ahi la diferencia no es cosmetica. Esos dos jobs no mandan UN aviso:
    // recorren todos los gimnasios y mandan cientos. Un fallo a mitad de tanda
    // con `attempts: 3` son TRES TANDAS de correo. Y no hace falta reintentar:
    // un recordatorio que falla hoy se manda manana igual.
    //
    // Lo que este 1 NO compra es que el `process` corra una sola vez —el camino
    // de job atascado re-encola sin mirar `attempts`—, y por eso los processors
    // llevan ademas una marca por gimnasio.
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    expect(opcionesDe(recordatorio).attempts).toBe(1);
    expect(opcionesDe(vencimiento).attempts).toBe(1);
  });

  it('el payload de un recurrente va vacio: no lleva tenant ni nada que caduque', async () => {
    // Un job diario no tiene gimnasio —los recorre todos— y su reloj es el del
    // worker. Meter aqui una fecha la congelaria para siempre en Redis.
    const { registro, recordatorio, vencimiento } = crearEscenario('1');

    await registro.onModuleInit();

    expect((recordatorio.mock.calls[0]?.[2] as Opciones).data).toEqual({});
    expect((vencimiento.mock.calls[0]?.[2] as Opciones).data).toEqual({});
  });

  it('lee la bandera de JOBS_RECURRENTES y de ninguna otra variable', async () => {
    const { registro } = crearEscenario('1');
    const config = (registro as unknown as { config: { get: jest.Mock } }).config;

    await registro.onModuleInit();

    expect(config.get).toHaveBeenCalledWith('JOBS_RECURRENTES');
  });
});
