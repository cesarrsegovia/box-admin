import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
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
    'TRUNCATE TABLE ' +
      '"reservas", "usuarios_salas", "turnos", "perfiles", "packs", "salas", ' +
      '"refresh_tokens", "usuarios", "historial_acciones", "tenants" ' +
      'RESTART IDENTITY CASCADE',
  );
}

export const CLAVE_BOOTSTRAP = 'test_bootstrap_key';

export interface GimnasioDeTest {
  tenantId: string;
  slug: string;
  adminToken: string;
  adminId: string;
}

/**
 * Crea un gimnasio con su primer ADMIN_SALON y devuelve su access token.
 * Es la puerta de entrada de casi todos los tests de esta fase.
 */
export async function crearGimnasio(app: INestApplication, slug: string): Promise<GimnasioDeTest> {
  const servidor = app.getHttpServer();
  const email = `admin@${slug}.test`;
  const password = 'Password123!';

  const tenant = await request(servidor)
    .post('/auth/tenants')
    .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
    .send({ nombre: slug, slug })
    .expect(201);

  const admin = await request(servidor)
    .post('/auth/register')
    .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
    .send({ tenantSlug: slug, nombreCompleto: `Admin ${slug}`, email, password })
    .expect(201);

  const login = await request(servidor)
    .post('/auth/login')
    .send({ tenantSlug: slug, email, password })
    .expect(200);

  return {
    tenantId: tenant.body.id,
    slug,
    adminToken: login.body.accessToken,
    adminId: admin.body.id,
  };
}

/** Atajo para no repetir el header en cada petición. */
export const conToken = (token: string) => (peticion: request.Test) =>
  peticion.set('Authorization', `Bearer ${token}`);
