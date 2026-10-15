// `main.ts` importa AppModule, y AppModule arrastra la aplicacion ENTERA: cada
// servicio, cada controller, el cliente de Prisma. Compilarla cuesta ~1,4 s de
// esta suite y aqui no se usa para nada — el `NestFactory.create` de abajo esta
// sustituido, asi que AppModule nunca llega a instanciarse: es solo el valor que
// se le pasa al doble. Con el mock, ese grafo no se compila ni se carga.
//
// Lo que NO se sustituye es nada del cierre: la aplicacion que se crea mas abajo
// es una NestApplication de verdad, y los `onModuleDestroy` que corren son los
// de proveedores de verdad registrados en su contenedor.
jest.mock('./app.module', () => ({ AppModule: class AppModuleFalso {} }));

import { Injectable, OnModuleDestroy, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { bootstrap } from './main';

/**
 * EL CIERRE ORDENADO: QUE SE MIDE AQUI Y POR QUE NO ALCANZA CON `app.close()`.
 *
 * `main.ts` tenia escrito el cierre y no lo corria nunca. Los dos
 * `onModuleDestroy` del sistema —`PrismaService` (desconecta Prisma) y
 * `CacheRedis` (cierra su ioredis)— y el `onApplicationShutdown` del explorador
 * de BullMQ (que hace `worker.close()` en los seis processors, dejandoles
 * terminar el job en curso en vez de perderlo) SOLO los dispara Nest si alguien
 * le pide escuchar las senales del proceso. Nest 10 NO lo hace solo: hay que
 * llamar a `enableShutdownHooks()`, y en todo el repo no habia una sola llamada.
 *
 * ⚠️ LA TRAMPA QUE ESTE ARCHIVO EVITA, PORQUE ES LA FORMA OBVIA DE ESCRIBIR
 * ESTE TEST Y NO PUEDE FALLAR: "levantar el modulo, llamar a `app.close()` y
 * comprobar que los dos `onModuleDestroy` corrieron" PASA IGUAL SIN LA LINEA.
 * `app.close()` invoca `callDestroyHook()` el mismo, siempre; lo que
 * `enableShutdownHooks()` cambia no es lo que hace `close()`, es QUIEN LO LLAMA
 * cuando llega un SIGTERM y nadie esta mirando. Un test asi fija una premisa que
 * el codigo bajo prueba no toca: verde con el arreglo y verde sin el.
 *
 * Lo que se mide aqui es lo otro: que `bootstrap()` deja REGISTRADO un oyente de
 * SIGTERM en el proceso, y que ESE oyente —el que invocaria el kernel al parar
 * el contenedor— es el que hace correr los `onModuleDestroy`. Antes del arreglo
 * no hay oyente y no corre nada; despues lo hay y corren los dos.
 *
 * Se invoca el oyente a mano en vez de `process.emit('SIGTERM')` a proposito: la
 * senal de verdad en medio de una corrida de Jest es un disparo a los pies, y el
 * oyente que se invoca es exactamente el objeto que `process.on` guardo.
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTA SUITE TARDA ~10 s Y NO SE PUEDE BAJAR MUCHO MAS. Esta escrito
 * porque el proximo que mire los tiempos va a querer borrarla, y porque ya se
 * midio: no hay nada que arreglar aqui, el reparto es este.
 *
 * - Los cinco tests, juntos, tardan ~0,7 s. El trabajo no esta en los tests.
 * - ~5,4 s son CARGAR `@nestjs/core`. Medido con una suite de una sola linea
 *   que lo unico que hace es importarlo. Es el runtime de Nest —cientos de
 *   modulos CJS que Jest resuelve e instrumenta uno a uno— y lo paga la primera
 *   suite que lo toca. Esta es la UNICA del paquete que lo toca: todas las demas
 *   prueban clases sueltas con dobles a mano, sin contenedor de inyeccion.
 * - El resto es `@nestjs/testing`, `platform-express` y compilar este archivo.
 *
 * NO es una conexion que se intenta y se agota, ni un ioredis reintentando, ni
 * un `listen` colgado: nada de esta suite habla con la red salvo el `listen` en
 * el puerto 0, que entra dentro de esos 0,7 s.
 *
 * LO QUE SI SE QUITO, porque era coste puro y no probaba nada: el grafo de
 * AppModule, ~1,4 s (12,2 s → 9,7 s en solitario). Ver el `jest.mock` de
 * arriba.
 *
 * Y LO QUE NO SE VA A QUITAR: la aplicacion Nest de verdad. Se puede hacer esta
 * suite instantanea sustituyendo el contenedor por dobles, pero entonces lo que
 * se comprueba es que un doble llama a otro doble — y la pregunta que este
 * archivo contesta es justamente si los `onModuleDestroy` DE VERDAD se ejecutan
 * cuando llega la senal. Diez segundos por esa respuesta son baratos.
 */

/** Lo que `process.on('SIGTERM', ...)` guarda: Nest registra ahi una funcion async. */
type OyenteDeSenal = (senal: NodeJS.Signals) => void | Promise<void>;

const oyentesDeSigterm = (): OyenteDeSenal[] =>
  process.listeners('SIGTERM') as unknown as OyenteDeSenal[];

/** Doble de los dos servicios con cierre: anotan que se les llamo y en que orden. */
const cerrados: string[] = [];

@Injectable()
class PrismaFalso implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    cerrados.push('prisma');
  }
}

