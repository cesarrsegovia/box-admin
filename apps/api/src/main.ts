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

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.use(compression());

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

  const config = app.get(ConfigService);
  await app.listen(config.get<number>('PORT') ?? 3000, '0.0.0.0');
}

void bootstrap();
