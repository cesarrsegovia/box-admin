import Redis from 'ioredis';
import { CacheRedis } from './cache-redis';

// El adaptador real de ioredis, doblado entero. Lo que se prueba aqui no es
// Redis: es QUE OPCIONES se le pasan, que es donde vive el unico invariante de
// este archivo y lo unico que un refactor puede romper en silencio.
jest.mock('ioredis', () => {
  // Devuelve un objeto, asi que `new` se queda con el: `mock.results[n].value`
  // es la instancia que el adaptador esta usando. `mock.instances` no sirve
  // aqui, porque con una implementacion que devuelve objeto el `this` del
  // constructor se descarta.
  const constructor = jest.fn(() => ({
    on: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    disconnect: jest.fn(),
  }));

  // Los dos nombres: ioredis publica la clase como default y como `Redis`.
  return { __esModule: true, default: constructor, Redis: constructor };
});

const RedisFalso = Redis as unknown as jest.Mock;

interface InstanciaFalsa {
  on: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  incr: jest.Mock;
  expire: jest.Mock;
  disconnect: jest.Mock;
}

/** Lo que `config.getOrThrow('REDIS_URL')` devuelve. */
const configFalso = { getOrThrow: jest.fn().mockReturnValue('redis://localhost:6379') } as never;

interface OpcionesDeRedis {
  maxRetriesPerRequest?: number | null;
}

function construir(): {
  adaptador: CacheRedis;
  opciones: OpcionesDeRedis;
  instancia: InstanciaFalsa;
} {
  const adaptador = new CacheRedis(configFalso);

  return {
    adaptador,
    opciones: RedisFalso.mock.calls[0]![1] as OpcionesDeRedis,
    instancia: RedisFalso.mock.results[0]!.value as InstanciaFalsa,
  };
}

describe('CacheRedis', () => {
  beforeEach(() => {
    RedisFalso.mockClear();
  });

  it('se conecta a la REDIS_URL del entorno, sin inventarse un default', () => {
    construir();

    expect(RedisFalso.mock.calls[0]![0]).toBe('redis://localhost:6379');
  });

  /**
   * EL TEST QUE SOSTIENE EL DISENO ENTERO DEL CACHE.
   *
   * `maxRetriesPerRequest: null` es un requisito de la conexion de BullMQ, por
   * sus comandos bloqueantes, y de ahi se copio al plan de la Fase 6A. Aqui es
   * un error grave y silencioso: con `null`, un comando contra un Redis caido
   * NO FALLA NUNCA —se queda en la cola de reintentos— y entonces el `await
   * this.cliente.get(...)` de `CacheDeStats.recordar` no resuelve ni rechaza.
   * El reporte se cuelga en vez de calcularse, que es justo lo contrario del
   * invariante "nada de esto puede romper nada": un `catch` solo sirve si
   * alguien lanza.
   *
   * Hasta este caso el `2` era un comentario con sintaxis de codigo: la
   * mutacion de devolverlo a `null` compilaba y pasaba toda la suite en verde,
   * y el fallo solo se habria visto en produccion el dia que Redis se cayera,
   * que es exactamente el dia en que el cache tenia que seguir funcionando.
   */
  it('acota los reintentos por comando: con null el reporte se colgaria en vez de calcularse', () => {
    const { opciones } = construir();

    expect(opciones.maxRetriesPerRequest).not.toBeNull();
    expect(typeof opciones.maxRetriesPerRequest).toBe('number');
    expect(Number.isFinite(opciones.maxRetriesPerRequest)).toBe(true);
    expect(opciones.maxRetriesPerRequest as number).toBeGreaterThan(0);
  });

  it('escucha los errores de conexion: sin oyente, Node tumba el proceso', () => {
    // Un evento 'error' sin listener en un EventEmitter se convierte en una
    // excepcion no capturada. Un Redis caido no puede tirar la API.
    const { adaptador, instancia } = construir();

    expect(instancia.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(adaptador).toBeInstanceOf(CacheRedis);
  });

  it('cierra la conexion al destruir el modulo', async () => {
    // Si no se cierra, la conexion sobrevive a `app.close()` y deja el proceso
    // de Jest vivo para siempre. Es el bug de BullMQ de la Fase 0, y la razon
    // de que esto sea una clase y no un `useFactory` devolviendo un `new Redis`.
    const { adaptador, instancia } = construir();

    await adaptador.onModuleDestroy();

    expect(instancia.disconnect).toHaveBeenCalled();
  });

  it('delega get, set, incr y expire tal cual, sin reescribir la clave', async () => {
    const { adaptador, instancia } = construir();
    instancia.get.mockResolvedValue('{"total":7}');

    await adaptador.get('stats:gym-1:v0:caja:2026-10');
    await adaptador.set('stats:gym-1:v0:caja:2026-10', '{"total":7}', 'EX', 300);
    await adaptador.incr('stats:gym-1:version');
    await adaptador.expire('stats:gym-1:version', 2_592_000);

    expect(instancia.get).toHaveBeenCalledWith('stats:gym-1:v0:caja:2026-10');
    expect(instancia.set).toHaveBeenCalledWith(
      'stats:gym-1:v0:caja:2026-10',
      '{"total":7}',
      'EX',
      300,
    );
    expect(instancia.incr).toHaveBeenCalledWith('stats:gym-1:version');
    // El EXPIRE va contra la MISMA clave que el INCR y con los segundos tal
    // cual. Si el adaptador le agregara un prefijo o un sufijo, el contador
    // viviria en una clave y su vencimiento en otra: la primera volveria a
    // quedar con TTL -1 y nadie lo notaria.
    expect(instancia.expire).toHaveBeenCalledWith('stats:gym-1:version', 2_592_000);
  });
});
