import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import * as argon2 from 'argon2';
import { runWithTenant } from '../src/common/tenant/tenant-context';
import { MissingTenantContextError } from '../src/common/tenant/tenant-scoped.extension';
import { PrismaService } from '../src/prisma/prisma.service';
import { CLAVE_BOOTSTRAP, crearAppDeTest, limpiarBaseDeDatos } from './helpers';

const PASSWORD = 'Password123!';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
  });

  function http() {
    return request(app.getHttpServer());
  }

  function crearTenant(slug: string, nombre = `Tenant ${slug}`) {
    return http().post('/auth/tenants').set('x-bootstrap-key', CLAVE_BOOTSTRAP).send({ nombre, slug });
  }

  function registrarAdmin(slug: string, email: string, password = PASSWORD) {
    return http()
      .post('/auth/register')
      .set('x-bootstrap-key', CLAVE_BOOTSTRAP)
      .send({ tenantSlug: slug, nombreCompleto: 'Admin de prueba', email, password });
  }

  function login(slug: string, email: string, password = PASSWORD) {
    return http().post('/auth/login').send({ tenantSlug: slug, email, password });
  }

  describe('bootstrap de tenants', () => {
    it('rechaza crear un tenant sin la clave de bootstrap', async () => {
      const res = await http().post('/auth/tenants').send({ nombre: 'Uno', slug: 'uno' });
      expect(res.status).toBe(401);
    });

    it('crea un tenant con la clave correcta', async () => {
      const res = await crearTenant('uno');
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('uno');
      expect(res.body.id).toEqual(expect.any(String));
    });

    it('rechaza un slug duplicado', async () => {
      await crearTenant('uno');
      const res = await crearTenant('uno');
      expect(res.status).toBe(409);
    });
  });

  describe('registro', () => {
    it('crea el primer usuario como ADMIN_SALON y no expone passwordHash', async () => {
      await crearTenant('uno');
      const res = await registrarAdmin('uno', 'ana@uno.test');
      expect(res.status).toBe(201);
      expect(res.body.rol).toBe('ADMIN_SALON');
      expect(res.body.passwordHash).toBeUndefined();
    });

    it('rechaza un segundo registro en el mismo tenant', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const res = await registrarAdmin('uno', 'otro@uno.test');
      expect(res.status).toBe(409);
    });
  });

  describe('login', () => {
    it('devuelve access token, refresh token y usuario', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const res = await login('uno', 'ana@uno.test');

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.usuario.email).toBe('ana@uno.test');
    });

    it('da el mismo error para email inexistente y para password incorrecta', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');

      const emailInexistente = await login('uno', 'no-existe@uno.test');
      const passwordIncorrecta = await login('uno', 'ana@uno.test', 'otraClaveDistinta');

      expect(emailInexistente.status).toBe(401);
      expect(passwordIncorrecta.status).toBe(401);

      // El timestamp de AllExceptionsFilter difiere entre requests: se compara
      // el resto del cuerpo, que es lo que de verdad no debe filtrar informacion.
      const { timestamp: _t1, ...cuerpoInexistente } = emailInexistente.body;
      const { timestamp: _t2, ...cuerpoIncorrecta } = passwordIncorrecta.body;
      expect(cuerpoInexistente).toEqual(cuerpoIncorrecta);
    });

    it('el mismo email en otro tenant es un usuario distinto', async () => {
      await crearTenant('uno');
      await crearTenant('dos');

      const admin1 = await registrarAdmin('uno', 'ana@test.com');
      const admin2 = await registrarAdmin('dos', 'ana@test.com');

      expect(admin1.status).toBe(201);
      expect(admin2.status).toBe(201);
      expect(admin1.body.id).not.toBe(admin2.body.id);
      expect(admin1.body.tenantId).not.toBe(admin2.body.tenantId);
    });
  });

  describe('rutas protegidas', () => {
    it('rechaza /auth/me sin token', async () => {
      const res = await http().get('/auth/me');
      expect(res.status).toBe(401);
    });

    it('devuelve el usuario correcto con token valido', async () => {
      const tenantRes = await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const loginRes = await login('uno', 'ana@uno.test');

      const res = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe('ana@uno.test');
      expect(res.body.tenant.slug).toBe(tenantRes.body.slug);
      expect(res.body.tenant.nombre).toBe(tenantRes.body.nombre);
    });
  });

  describe('RolesGuard', () => {
    it('deja pasar a ADMIN_SALON y bloquea a ALUMNO en /auth/admin-only', async () => {
      const tenantRes = await crearTenant('uno');
      const tenantId = tenantRes.body.id;
      await registrarAdmin('uno', 'ana@uno.test');
      const adminLogin = await login('uno', 'ana@uno.test');

      // No hay endpoint de alta de usuarios en la Fase 0: el alumno se inserta
      // directamente con el cliente base, sin scoping.
      const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
      await prisma.base.usuario.create({
        data: {
          tenantId,
          nombreCompleto: 'Alumno de prueba',
          email: 'alumno@uno.test',
          passwordHash,
          rol: 'ALUMNO',
        },
      });
      const alumnoLogin = await login('uno', 'alumno@uno.test');

      const resAdmin = await http()
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${adminLogin.body.accessToken}`);
      const resAlumno = await http()
        .get('/auth/admin-only')
        .set('Authorization', `Bearer ${alumnoLogin.body.accessToken}`);

      expect(resAdmin.status).toBe(200);
      expect(resAlumno.status).toBe(403);
    });
  });

  describe('aislamiento entre tenants', () => {
    it('cada tenant solo ve sus propios usuarios y las queries sin contexto se rechazan', async () => {
      const unoRes = await crearTenant('uno');
      const dosRes = await crearTenant('dos');
      const uno = unoRes.body;
      const dos = dosRes.body;

      await registrarAdmin('uno', 'ana@uno.test');
      await registrarAdmin('dos', 'beto@dos.test');

      const usuariosUno = await runWithTenant(
        uno.id,
        async () => await prisma.db.usuario.findMany(),
      );
      expect(usuariosUno).toHaveLength(1);
      expect(usuariosUno[0].email).toBe('ana@uno.test');

      const usuariosDos = await runWithTenant(
        dos.id,
        async () => await prisma.db.usuario.findMany(),
      );
      expect(usuariosDos).toHaveLength(1);
      expect(usuariosDos[0].email).toBe('beto@dos.test');

      // La extension de tenant no combina el tenantId pedido con el del contexto:
      // lo SOBRESCRIBE (ver tenant-scoped.extension.ts, caso 'conTenant', y el
      // test unitario "ignora un tenantId pasado a mano y usa siempre el del
      // contexto" en tenant-scoped.extension.spec.ts). Pedir explicitamente el
      // tenant "dos" desde dentro del contexto "uno" no lanza ni devuelve [];
      // el where.tenantId:dos.id se descarta y la consulta se resuelve igual
      // que sin ese filtro, devolviendo los usuarios de "uno". La garantia real
      // -y la que aqui importa comprobar- es que jamas se filtran datos de "dos".
      const cruzado = await runWithTenant(
        uno.id,
        async () => await prisma.db.usuario.findMany({ where: { tenantId: dos.id } }),
      );
      expect(cruzado).toEqual(usuariosUno);
      expect(cruzado.some((u) => u.email === 'beto@dos.test')).toBe(false);

      await expect(prisma.db.usuario.findMany()).rejects.toThrow(MissingTenantContextError);
    });
  });

  describe('refresh tokens', () => {
    it('rota el token y detecta el reuso, invalidando en cascada tambien el nuevo', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const loginRes = await login('uno', 'ana@uno.test');
      const tokenViejo = loginRes.body.refreshToken;

      const rotacion = await http().post('/auth/refresh').send({ refreshToken: tokenViejo });
      expect(rotacion.status).toBe(200);
      const tokenNuevo = rotacion.body.refreshToken;
      expect(tokenNuevo).not.toBe(tokenViejo);

      const reusoDelViejo = await http()
        .post('/auth/refresh')
        .send({ refreshToken: tokenViejo });
      expect(reusoDelViejo.status).toBe(401);

      const usoDelNuevo = await http()
        .post('/auth/refresh')
        .send({ refreshToken: tokenNuevo });
      expect(usoDelNuevo.status).toBe(401);
    });

    it('logout revoca el refresh token', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const loginRes = await login('uno', 'ana@uno.test');

      const logoutRes = await http()
        .post('/auth/logout')
        .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
        .send({ refreshToken: loginRes.body.refreshToken });
      expect(logoutRes.status).toBe(204);

      const refreshRes = await http()
        .post('/auth/refresh')
        .send({ refreshToken: loginRes.body.refreshToken });
      expect(refreshRes.status).toBe(401);
    });

    it('el reuso de un token rotado revoca tambien las demas sesiones vivas', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');

      const loginA = await login('uno', 'ana@uno.test');
      const loginB = await login('uno', 'ana@uno.test');

      const rotacionA = await http()
        .post('/auth/refresh')
        .send({ refreshToken: loginA.body.refreshToken });
      expect(rotacionA.status).toBe(200);

      const reusoA = await http()
        .post('/auth/refresh')
        .send({ refreshToken: loginA.body.refreshToken });
      expect(reusoA.status).toBe(401);

      // B nunca se toco: si la revocacion en cascada no existiera, esto seguiria
      // devolviendo 200, y nadie detectaria la regresion.
      const refreshB = await http()
        .post('/auth/refresh')
        .send({ refreshToken: loginB.body.refreshToken });
      expect(refreshB.status).toBe(401);
    });

    it('con refresh concurrentes del mismo token solo uno gana', async () => {
      await crearTenant('uno');
      await registrarAdmin('uno', 'ana@uno.test');
      const loginRes = await login('uno', 'ana@uno.test');
      const token = loginRes.body.refreshToken;

      const respuestas = await Promise.all(
        Array.from({ length: 10 }, () =>
          http().post('/auth/refresh').send({ refreshToken: token }),
        ),
      );

      const exitosas = respuestas.filter((r) => r.status === 200);
      const rechazadas = respuestas.filter((r) => r.status === 401);

      expect(exitosas).toHaveLength(1);
      expect(rechazadas).toHaveLength(9);
    });
  });
});
