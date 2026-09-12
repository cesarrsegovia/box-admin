import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

export interface EntornoE2E {
  app: INestApplication;
  prisma: PrismaService;
}

/** Levanta la aplicación completa con la misma configuración que `main.ts`. */
export async function crearAppDeTest(): Promise<EntornoE2E> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

/** Vacía todas las tablas. Usa el cliente base, sin scoping: es limpieza, no lógica de negocio. */
export async function limpiarBaseDeDatos(prisma: PrismaService): Promise<void> {
  await prisma.base.$executeRawUnsafe(
    'TRUNCATE TABLE "refresh_tokens", "usuarios", "historial_acciones", "tenants" RESTART IDENTITY CASCADE',
  );
}

export const CLAVE_BOOTSTRAP = 'test_bootstrap_key';
