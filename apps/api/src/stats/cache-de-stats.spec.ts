import { Logger } from '@nestjs/common';
import { CacheDeStats, type ClienteDeCache } from './cache-de-stats';

/**
 * El doble es un `Map` DE VERDAD, y eso no es un detalle de comodidad.
 *
 * Un cliente falso que ignore la clave —que devuelva siempre lo ultimo que se
 * guardo, o siempre `null`— deja pasar en verde los dos tests que mas importan
 * aqui: el de que dos reportes no se pisan y el de que invalidar un gimnasio no
 * tira el de otro. Con un `Map` real, la clave que construye `recordar` es lo
 * unico que decide si hay acierto, que es justo lo que se quiere probar.
 */
function clienteFalso() {
  const datos = new Map<string, string>();

  const set = jest.fn(async (clave: string, valor: string) => {
    datos.set(clave, valor);
  });

  const cliente: ClienteDeCache = {
    get: async (clave) => datos.get(clave) ?? null,
    set,
    incr: async (clave) => {
      const siguiente = Number(datos.get(clave) ?? '0') + 1;
      datos.set(clave, String(siguiente));
      return siguiente;
    },
  };

  return { cliente, datos, set };
}

/** Los tres casos de "Redis caido" loguean un warn. Se silencia como en la 5B. */
function callarElLogger() {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
}

describe('CacheDeStats', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('la primera vez calcula, la segunda no', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    const segundo = await cache.recordar('gym-1', 'caja:2026-10', calcular);

    expect(calcular).toHaveBeenCalledTimes(1);
    expect(segundo).toEqual({ total: 7 });
  });

  it('despues de invalidar, vuelve a calcular', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    await cache.invalidar('gym-1');
    await cache.recordar('gym-1', 'caja:2026-10', calcular);

    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('invalidar un gimnasio NO tira el cache de otro', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);
    const calcular = jest.fn().mockResolvedValue({ total: 7 });

    await cache.recordar('gym-1', 'caja:2026-10', calcular);
    await cache.recordar('gym-2', 'caja:2026-10', calcular);
    await cache.invalidar('gym-1');
    await cache.recordar('gym-2', 'caja:2026-10', calcular);

    // Una vez cada gimnasio, y gym-2 NO recalculo.
    expect(calcular).toHaveBeenCalledTimes(2);
  });

  it('dos reportes distintos del mismo gimnasio no se pisan', async () => {
    const { cliente } = clienteFalso();
    const cache = new CacheDeStats(cliente);

    const caja = await cache.recordar('gym-1', 'caja:2026-10', async () => 'la caja');
    const operativo = await cache.recordar(
      'gym-1',
      'operativo:2026-10',
      async () => 'lo operativo',
    );

    expect(caja).toBe('la caja');
    expect(operativo).toBe('lo operativo');
  });

  /**
   * El TTL no lo cubre ningun otro caso: el doble puede ignorarlo y todo lo
   * demas sigue en verde. Y el TTL es LA RED del contador de version —el peor
   * caso de olvidarse un `invalidar` es llegar cinco minutos tarde y no quedar
   * mal para siempre—, asi que si alguien lo quita o lo pone en un dia, tiene
   * que caer algo. De paso fija la forma de la clave que documenta la spec, 8:
   * `stats:<tenant>:v<version>:<reporte>`.
   */
  it('guarda con TTL y con la clave versionada por gimnasio', async () => {
    const { cliente, set, datos } = clienteFalso();

    await new CacheDeStats(cliente).recordar('gym-1', 'caja:2026-10', async () => ({ total: 7 }));

    expect(set).toHaveBeenCalledWith('stats:gym-1:v0:caja:2026-10', '{"total":7}', 'EX', 300);
    expect([...datos.keys()]).toEqual(['stats:gym-1:v0:caja:2026-10']);
  });

  it('si el cache falla al leer, el reporte sale igual', async () => {
    callarElLogger();
    const roto: ClienteDeCache = {
      get: async () => {
        throw new Error('Redis caido');
      },
      set: async () => {},
      incr: async () => 1,
    };

    await expect(
      new CacheDeStats(roto).recordar('gym-1', 'caja', async () => ({ total: 7 })),
    ).resolves.toEqual({ total: 7 });
  });

  it('si el cache falla al escribir, el reporte sale igual', async () => {
    callarElLogger();
    const roto: ClienteDeCache = {
      get: async () => null,
      set: async () => {
        throw new Error('Redis caido');
      },
      incr: async () => 1,
    };

    await expect(new CacheDeStats(roto).recordar('gym-1', 'caja', async () => 'ok')).resolves.toBe(
      'ok',
    );
  });

  /**
   * La contracara de los dos anteriores: el cache tapa los errores DE REDIS, no
   * los del reporte. Si la consulta a Postgres falla, el panel tiene que ver un
   * error; taparlo devolveria un cuerpo vacio que parece un mes sin movimiento.
   */
  it('si el calculo falla, el error sale y no se guarda nada', async () => {
    const { cliente, datos } = clienteFalso();

    await expect(
      new CacheDeStats(cliente).recordar('gym-1', 'caja', async () => {
        throw new Error('Postgres caido');
      }),
    ).rejects.toThrow('Postgres caido');
    expect(datos.size).toBe(0);
  });

  /**
   * EL HUECO QUE ENCONTRO UNA MUTACION. Con el fallback de `version()` puesto en
   * `'0'` en vez de en un valor irrepetible, los otros ocho casos seguian en
   * verde: ninguno hacia que Redis contestara las claves de datos y fallara la
   * del contador, que es lo que pasa con un timeout de comando suelto.
   *
   * Y es el unico camino por el que este cache puede servir un numero de una
   * version que no pudo comprobar: el gimnasio va por la version siete, el
   * contador no se lee, se asume la cero, y se sirve un valor de antes del
   * ultimo pago. Es exactamente el "cargue el cobro y la caja no lo muestra"
   * que la spec, 8, dice estar resolviendo.
   */
  it('si no se puede leer la version, NO sirve un valor de la version cero', async () => {
    callarElLogger();
    const datos = new Map<string, string>([['stats:gym-1:v0:caja', '"un numero viejo"']]);
    const cliente: ClienteDeCache = {
      get: async (clave) => {
        if (clave.endsWith(':version')) throw new Error('Redis lento');
        return datos.get(clave) ?? null;
      },
      set: async (clave, valor) => {
        datos.set(clave, valor);
      },
      incr: async () => 1,
    };

    await expect(
      new CacheDeStats(cliente).recordar('gym-1', 'caja', async () => 'recalculado'),
    ).resolves.toBe('recalculado');
  });

  // ESTE ES EL QUE PROTEGE UN COBRO: `invalidar` se llama DENTRO del servicio
  // que registra un pago. Si lanzara, un Redis caido convertiria un cobro
  // perfectamente valido en un 500.
  it('invalidar NUNCA lanza, aunque Redis este caido', async () => {
    callarElLogger();
    const roto: ClienteDeCache = {
      get: async () => null,
      set: async () => {},
      incr: async () => {
        throw new Error('Redis caido');
      },
    };

    await expect(new CacheDeStats(roto).invalidar('gym-1')).resolves.toBeUndefined();
  });
});
