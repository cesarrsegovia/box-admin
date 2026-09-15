import type { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { crearAppDeTest, limpiarBaseDeDatos } from './helpers';

/**
 * Aislamiento entre gimnasios a nivel de BASE DE DATOS.
 *
 * El resto de la aplicacion se aisla en codigo, con la extension de Prisma que
 * inyecta `where: { tenantId }`. Este test comprueba la red que hay DEBAJO de
 * ese codigo: las claves foraneas compuestas `(tenantId, xId)`.
 *
 * Por eso todo aqui usa `prisma.base` y no `prisma.db`: `prisma.db` ya lo
 * impediria por si mismo, y entonces el test no demostraria nada sobre la base.
 * Usando el cliente SIN scoping simulamos el peor caso realista —un service que
 * se olvida de validar la pertenencia— y verificamos que Postgres lo rechaza
 * igualmente.
 */
describe('Aislamiento por claves foraneas compuestas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
  });

  afterAll(async () => {
    await limpiarBaseDeDatos(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
  });

  /** Ejecuta la promesa y devuelve el error que lanza, o falla si no lanza ninguno. */
  async function capturarError(accion: () => Promise<unknown>): Promise<unknown> {
    try {
      await accion();
    } catch (error) {
      return error;
    }
    throw new Error('Se esperaba un error de clave foranea y la insercion tuvo exito');
  }

  function esViolacionDeClaveForanea(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2003';
    // Las queries crudas devuelven el error de Postgres tal cual (SQLSTATE 23503).
    const mensaje = error instanceof Error ? error.message : String(error);
    return mensaje.includes('violates foreign key constraint');
  }

  /** Crea dos tenants, A y B, sin pasar por la extension de aislamiento. */
  async function crearDosGimnasios() {
    const a = await prisma.base.tenant.create({ data: { nombre: 'Gimnasio A', slug: 'gim-a' } });
    const b = await prisma.base.tenant.create({ data: { nombre: 'Gimnasio B', slug: 'gim-b' } });
    return { a, b };
  }

  /** Alta de un alumno (usuario + perfil) dentro de un mismo tenant. */
  async function crearPerfilEn(tenantId: string, email: string) {
    const usuario = await prisma.base.usuario.create({
      data: {
        tenantId,
        nombreCompleto: 'Alumno de prueba',
        email,
        passwordHash: 'hash_irrelevante',
        rol: 'ALUMNO',
      },
    });
    return prisma.base.perfil.create({ data: { tenantId, usuarioId: usuario.id } });
  }

  it('la base rechaza una fila de usuarios_salas que cruce perfil de B con sala de A', async () => {
    const { a, b } = await crearDosGimnasios();
    const salaDeA = await prisma.base.sala.create({ data: { tenantId: a.id, nombre: 'Sala de A' } });
    const perfilDeB = await crearPerfilEn(b.id, 'alumno.b@test.local');

    // Fila coherente consigo misma (tenantId = B, perfil de B) pero que apunta a
    // una sala de otro gimnasio. La FK compuesta (tenantId, salaId) lo impide.
    const error = await capturarError(() =>
      prisma.base.usuarioSala.create({
        data: { tenantId: b.id, perfilId: perfilDeB.id, salaId: salaDeA.id },
      }),
    );

    expect(esViolacionDeClaveForanea(error)).toBe(true);
    expect(JSON.stringify(error)).toContain('usuarios_salas_tenantId_salaId_fkey');

    // Y no ha quedado nada escrito.
    await expect(prisma.base.usuarioSala.count()).resolves.toBe(0);
  });

  it('la base rechaza una reserva del gimnasio A sobre un turno del gimnasio B', async () => {
    const { a, b } = await crearDosGimnasios();
    const perfilDeA = await crearPerfilEn(a.id, 'alumno.a@test.local');
    const salaDeB = await prisma.base.sala.create({ data: { tenantId: b.id, nombre: 'Sala de B' } });
    const turnoDeB = await prisma.base.turno.create({
      data: {
        tenantId: b.id,
        salaId: salaDeB.id,
        nombre: 'Pilates',
        fecha: new Date('2026-10-01T00:00:00.000Z'),
        horaInicio: '10:00',
        horaFin: '11:00',
        cupo: 10,
      },
    });

    const error = await capturarError(() =>
      prisma.base.reserva.create({
        data: { tenantId: a.id, turnoId: turnoDeB.id, perfilId: perfilDeA.id, origen: 'ADMIN' },
      }),
    );

    expect(esViolacionDeClaveForanea(error)).toBe(true);
    expect(JSON.stringify(error)).toContain('reservas_tenantId_turnoId_fkey');

    await expect(prisma.base.reserva.count()).resolves.toBe(0);
  });

  it('la base rechaza el cruce incluso con SQL crudo, sin pasar por Prisma', async () => {
    // Prisma valida bastante por su cuenta; esta prueba va directa al motor para
    // dejar claro que quien dice que no es Postgres, no el cliente.
    const { a, b } = await crearDosGimnasios();
    const salaDeA = await prisma.base.sala.create({ data: { tenantId: a.id, nombre: 'Sala de A' } });
    const perfilDeB = await crearPerfilEn(b.id, 'alumno.b@test.local');

    const error = await capturarError(() =>
      prisma.base.$executeRawUnsafe(
        'INSERT INTO "usuarios_salas" ("tenantId", "perfilId", "salaId") VALUES ($1, $2, $3)',
        b.id,
        perfilDeB.id,
        salaDeA.id,
      ),
    );

    const mensaje = error instanceof Error ? error.message : String(error);
    expect(mensaje).toContain('usuarios_salas_tenantId_salaId_fkey');
  });

  it('permite el caso legitimo: perfil y sala del mismo gimnasio', async () => {
    // Contraprueba: si esto fallara, la restriccion no estaria impidiendo el
    // cruce sino rompiendo el uso normal.
    const { a } = await crearDosGimnasios();
    const sala = await prisma.base.sala.create({ data: { tenantId: a.id, nombre: 'Sala de A' } });
    const perfil = await crearPerfilEn(a.id, 'alumno.a@test.local');

    await prisma.base.usuarioSala.create({
      data: { tenantId: a.id, perfilId: perfil.id, salaId: sala.id },
    });

    await expect(prisma.base.usuarioSala.count()).resolves.toBe(1);
  });

  it('permite un pack sin sala: con salaId NULL la FK compuesta no se comprueba', async () => {
    // MATCH SIMPLE: una FK multicolumna con alguna columna NULL no se verifica.
    // Es lo que mantiene validos `Pack.salaId` y `Perfil.packId` opcionales.
    const { a } = await crearDosGimnasios();

    const pack = await prisma.base.pack.create({
      data: { tenantId: a.id, nombre: '8 clases', salaId: null },
    });

    expect(pack.salaId).toBeNull();
  });
});
