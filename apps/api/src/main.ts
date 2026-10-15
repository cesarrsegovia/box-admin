import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
// `helmet` publica un default export ES real (con __esModule + .default en su
// build CJS), asi que el import por defecto funciona sin esModuleInterop.
// `compression`, en cambio, tipa su modulo con `export =` (estilo CommonJS de
// @types/compression): con `import compression from 'compression'` y sin
// esModuleInterop (no esta activado en este tsconfig), tsc lanza TS1259
// ("This module can only be referenced with the 'esModuleInterop' flag").
// Se usa aqui el import de namespace, valido para modulos `export =` con
// cualquier configuracion, sin tocar la libreria ni la config de TS del resto
// del proyecto.
import * as compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Sin esto, detras de un reverse proxy TODAS las peticiones comparten la IP
  // del proxy y el throttler las cuenta como un solo cliente: o no frena a
  // nadie, o los frena a todos a la vez. Express lee X-Forwarded-For solo si se
  // le dice que confie, y solo en el primer salto (1), que es el proxy propio:
  // confiar en toda la cadena dejaria falsificar la IP con una cabecera.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // CORS, y solo si hay un frontend configurado.
  //
  // Con el BFF de la Fase 3B el navegador habla siempre con Next, mismo origen,
  // salvo en UN sitio: el PUT del comprobante va directo del navegador al
  // almacen, que es exactamente para lo que existen las URLs firmadas. En
  // desarrollo ese almacen es esta misma API en otro puerto, asi que sin CORS
  // el navegador bloquea la subida.
  //
  // `origin` es un valor concreto y no `true`: reflejar cualquier origen
  // convertiria estas rutas en algo que cualquier pagina podria invocar.
  // `credentials` queda en false porque las rutas del almacen se autentican con
  // su firma HMAC, no con cookies — y porque con `origin` concreto y
  // credenciales activadas cualquier fallo de configuracion seria mucho mas caro.
  const config = app.get(ConfigService);
  const webOrigin = config.get<string>('WEB_ORIGIN');
  if (webOrigin) {
    app.enableCors({
      origin: webOrigin,
      methods: ['GET', 'PUT', 'OPTIONS'],
      credentials: false,
    });
  }

  app.use(helmet());
  app.use(compression());

  // El PUT del almacen local consume el cuerpo como stream. Marcar el request
  // como "ya parseado" antes de los parsers evita que alguno se lo lea primero
  // y deje el stream vacio, que se manifestaria como un archivo de 0 bytes
  // subido con exito. Solo aplica al adaptador local: en produccion el PUT va
  // directo a S3 y ni siquiera pasa por aqui.
  app.use('/archivos-locales', (req: { _body?: boolean }, _res: unknown, next: () => void) => {
    req._body = true;
    next();
  });

  // Sin este pipe los decoradores de class-validator en los DTOs (auth/dto/*)
  // no se ejecutan nunca: Nest pasaria el body crudo tal cual llega.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // EL CIERRE ORDENADO. Sin esta linea Nest NO escucha las senales del proceso,
  // y todo el cierre que hay escrito en el repo no se ejecutaba NUNCA: un
  // SIGTERM —que es como para un contenedor cualquier orquestador, y como
  // reinicia un deploy— mataba la API en seco.
  //
  // Lo que pasa a correr, que estaba escrito y muerto:
  //
  // - `PrismaService.onModuleDestroy` → `$disconnect()`: sin el, el pool de
  //   conexiones se corta de golpe y Postgres las recoge por timeout.
  // - `CacheRedis.onModuleDestroy` → cierra su ioredis.
  // - El `onApplicationShutdown` del explorador de @nestjs/bullmq, que hace
  //   `worker.close()` en los SEIS processors (generacion-mes, health-check y
  //   los cuatro de notificaciones). Esto es lo que mas pesa aqui: `close()`
  //   espera a que el job EN CURSO termine en vez de abandonarlo. Y los jobs de
  //   este sistema no son recalculables a voluntad — uno publica el mes entero
  //   de un salon creando turnos y reservas, otro manda correo a los morosos.
  //   Abandonado a mitad, el primero deja un mes a medio crear y el segundo
  //   deja media tanda enviada que el reintento vuelve a mandar.
  //
  // VA ANTES DEL `listen` a proposito: al reves queda una ventana —corta, pero
  // real— en la que la API ya acepta peticiones y encola trabajo, y un SIGTERM
  // en ese hueco sigue siendo el cierre brusco de siempre.
  //
  // Sin argumentos = las senales que Nest lista en `ShutdownSignal`, SIGTERM y
  // SIGINT entre ellas. Hay un argumento razonable para acotarlo a esas dos
  // (la lista completa incluye SIGSEGV y compania, donde correr limpieza async
  // es dudoso, y SIGUSR2, que es la que usa nodemon para reiniciar); se deja el
  // default de Nest, que es lo que cualquiera espera leer aqui.
  app.enableShutdownHooks();

  await app.listen(config.get<number>('PORT') ?? 3000, '0.0.0.0');
}

// Solo arranca cuando este archivo ES el programa (`node dist/main`). Sin esta
// guarda, importarlo desde un test ejecutaria el bootstrap de verdad —levantar
// AppModule entero y escuchar en un puerto— como efecto del `import`, y la
// configuracion de arriba quedaria sin forma de comprobarse.
if (require.main === module) {
  void bootstrap();
}
