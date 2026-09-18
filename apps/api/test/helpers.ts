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
      '"comprobantes", "listas_espera", "claves_invitacion_salas", "claves_invitacion", ' +
      '"rutinas_fijas", "meses_calendario", "vacaciones_alumnos", "ausencias", ' +
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

/**
 * Espera a que la publicación de un mes termine, sondeando el endpoint de
 * estado.
 *
 * Los e2e de la fase no pueden hacer `await` sobre el job: el endpoint responde
 * 202 y el trabajo ocurre en el worker. Sondear el mismo endpoint que usaría un
 * cliente real es además la forma honesta de probarlo.
 */
export async function esperarPublicacion(
  servidor: Parameters<typeof request>[0],
  token: string,
  salaId: string,
  anio: number,
  mes: number,
  intentos = 60,
): Promise<Record<string, any>> {
  for (let i = 0; i < intentos; i++) {
    const { body } = await request(servidor)
      .get(`/calendario/${salaId}/${anio}/${mes}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const estado = body.publicacion?.estado;
    if (estado === 'terminado' || estado === 'fallido') return body;

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(
    `La publicacion de ${anio}-${mes} no termino tras ${intentos} intentos. ` +
      'Si el estado se quedo en "en_cola", lo mas probable es que el worker no este ' +
      'registrado o que Redis no responda.',
  );
}

export interface AlumnoDeTest {
  usuarioId: string;
  perfilId: string;
  token: string;
  email: string;
}

/**
 * Crea una clave de invitacion y da de alta un alumno con ella.
 *
 * Es el camino corto para los tests que necesitan un alumno operativo sin
 * ejercitar el auto-registro en si. Un alumno creado asi queda con sus salas
 * desde el primer momento, que es justo lo que la clave de invitacion resuelve.
 */
export async function crearAlumnoPorInvitacion(
  app: INestApplication,
  gimnasio: GimnasioDeTest,
  salaIds: string[],
  opciones: { email?: string; packId?: string } = {},
): Promise<AlumnoDeTest> {
  const servidor = app.getHttpServer();
  const email =
    opciones.email ?? `alumno-${Date.now()}-${Math.random().toString(36).slice(2)}@test.io`;

  const clave = await request(servidor)
    .post('/invitaciones')
    .set('Authorization', `Bearer ${gimnasio.adminToken}`)
    .send({
      nombre: 'Clave de test',
      salaIds,
      ...(opciones.packId ? { packId: opciones.packId } : {}),
    })
    .expect(201);

  const alta = await request(servidor)
    .post('/auth/auto-registro')
    .send({
      tenantSlug: gimnasio.slug,
      codigo: clave.body.codigo,
      nombreCompleto: 'Alumno de Test',
      email,
      password: 'Password123!',
    })
    .expect(201);

  const detalle = await request(servidor)
    .get(`/usuarios/${alta.body.usuario.id}`)
    .set('Authorization', `Bearer ${gimnasio.adminToken}`)
    .expect(200);

  return {
    usuarioId: alta.body.usuario.id,
    perfilId: detalle.body.perfilId,
    token: alta.body.accessToken,
    email,
  };
}

/**
 * Publica un mes y espera a que el worker termine.
 *
 * Sin esto, el alumno no ve ningun turno: desde la Fase 3A el descubrimiento
 * exige que el mes este HABILITADO.
 */
export async function publicarMes(
  app: INestApplication,
  token: string,
  salaId: string,
  anio: number,
  mes: number,
): Promise<void> {
  const servidor = app.getHttpServer();

  await request(servidor)
    .post(`/calendario/${salaId}/${anio}/${mes}/publicar`)
    .set('Authorization', `Bearer ${token}`)
    .expect(202);

  const estado = await esperarPublicacion(servidor, token, salaId, anio, mes);
  if (estado.publicacion?.estado !== 'terminado') {
    throw new Error(`La publicacion fallo: ${JSON.stringify(estado.publicacion)}`);
  }
}