@Injectable()
class CacheRedisFalso implements OnModuleDestroy {
  async onModuleDestroy(): Promise<void> {
    cerrados.push('cache-redis');
  }
}

describe('bootstrap — cierre ordenado', () => {
  let app: INestApplication | undefined;
  let oyentesPrevios: OyenteDeSenal[];

  beforeEach(() => {
    cerrados.length = 0;
    oyentesPrevios = oyentesDeSigterm();

    // El `process.kill` de verdad al final del cleanup de Nest se lleva por
    // delante el proceso de Jest: es lo unico que hay que neutralizar para poder
    // mirar lo que pasa ANTES de el.
    jest.spyOn(process, 'kill').mockImplementation(() => true);

    // La app es real; lo unico que se sustituye es de que modulo se construye.
    // Asi lo que corre es `bootstrap()` tal cual, con su helmet, su pipe y su
    // (ausente o presente) `enableShutdownHooks`.
    jest.spyOn(NestFactory, 'create').mockImplementation(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          PrismaFalso,
          CacheRedisFalso,
          // `bootstrap` pide el ConfigService para el origen de CORS y el
          // puerto. Puerto 0 = el sistema elige uno libre: el `listen` es real,
          // no un mock, y aun asi no choca con nada.
          {
            provide: ConfigService,
            useValue: { get: (clave: string) => (clave === 'PORT' ? 0 : undefined) },
          },
        ],
      }).compile();

      app = moduleRef.createNestApplication();
      return app;
    });
  });

  afterEach(async () => {
    if (app) {
      await app.close();
      app = undefined;
    }
    jest.restoreAllMocks();
  });

  /** Los oyentes de SIGTERM que este bootstrap anadio, y no los que ya hubiera. */
  function oyentesNuevos(): OyenteDeSenal[] {
    return oyentesDeSigterm().filter((oyente) => !oyentesPrevios.includes(oyente));
  }

  it('deja un oyente de SIGTERM registrado en el proceso', async () => {
    expect(oyentesNuevos()).toHaveLength(0);

    await bootstrap();

    // Esto es lo que faltaba: sin `enableShutdownHooks()` el proceso no escucha
    // la senal y un SIGTERM mata la API sin pasar por ningun cierre.
    expect(oyentesNuevos()).toHaveLength(1);
  });

  it('ese oyente ejecuta los onModuleDestroy que antes no corrian nunca', async () => {
    await bootstrap();

    // ANTES: la app esta levantada y nadie cerro nada todavia.
    expect(cerrados).toEqual([]);

    const [alRecibirSigterm] = oyentesNuevos();
    await alRecibirSigterm('SIGTERM');

    // AHORA SI: los dos cierres corrieron, disparados por la senal y no por una
    // llamada explicita a `app.close()` que en produccion no hace nadie.
    expect(cerrados).toEqual(['prisma', 'cache-redis']);
  });

  it('tambien escucha SIGINT, que es el Ctrl+C de desarrollo', async () => {
    const previos = process.listenerCount('SIGINT');

    await bootstrap();

    expect(process.listenerCount('SIGINT')).toBe(previos + 1);
  });

  it('el cierre se habilita ANTES de escuchar peticiones', async () => {
    // El orden no es decorativo: entre `listen` y `enableShutdownHooks` hay una
    // ventana —corta, pero real— en la que la API ya acepta trabajo y un SIGTERM
    // todavia la mata en seco.
    const orden: string[] = [];
    let app2: INestApplication | undefined;

    jest.spyOn(NestFactory, 'create').mockImplementation(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          {
            provide: ConfigService,
            useValue: { get: (c: string) => (c === 'PORT' ? 0 : undefined) },
          },
        ],
      }).compile();

      app2 = moduleRef.createNestApplication();
      jest.spyOn(app2, 'enableShutdownHooks').mockImplementation(function (this: INestApplication) {
        orden.push('enableShutdownHooks');
        return this;
      });
      jest.spyOn(app2, 'listen').mockImplementation(async () => {
        orden.push('listen');
      });
      return app2;
    });

    await bootstrap();
    app = app2;

    expect(orden).toEqual(['enableShutdownHooks', 'listen']);
  });

  it('cerrar la aplicacion retira el oyente: no se acumulan entre arranques', async () => {
    // Habilitar los hooks registra oyentes en `process`, que es global y vive
    // mas que cualquier app. Si `close()` no los retirara, una suite que levanta
    // varias aplicaciones acabaria con el aviso de MaxListeners y, peor, con
    // oyentes de apps muertas colgados del proceso.
    await bootstrap();
    expect(oyentesNuevos()).toHaveLength(1);

    await app?.close();
    app = undefined;

    expect(oyentesNuevos()).toHaveLength(0);
  });
});
