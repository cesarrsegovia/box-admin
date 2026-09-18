import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  publicarMes,
  type GimnasioDeTest,
} from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

const ANIO = 2099;
const MES = 10;
const FECHA = `${ANIO}-10-13`;
const DESDE = `${ANIO}-10-01`;
const HASTA = `${ANIO}-10-31`;

describe('Fase 3A — self-service del alumno', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gym: GimnasioDeTest;
  let servidor: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    ({ app, prisma } = await crearAppDeTest());
    servidor = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    gym = await crearGimnasio(app, `gym-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  });

  /** Sala con cupoBase, que es de donde sale el cupo de los turnos generados. */
  async function crearSala(extra: Record<string, unknown> = {}): Promise<string> {
    const { body } = await request(servidor)
      .post('/salas')
      .set('Authorization', `Bearer ${gym.adminToken}`)
      .send({ nombre: 'Sala A', cupoBase: 5, ...extra })
      .expect(201);

    return body.id;
  }

  async function crearTurno(salaId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const { body } = await request(servidor)
      .post('/turnos')
      .set('Authorization', `Bearer ${gym.adminToken}`)
      .send({
        salaId,
        nombre: 'Pilates',
        fecha: FECHA,
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 5,
        ...extra,
      })
      .expect(201);

    return body.id;
  }

  async function crearInvitacion(
    salaIds: string[],
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; codigo: string }> {
    const { body } = await request(servidor)
      .post('/invitaciones')
      .set('Authorization', `Bearer ${gym.adminToken}`)
      .send({ nombre: 'Clave', salaIds, ...extra })
      .expect(201);

    return body;
  }

  // -------------------------------------------------------------------------
  // 1. Auto-registro
  // -------------------------------------------------------------------------
  describe('auto-registro', () => {
    it('un alumno se da de alta con una clave valida y queda operativo', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId]);

      const alta = await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Ana Perez',
          email: 'Ana@Ejemplo.COM',
          password: 'Password123!',
        })
        .expect(201);

      expect(alta.body.usuario.rol).toBe('ALUMNO');
      // Normalizado, aunque llego en mayusculas.
      expect(alta.body.usuario.email).toBe('ana@ejemplo.com');
      expect(alta.body.accessToken).toEqual(expect.any(String));

      // Queda con la sala de la clave: esto es lo que tapa el agujero del PDF.
      const detalle = await request(servidor)
        .get(`/usuarios/${alta.body.usuario.id}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(detalle.body.salaIds).toEqual([salaId]);

      // Y su token sirve de verdad.
      const yo = await request(servidor)
        .get('/auth/me')
        .set('Authorization', `Bearer ${alta.body.accessToken}`)
        .expect(200);
      expect(yo.body.id).toBe(alta.body.usuario.id);
    });

    it('el alta aparece en el listado de pendientes de revision', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const pendientes = await request(servidor)
        .get('/usuarios?autoRegistrado=true')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(pendientes.body.map((u: { id: string }) => u.id)).toEqual([alumno.usuarioId]);
    });

    it('un alumno dado de alta por el admin NO aparece como auto-registrado', async () => {
      const salaId = await crearSala();
      await request(servidor)
        .post('/usuarios/alumnos')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombreCompleto: 'Del Admin', email: 'deladmin@test.io', salaIds: [salaId] })
        .expect(201);

      const pendientes = await request(servidor)
        .get('/usuarios?autoRegistrado=true')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(pendientes.body).toHaveLength(0);
    });

    it('la clave lleva el pack, y el alumno lo recibe', async () => {
      const salaId = await crearSala();
      const pack = await request(servidor)
        .post('/packs')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8 })
        .expect(201);

      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId], { packId: pack.body.id });

      const detalle = await request(servidor)
        .get(`/usuarios/${alumno.usuarioId}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);

      expect(detalle.body.packId).toBe(pack.body.id);
    });

    it.each([
      ['inactiva', { activa: false }],
      ['caducada', { expiraEn: '2020-01-01T00:00:00.000Z' }],
    ])('rechaza una clave %s con 401', async (_nombre, parche) => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId]);

      await request(servidor)
        .patch(`/invitaciones/${clave.id}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send(parche)
        .expect(200);

      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Ana',
          email: 'ana@test.io',
          password: 'Password123!',
        })
        .expect(401);
    });

    it('rechaza una clave con los usos agotados', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId], { usosMax: 1 });

      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Primera',
          email: 'primera@test.io',
          password: 'Password123!',
        })
        .expect(201);

      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Segunda',
          email: 'segunda@test.io',
          password: 'Password123!',
        })
        .expect(401);
    });

    it('rechaza un codigo inexistente con 401', async () => {
      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: 'f'.repeat(32),
          nombreCompleto: 'Ana',
          email: 'ana@test.io',
          password: 'Password123!',
        })
        .expect(401);
    });

    it('409 si el email ya existe en ese gimnasio', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId]);
      const cuerpo = {
        tenantSlug: gym.slug,
        codigo: clave.codigo,
        nombreCompleto: 'Ana',
        email: 'repetida@test.io',
        password: 'Password123!',
      };

      await request(servidor).post('/auth/auto-registro').send(cuerpo).expect(201);
      await request(servidor)
        .post('/auth/auto-registro')
        .send({ ...cuerpo, nombreCompleto: 'Otra' })
        .expect(409);
    });

    it('el cuerpo no puede colar un rol: 400 antes de llegar al servicio', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId]);

      // El ValidationPipe global corre con forbidNonWhitelisted.
      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: gym.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Ana',
          email: 'ana@test.io',
          password: 'Password123!',
          rol: 'ADMIN_SALON',
        })
        .expect(400);
    });

    // Este va completo porque es el que prueba la carrera, y una carrera mal
    // probada da falsos verdes: si el test fuera secuencial pasaria igual con
    // una implementacion sin aislamiento ninguno.
    it('CONCURRENCIA: diez altas simultaneas con una clave de un solo uso dan exactamente un 201', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId], { usosMax: 1 });

      // Sin await entre medias: las diez salen a la vez.
      const respuestas = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(servidor)
            .post('/auth/auto-registro')
            .send({
              tenantSlug: gym.slug,
              codigo: clave.codigo,
              nombreCompleto: `Alumno ${i}`,
              email: `concurrente-${i}@test.io`,
              password: 'Password123!',
            }),
        ),
      );

      const creados = respuestas.filter((r) => r.status === 201);
      const rechazados = respuestas.filter((r) => r.status === 401 || r.status === 409);

      expect(creados).toHaveLength(1);
      expect(rechazados).toHaveLength(9);
      // Ni un 500: agotar una clave es un conflicto, no un fallo del servidor.
      expect(respuestas.filter((r) => r.status >= 500)).toHaveLength(0);

      const claves = await request(servidor)
        .get('/invitaciones')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(claves.body[0].usosActuales).toBe(1);

      const alumnos = await request(servidor)
        .get('/usuarios?autoRegistrado=true')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(alumnos.body).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Descubrimiento de turnos
  // -------------------------------------------------------------------------
  describe('turnos disponibles', () => {
    it('los turnos de un mes SIN publicar no aparecen', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const { body } = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(body).toEqual([]);
    });

    it('tras publicar el mes, el turno aparece como LIBRE', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const { body } = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({
        turnoId,
        fecha: FECHA,
        disponibilidad: expect.objectContaining({ estado: 'LIBRE', puedeReservar: true }),
      });
    });

    it('una sala a la que el alumno no tiene acceso no aparece', async () => {
      const salaConAcceso = await crearSala();
      const salaAjena = await crearSala({ nombre: 'Sala B' });
      await crearTurno(salaAjena);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaConAcceso]);

      await publicarMes(app, gym.adminToken, salaAjena, ANIO, MES);

      const { body } = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(body).toEqual([]);
    });

    it('400 sin el rango de fechas', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      await request(servidor)
        .get('/turnos-disponibles')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(400);
    });

    it('un admin sin perfil recibe 404: no tiene calendario propio', async () => {
      await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Reserva y cancelacion propias
  // -------------------------------------------------------------------------
  describe('reserva propia', () => {
    it('el alumno reserva y la clase aparece en su calendario', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);

      const { body } = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ turnoId, nombre: 'Pilates', origen: 'ALUMNO' });
    });

    it('reservar dos veces el mismo turno da 409', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(409);
    });

    it('un mes sin publicar impide reservar, aunque el turno exista', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(409);
    });

    it('fuera de la ventana de anotacion da 409', async () => {
      // Una ventana absurda deja el turno fuera de plazo siempre.
      const salaId = await crearSala({ minMinutosAnotarse: 99999999 });
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const r = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(409);

      expect(r.body.message).toMatch(/plazo para anotarse/i);
    });

    it('la ventana se hereda del tenant cuando la sala la tiene en null', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      // No hay endpoint de configuracion del tenant en esta fase, asi que se
      // escribe directo: es configuracion, no la logica bajo prueba.
      await prisma.base.tenant.update({
        where: { id: gym.tenantId },
        data: { minMinutosAnotarse: 99999999 },
      });

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(409);
    });

    it('la sala manda sobre el tenant: un 0 explicito en la sala reabre la ventana', async () => {
      const salaId = await crearSala({ minMinutosAnotarse: 0 });
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      await prisma.base.tenant.update({
        where: { id: gym.tenantId },
        data: { minMinutosAnotarse: 99999999 },
      });

      // Con `||` en vez de `??` este test fallaria: el 0 se caeria al tenant.
      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);
    });
  });

  describe('cancelacion propia', () => {
    it('dentro de la ventana cancela como RECUPERABLE y desaparece del calendario', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const reserva = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);

      const cancelada = await request(servidor)
        .delete(`/mis-reservas/${reserva.body.id}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      expect(cancelada.body.cancelacionTipo).toBe('RECUPERABLE');

      const { body } = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(body).toHaveLength(0);
    });

    it('fuera de la ventana da 409 y la reserva sigue activa', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const reserva = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(201);

      // La ventana se cierra DESPUES de reservar, para no impedir la reserva.
      await request(servidor)
        .patch(`/salas/${salaId}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ minMinutosCancelar: 99999999 })
        .expect(200);

      await request(servidor)
        .delete(`/mis-reservas/${reserva.body.id}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(409);

      const { body } = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(body).toHaveLength(1);
      // Y el propio calendario ya avisaba de que no se podia.
      expect(body[0].puedeCancelar).toBe(false);
    });

    it('cancelar la reserva de otro alumno da 403', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const a = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'a@test.io' });
      const b = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'b@test.io' });
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const reserva = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      await request(servidor)
        .delete(`/mis-reservas/${reserva.body.id}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Lista de espera
  // -------------------------------------------------------------------------
  describe('lista de espera', () => {
    /** Sala de UNA plaza con lista de espera encendida, y su turno publicado. */
    async function escenarioDeCola() {
      const salaId = await crearSala({ cupoBase: 1, listaEsperaHabilitada: true });
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const a = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'a@test.io' });
      const b = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'b@test.io' });
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      return { salaId, turnoId, a, b };
    }

    it('un turno lleno OFRECE la lista de espera en vez de un error generico', async () => {
      const { turnoId, a, b } = await escenarioDeCola();

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      const rechazo = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(409);

      // Punto 4 del checklist del PDF.
      expect(rechazo.body.message).toMatch(/lista de espera/i);

      const { body } = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(body[0].disponibilidad.estado).toBe('LISTA_ESPERA');
    });

    it('B se anota y ve su posicion', async () => {
      const { turnoId, a, b } = await escenarioDeCola();
      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      const cola = await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);

      expect(cola.body.posicion).toBe(1);
    });

    it('anotarse en un turno con cupo da 409', async () => {
      const { turnoId, b } = await escenarioDeCola();

      // Nadie reservo todavia: hay cupo.
      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(409);
    });

    it('anotarse dos veces da 409', async () => {
      const { turnoId, a, b } = await escenarioDeCola();
      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);
      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(409);
    });

    it('PUNTO CLAVE: al cancelar A, B entra automaticamente', async () => {
      const { turnoId, a, b } = await escenarioDeCola();

      const reservaA = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);

      const antes = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(antes.body).toHaveLength(0);

      // Aqui es donde tiene que dispararse la asignacion.
      await request(servidor)
        .delete(`/mis-reservas/${reservaA.body.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);

      const despues = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);

      expect(despues.body).toHaveLength(1);
      // El origen es lo que le permite a B entender despues por que le aparecio
      // una clase que no reservo.
      expect(despues.body[0]).toMatchObject({ turnoId, origen: 'LISTA_ESPERA' });

      const disponibles = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      const elTurno = disponibles.body.find((t: { turnoId: string }) => t.turnoId === turnoId);
      expect(elTurno.disponibilidad.enListaEspera).toBe(false);
      expect(elTurno.disponibilidad.motivo).toBe('YA_RESERVADO');
    });

    it('respeta el orden de la cola: entra el que se anoto primero', async () => {
      const { salaId, turnoId, a, b } = await escenarioDeCola();
      const c = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'c@test.io' });

      const reservaA = await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);
      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${c.token}`)
        .expect(201);

      await request(servidor)
        .delete(`/mis-reservas/${reservaA.body.id}`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(200);

      const deB = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(deB.body).toHaveLength(1);

      // C sigue esperando, y ahora es el primero.
      const deC = await request(servidor)
        .get(`/mi-calendario?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${c.token}`)
        .expect(200);
      expect(deC.body).toHaveLength(0);

      const disponibles = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${c.token}`)
        .expect(200);
      expect(disponibles.body[0].disponibilidad.posicionEnLista).toBe(1);
    });

    it('salirse de la lista libera el puesto', async () => {
      const { turnoId, a, b } = await escenarioDeCola();
      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);
      const cola = await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(201);

      await request(servidor)
        .delete(`/lista-espera/${cola.body.id}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(204);

      const disponibles = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(disponibles.body[0].disponibilidad.enListaEspera).toBe(false);
    });

    it('sin lista de espera habilitada, un turno lleno queda LLENO y no admite cola', async () => {
      const salaId = await crearSala({ cupoBase: 1 });
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const a = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'a2@test.io' });
      const b = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'b2@test.io' });
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${a.token}`)
        .expect(201);

      const disponibles = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);
      expect(disponibles.body[0].disponibilidad.estado).toBe('LLENO');

      await request(servidor)
        .post(`/turnos/${turnoId}/lista-espera`)
        .set('Authorization', `Bearer ${b.token}`)
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Comprobantes
  // -------------------------------------------------------------------------
  describe('comprobantes', () => {
    const CONTENIDO = Buffer.from('%PDF-1.4 comprobante de prueba');

    /** Descarga binaria: supertest parsearia el cuerpo como texto sin esto. */
    function descargarBinario(ruta: string) {
      return request(servidor)
        .get(ruta)
        .buffer(true)
        .parse((res, cb) => {
          const trozos: Buffer[] = [];
          res.on('data', (t: Buffer) => trozos.push(t));
          res.on('end', () => cb(null, Buffer.concat(trozos)));
        });
    }

    /** Quita el origen: supertest ataca la app por su puerto efimero. */
    function soloRuta(url: string): string {
      const u = new URL(url);
      return `${u.pathname}${u.search}`;
    }

    // Va completo porque es el unico test que ejercita la subida de verdad, que
    // es justo lo que un mock habria dejado sin probar hasta produccion.
    it('ciclo completo: crear, SUBIR DE VERDAD, confirmar, aprobar', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      // 1. Crear la fila y pedir la URL firmada.
      const creado = await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'transferencia.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      expect(creado.body.comprobante.subidoEn).toBeNull();
      expect(creado.body.urlDeSubida).toContain('/archivos-locales/');

      // 2. Subir el archivo A ESA URL.
      await request(servidor)
        .put(soloRuta(creado.body.urlDeSubida))
        .set('Content-Type', 'application/pdf')
        .send(CONTENIDO)
        .expect(200);

      // 3. Confirmar.
      const confirmado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/confirmar`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(confirmado.body.subidoEn).not.toBeNull();

      // El admin ya lo ve, con su URL de descarga.
      const pendientes = await request(servidor)
        .get('/comprobantes?estado=PENDIENTE')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(pendientes.body).toHaveLength(1);
      expect(pendientes.body[0].urlDeDescarga).toContain('/archivos-locales/');

      // Y lo que se descarga es EXACTAMENTE lo que se subio. Sin esto, el test
      // probaria que las URLs se firman, no que el archivo llego.
      const bajado = await descargarBinario(soloRuta(pendientes.body[0].urlDeDescarga)).expect(200);
      expect(Buffer.from(bajado.body)).toEqual(CONTENIDO);

      // 4. Aprobar.
      const aprobado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/aprobar`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({})
        .expect(200);
      expect(aprobado.body).toMatchObject({ estado: 'APROBADO', revisadoPor: gym.adminId });

      // Y el alumno queda al dia: es lo que le da sentido a todo el flujo.
      const detalle = await request(servidor)
        .get(`/usuarios/${alumno.usuarioId}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(detalle.body.pagoAlDia).toBe(true);
    });

    it('sin confirmar, el admin no lo ve, pero el alumno si', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      const delAdmin = await request(servidor)
        .get('/comprobantes')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(delAdmin.body).toHaveLength(0);

      const delAlumno = await request(servidor)
        .get('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);
      expect(delAlumno.body).toHaveLength(1);
      expect(delAlumno.body[0].urlDeDescarga).toBeNull();
    });

    it('aprobar un comprobante sin archivo da 409', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const creado = await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/aprobar`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({})
        .expect(409);
    });

    it('rechazar guarda la nota y NO pone pagoAlDia', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const creado = await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
        .expect(201);
      await request(servidor).put(soloRuta(creado.body.urlDeSubida)).send(CONTENIDO).expect(200);
      await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/confirmar`)
        .set('Authorization', `Bearer ${alumno.token}`)
        .expect(200);

      const rechazado = await request(servidor)
        .patch(`/comprobantes/${creado.body.comprobante.id}/rechazar`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nota: 'Ilegible' })
        .expect(200);

      expect(rechazado.body).toMatchObject({ estado: 'RECHAZADO', nota: 'Ilegible' });

      const detalle = await request(servidor)
        .get(`/usuarios/${alumno.usuarioId}`)
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .expect(200);
      expect(detalle.body.pagoAlDia).toBe(false);
    });

    it('una URL con la firma cambiada da 403', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const creado = await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      const url = new URL(creado.body.urlDeSubida);
      const firma = url.searchParams.get('firma')!;
      url.searchParams.set('firma', `${firma.slice(0, -1)}${firma.at(-1) === 'a' ? 'b' : 'a'}`);

      await request(servidor).put(`${url.pathname}${url.search}`).send(CONTENIDO).expect(403);
    });

    it('sin firma, la ruta del almacen no sirve de nada', async () => {
      await request(servidor).get('/archivos-locales/loquesea.pdf').expect(403);
    });

    it('un alumno no ve los comprobantes de otro', async () => {
      const salaId = await crearSala();
      const a = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'ca@test.io' });
      const b = await crearAlumnoPorInvitacion(app, gym, [salaId], { email: 'cb@test.io' });

      await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${a.token}`)
        .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
        .expect(201);

      const deB = await request(servidor)
        .get('/comprobantes')
        .set('Authorization', `Bearer ${b.token}`)
        .expect(200);

      expect(deB.body).toHaveLength(0);
    });

    it('rechaza un tipo de archivo no admitido con 409', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      await request(servidor)
        .post('/comprobantes')
        .set('Authorization', `Bearer ${alumno.token}`)
        .send({ nombreOriginal: 'virus.exe', tipoMime: 'application/x-msdownload' })
        .expect(409);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Aislamiento entre gimnasios
  // -------------------------------------------------------------------------
  describe('aislamiento', () => {
    it('un codigo de invitacion de un gimnasio no sirve en el otro', async () => {
      const salaId = await crearSala();
      const clave = await crearInvitacion([salaId]);
      const otro = await crearGimnasio(app, `otro-${Date.now()}`);

      // Es lo que protege el @@unique([tenantId, codigo]) en vez del global.
      await request(servidor)
        .post('/auth/auto-registro')
        .send({
          tenantSlug: otro.slug,
          codigo: clave.codigo,
          nombreCompleto: 'Intruso',
          email: 'intruso@test.io',
          password: 'Password123!',
        })
        .expect(401);
    });

    it('un alumno de un gimnasio no ve turnos del otro', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);
      const alumnoDeAqui = await crearAlumnoPorInvitacion(app, gym, [salaId]);

      const otro = await crearGimnasio(app, `otro-${Date.now()}`);
      const salaAjena = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${otro.adminToken}`)
        .send({ nombre: 'Ajena', cupoBase: 5 })
        .expect(201);
      const alumnoDeAlla = await crearAlumnoPorInvitacion(app, otro, [salaAjena.body.id], {
        email: 'deotro@test.io',
      });

      const deAqui = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumnoDeAqui.token}`)
        .expect(200);
      expect(deAqui.body).toHaveLength(1);

      const deAlla = await request(servidor)
        .get(`/turnos-disponibles?desde=${DESDE}&hasta=${HASTA}`)
        .set('Authorization', `Bearer ${alumnoDeAlla.token}`)
        .expect(200);
      expect(deAlla.body).toHaveLength(0);
    });

    it('reservar un turno del otro gimnasio da 404, no 403', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      await publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      const otro = await crearGimnasio(app, `otro-${Date.now()}`);
      const salaAjena = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${otro.adminToken}`)
        .send({ nombre: 'Ajena', cupoBase: 5 })
        .expect(201);
      const intruso = await crearAlumnoPorInvitacion(app, otro, [salaAjena.body.id], {
        email: 'intruso2@test.io',
      });

      // 404 y no 403: para el otro gimnasio ese turno sencillamente no existe.
      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set('Authorization', `Bearer ${intruso.token}`)
        .expect(404);
    });

    it('un admin no puede crear una invitacion con una sala del otro gimnasio', async () => {
      const otro = await crearGimnasio(app, `otro-${Date.now()}`);
      const salaAjena = await request(servidor)
        .post('/salas')
        .set('Authorization', `Bearer ${otro.adminToken}`)
        .send({ nombre: 'Ajena', cupoBase: 5 })
        .expect(201);

      await request(servidor)
        .post('/invitaciones')
        .set('Authorization', `Bearer ${gym.adminToken}`)
        .send({ nombre: 'Robada', salaIds: [salaAjena.body.id] })
        .expect(400);
    });
  });
});
