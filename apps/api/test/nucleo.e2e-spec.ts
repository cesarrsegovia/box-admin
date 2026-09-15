import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { crearAppDeTest, crearGimnasio, limpiarBaseDeDatos, type GimnasioDeTest } from './helpers';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('Fase 1 — nucleo operativo (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
    servidor = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    gym = await crearGimnasio(app, 'boxuno');
  });

  // Helpers locales -------------------------------------------------------

  const crearSala = async (nombre = 'Sala A'): Promise<string> => {
    const { body } = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre })
      .expect(201);
    return body.id;
  };

  const crearPack = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const { body } = await request(servidor)
      .post('/packs')
      .set(auth(gym.adminToken))
      .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8, precio: '12500.00', ...extra })
      .expect(201);
    return body.id;
  };

  const crearAlumno = async (
    salaIds: string[],
    extra: Record<string, unknown> = {},
  ): Promise<{ id: string; perfilId: string; body: Record<string, any> }> => {
    const { body } = await request(servidor)
      .post('/usuarios/alumnos')
      .set(auth(gym.adminToken))
      .send({
        nombreCompleto: 'Ana Perez',
        email: `ana${Math.random().toString(36).slice(2)}@gym.test`,
        salaIds,
        ...extra,
      })
      .expect(201);
    return { id: body.id, perfilId: body.perfilId, body };
  };

  const crearTurno = async (
    salaId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const { body } = await request(servidor)
      .post('/turnos')
      .set(auth(gym.adminToken))
      .send({
        salaId,
        nombre: 'Pilates',
        fecha: '2026-10-05',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
        ...extra,
      })
      .expect(201);
    return body.id;
  };

  // 1 — Salas -------------------------------------------------------------

  describe('checklist 1: crear y configurar una sala', () => {
    it('crea una sala con reglas propias y la devuelve al listar', async () => {
      const { body } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Sala A', cupoBase: 12, minMinutosCancelar: 120, exclusiva: true })
        .expect(201);

      expect(body).toMatchObject({
        nombre: 'Sala A',
        cupoBase: 12,
        minMinutosCancelar: 120,
        exclusiva: true,
        activa: true,
      });

      const lista = await request(servidor).get('/salas').set(auth(gym.adminToken)).expect(200);

      expect(lista.body).toHaveLength(1);
    });

    it('la sala que no configura reglas las deja en null, para heredarlas mas adelante', async () => {
      const { body } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Sala B' })
        .expect(201);

      expect(body.cupoBase).toBeNull();
      expect(body.listaEsperaHabilitada).toBeNull();
    });

    it('la baja es logica y 409 si quedan turnos futuros', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId, { fecha: '2099-01-01' });

      await request(servidor).delete(`/salas/${salaId}`).set(auth(gym.adminToken)).expect(409);
    });
  });

  // 2 — Packs -------------------------------------------------------------

  describe('checklist 2: catalogo de packs independiente', () => {
    it('crea un pack sin que exista ningun alumno', async () => {
      const { body } = await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: '8 clases', tipo: 'MENSUAL', clasesPorMes: 8, precio: '12500.00' })
        .expect(201);

      // Precio como string: el JSON de un Decimal no puede ser un float.
      expect(body.precio).toBe('12500.00');
      expect(typeof body.precio).toBe('string');
    });

    it('un pack sin precio es "a consultar"', async () => {
      const { body } = await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: 'A consultar', tipo: 'MENSUAL' })
        .expect(201);

      expect(body.precio).toBeNull();
    });

    it('un pack MENSUAL con clasesTotales es 400', async () => {
      await request(servidor)
        .post('/packs')
        .set(auth(gym.adminToken))
        .send({ nombre: 'X', tipo: 'MENSUAL', clasesTotales: 10 })
        .expect(400);
    });
  });

  // 3 y 4 — Altas ---------------------------------------------------------

  describe('checklist 3: DTOs distintos para alumno y profesor', () => {
    it('da de alta un alumno con pack y devuelve la clave temporal una vez', async () => {
      const salaId = await crearSala();
      const packId = await crearPack();

      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({
          nombreCompleto: 'Ana Perez',
          email: 'ana@gym.test',
          salaIds: [salaId],
          packId,
        })
        .expect(201);

      expect(body.rol).toBe('ALUMNO');
      expect(body.pack.id).toBe(packId);
      expect(body.passwordTemporal).toMatch(/^[A-Za-z0-9_-]{16,}$/);
      expect(body.advertencias).toEqual([]);

      // La clave temporal sirve de verdad.
      await request(servidor)
        .post('/auth/login')
        .send({ tenantSlug: gym.slug, email: 'ana@gym.test', password: body.passwordTemporal })
        .expect(200);

      // Y el detalle ya no la devuelve.
      const detalle = await request(servidor)
        .get(`/usuarios/${body.id}`)
        .set(auth(gym.adminToken))
        .expect(200);

      expect(detalle.body).not.toHaveProperty('passwordTemporal');
    });

    it('da de alta un profesor sin pedirle nada de alumno', async () => {
      const salaId = await crearSala();

      const { body } = await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Luis Gomez', email: 'luis@gym.test', salaIds: [salaId] })
        .expect(201);

      expect(body.rol).toBe('PROFESOR');
      expect(body.advertencias).toEqual([]);
    });

    it('mandar campos de alumno al alta de profesor es 400, no un guardado silencioso', async () => {
      const salaId = await crearSala();
      const packId = await crearPack();

      // El bug de TurnoFit al reves: aqui el sistema dice que no.
      await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({
          nombreCompleto: 'Luis',
          email: 'luis2@gym.test',
          salaIds: [salaId],
          packId,
        })
        .expect(400);
    });

    it('un profesor nunca recibe un error de "clases mensuales requerido"', async () => {
      const salaId = await crearSala();

      const respuesta = await request(servidor)
        .post('/usuarios/profesores')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Luis', email: 'luis3@gym.test', salaIds: [salaId] });

      expect(respuesta.status).toBe(201);

      // El assert mira los ERRORES, no el cuerpo entero: `clasesExtra` es un
      // campo obligatorio de UsuarioDetalle para cualquier rol, asi que un
      // /clase/i sobre todo el JSON daria un falso positivo contra el contrato.
      // Lo que no puede aparecer es una validacion de clases dirigida al profesor.
      expect(respuesta.body).not.toHaveProperty('message');
      expect(respuesta.body.advertencias).toEqual([]);
      expect(JSON.stringify(respuesta.body.advertencias)).not.toMatch(/clase/i);
    });
  });

  describe('checklist 4: alumno sin salas genera un warning visible', () => {
    it('devuelve 201 con la advertencia SIN_SALAS', async () => {
      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Ana', email: 'ana2@gym.test', salaIds: [] })
        .expect(201);

      expect(body.advertencias).toEqual(
        expect.arrayContaining([expect.objectContaining({ codigo: 'SIN_SALAS' })]),
      );
    });

    it('PATCH /usuarios/:id/salas con lista vacia es 400', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumno([salaId]);

      await request(servidor)
        .patch(`/usuarios/${alumno.id}/salas`)
        .set(auth(gym.adminToken))
        .send({ salaIds: [] })
        .expect(400);
    });

    it('la ficha medica no aparece en el listado', async () => {
      const salaId = await crearSala();
      await crearAlumno([salaId], { fichaMedica: 'asma' });

      const { body } = await request(servidor)
        .get('/usuarios')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(JSON.stringify(body)).not.toContain('asma');
    });
  });

  // 5 y 6 — Turnos y cupo -------------------------------------------------

  describe('checklist 5 y 6: turno puntual, reserva manual y cupo', () => {
    it('crea un turno y le asigna una reserva', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 2 });
      const alumno = await crearAlumno([salaId]);

      const { body } = await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      expect(body.turnoId).toBe(turnoId);
      expect(body.origen).toBe('ADMIN');
      expect(body.canceladaEn).toBeNull();

      const turnos = await request(servidor).get('/turnos').set(auth(gym.adminToken)).expect(200);

      expect(turnos.body[0]).toMatchObject({ cupo: 2, reservasActivas: 1, lugaresLibres: 1 });
      expect(turnos.body[0].fecha).toBe('2026-10-05');
    });

    it('reservar un turno lleno devuelve 409 y no crea nada fuera de cupo', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(409);

      const activas = await prisma.base.reserva.count({
        where: { turnoId, canceladaEn: null },
      });
      expect(activas).toBe(1);
    });

    it('403 si el alumno no tiene acceso a la sala del turno', async () => {
      const salaA = await crearSala('Sala A');
      const salaB = await crearSala('Sala B');
      const turnoId = await crearTurno(salaB);
      const alumno = await crearAlumno([salaA]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(403);
    });

    it('CONCURRENCIA: 10 peticiones simultaneas sobre un cupo de 1 dan exactamente una 201', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });

      const alumnos = [];
      for (let i = 0; i < 10; i++) {
        alumnos.push(await crearAlumno([salaId]));
      }

      const respuestas = await Promise.all(
        alumnos.map((alumno) =>
          request(servidor)
            .post(`/turnos/${turnoId}/reservas`)
            .set(auth(gym.adminToken))
            .send({ perfilId: alumno.perfilId }),
        ),
      );

      console.log('STATUSES:', JSON.stringify(respuestas.map((r) => [r.status, r.text.slice(0, 300)])));
      const creadas = respuestas.filter((r) => r.status === 201);
      const rechazadas = respuestas.filter((r) => r.status === 409);

      // Este es EL test de la fase. Sin transaccion Serializable, aqui pasan
      // varias: todas leen "queda 1 lugar" antes de que ninguna inserte. Es la
      // misma carrera que en la Fase 0 dejaba pasar 6 de 10 refresh tokens.
      expect(creadas).toHaveLength(1);
      expect(rechazadas).toHaveLength(9);

      const enBase = await prisma.base.reserva.count({
        where: { turnoId, canceladaEn: null },
      });
      expect(enBase).toBe(1);
    });
  });

  // 7 — Cancelaciones -----------------------------------------------------

  describe('checklist 7: cancelacion recuperable y definitiva', () => {
    const prepararAlumnoConPack = async () => {
      const salaId = await crearSala();
      const packId = await crearPack({ clasesPorMes: 2 });
      const alumno = await crearAlumno([salaId], { packId });
      return { salaId, alumno };
    };

    const reservar = async (turnoId: string, perfilId: string) => {
      const { body } = await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId });
      return body;
    };

    it('RECUPERABLE devuelve la clase: la siguiente reserva no advierte pack agotado', async () => {
      const { salaId, alumno } = await prepararAlumnoConPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const t3 = await crearTurno(salaId, { fecha: '2026-10-07' });

      const r1 = await reservar(t1, alumno.perfilId);
      await reservar(t2, alumno.perfilId);

      // Consumidas 2 de 2. La tercera avisaria.
      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      const tercera = await reservar(t3, alumno.perfilId);
      expect(tercera.advertencias).toEqual([]);
    });

    it('DEFINITIVA no la devuelve: la siguiente reserva si advierte', async () => {
      const { salaId, alumno } = await prepararAlumnoConPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const t3 = await crearTurno(salaId, { fecha: '2026-10-07' });

      const r1 = await reservar(t1, alumno.perfilId);
      await reservar(t2, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=definitiva`)
        .set(auth(gym.adminToken))
        .expect(200);

      const tercera = await reservar(t3, alumno.perfilId);
      expect(tercera.advertencias).toEqual(
        expect.arrayContaining([expect.objectContaining({ codigo: 'PACK_AGOTADO' })]),
      );
    });

    it('cancelar libera el lugar del turno', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      const r1 = await reservar(turnoId, uno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(201);
    });

    it('REGRESION: un turno con reservas solo canceladas si se puede borrar', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);
      const r1 = await reservar(turnoId, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=definitiva`)
        .set(auth(gym.adminToken))
        .expect(200);

      // Antes de la migracion reserva_turno_cascade esto devolvia 500: la FK era
      // ON DELETE RESTRICT y el count de eliminar() solo mira las ACTIVAS, asi que
      // pasaba la comprobacion y despues Postgres rechazaba el DELETE.
      await request(servidor).delete(`/turnos/${turnoId}`).set(auth(gym.adminToken)).expect(204);

      const quedan = await prisma.base.reserva.count({ where: { turnoId } });
      expect(quedan).toBe(0);
    });

    it('un tipo de cancelacion invalido es 400', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);
      const r1 = await reservar(turnoId, alumno.perfilId);

      await request(servidor)
        .delete(`/reservas/${r1.id}?tipo=loquesea`)
        .set(auth(gym.adminToken))
        .expect(400);
    });
  });

  // 8 — Reasignacion ------------------------------------------------------

  describe('checklist 8: reasignar valida el cupo del destino', () => {
    it('mueve la reserva al turno destino', async () => {
      const salaId = await crearSala();
      const origen = await crearTurno(salaId, { fecha: '2026-10-05' });
      const destino = await crearTurno(salaId, { fecha: '2026-10-06' });
      const alumno = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${origen}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      const { body } = await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: destino })
        .expect(200);

      expect(body.turnoId).toBe(destino);

      const turnos = await request(servidor).get('/turnos').set(auth(gym.adminToken)).expect(200);

      const porId = Object.fromEntries(turnos.body.map((t: any) => [t.id, t]));
      expect(porId[origen].reservasActivas).toBe(0);
      expect(porId[destino].reservasActivas).toBe(1);
    });

    it('409 si el turno destino esta lleno', async () => {
      const salaId = await crearSala();
      const origen = await crearTurno(salaId, { fecha: '2026-10-05', cupo: 5 });
      const destino = await crearTurno(salaId, { fecha: '2026-10-06', cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${origen}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${destino}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(201);

      await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: destino })
        .expect(409);
    });
  });

  // 9 — Auditoria ---------------------------------------------------------

  describe('checklist 9: todo queda en historial_acciones', () => {
    it('registra alta de sala, pack, usuario, turno, reserva, cancelacion y reasignacion', async () => {
      const salaId = await crearSala();
      await crearPack();
      const t1 = await crearTurno(salaId, { fecha: '2026-10-05' });
      const t2 = await crearTurno(salaId, { fecha: '2026-10-06' });
      const alumno = await crearAlumno([salaId]);

      const { body: reserva } = await request(servidor)
        .post(`/turnos/${t1}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      await request(servidor)
        .patch(`/reservas/${reserva.id}/reasignar`)
        .set(auth(gym.adminToken))
        .send({ turnoId: t2 })
        .expect(200);

      await request(servidor)
        .delete(`/reservas/${reserva.id}?tipo=recuperable`)
        .set(auth(gym.adminToken))
        .expect(200);

      await request(servidor)
        .patch(`/usuarios/${alumno.id}/salas`)
        .set(auth(gym.adminToken))
        .send({ salaIds: [salaId] })
        .expect(200);

      const registros = await prisma.base.historialAccion.findMany({
        where: { tenantId: gym.tenantId },
      });

      const clave = registros.map((r) => `${r.entidad}:${r.accion}`);
      expect(clave).toEqual(
        expect.arrayContaining([
          'Sala:CREADA',
          'Pack:CREADA',
          'Turno:CREADA',
          'Usuario:CREADA',
          'Reserva:CREADA',
          'Reserva:REASIGNADA',
          'Reserva:CANCELADA',
          'Usuario:SALAS_ACTUALIZADAS',
        ]),
      );

      // Y siempre se sabe quien lo hizo.
      expect(registros.every((r) => r.usuarioId === gym.adminId)).toBe(true);
    });

    it('la auditoria se revierte con la operacion que falla', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId, { cupo: 1 });
      const uno = await crearAlumno([salaId]);
      const dos = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: uno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: dos.perfilId })
        .expect(409);

      // Una sola Reserva:CREADA. Si la auditoria escribiera fuera de la
      // transaccion, habria rastro de una reserva que nunca existio.
      const creadas = await prisma.base.historialAccion.count({
        where: { tenantId: gym.tenantId, entidad: 'Reserva', accion: 'CREADA' },
      });
      expect(creadas).toBe(1);
    });
  });

  // Aislamiento entre gimnasios -------------------------------------------

  describe('aislamiento entre gimnasios', () => {
    let otro: GimnasioDeTest;

    beforeEach(async () => {
      otro = await crearGimnasio(app, 'boxdos');
    });

    it('ningun gimnasio ve las salas ni los packs del otro', async () => {
      await crearSala('Sala del uno');
      await crearPack();

      const salas = await request(servidor).get('/salas').set(auth(otro.adminToken)).expect(200);
      const packs = await request(servidor).get('/packs').set(auth(otro.adminToken)).expect(200);

      expect(salas.body).toEqual([]);
      expect(packs.body).toEqual([]);
    });

    it('ningun gimnasio ve los usuarios ni los turnos del otro', async () => {
      const salaId = await crearSala();
      await crearTurno(salaId);
      await crearAlumno([salaId]);

      const usuarios = await request(servidor)
        .get('/usuarios')
        .set(auth(otro.adminToken))
        .expect(200);
      const turnos = await request(servidor).get('/turnos').set(auth(otro.adminToken)).expect(200);

      expect(usuarios.body).toEqual([]);
      expect(turnos.body).toEqual([]);
    });

    it('404 al pedir por id un recurso del otro gimnasio', async () => {
      const salaId = await crearSala();
      const alumno = await crearAlumno([salaId]);

      await request(servidor).get(`/salas/${salaId}`).set(auth(otro.adminToken)).expect(404);

      await request(servidor).get(`/usuarios/${alumno.id}`).set(auth(otro.adminToken)).expect(404);
    });

    it('no se puede reservar un turno del otro gimnasio', async () => {
      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await crearAlumno([salaId]);

      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(otro.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(404);
    });

    it('un turno con el mismo nombre en cada gimnasio no se mezcla', async () => {
      const salaUno = await crearSala('Sala');
      await crearTurno(salaUno);

      const { body: salaDos } = await request(servidor)
        .post('/salas')
        .set(auth(otro.adminToken))
        .send({ nombre: 'Sala' })
        .expect(201);

      await request(servidor)
        .post('/turnos')
        .set(auth(otro.adminToken))
        .send({
          salaId: salaDos.id,
          nombre: 'Pilates',
          fecha: '2026-10-05',
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 10,
        })
        .expect(201);

      const mios = await request(servidor).get('/turnos').set(auth(gym.adminToken)).expect(200);

      expect(mios.body).toHaveLength(1);
      expect(mios.body[0].salaId).toBe(salaUno);
    });
  });

  // Permisos --------------------------------------------------------------

  describe('permisos por rol', () => {
    const tokenDeAlumno = async (salaId: string): Promise<string> => {
      const email = `alu${Math.random().toString(36).slice(2)}@gym.test`;
      const { body } = await request(servidor)
        .post('/usuarios/alumnos')
        .set(auth(gym.adminToken))
        .send({ nombreCompleto: 'Ana', email, salaIds: [salaId] })
        .expect(201);

      const login = await request(servidor)
        .post('/auth/login')
        .send({ tenantSlug: gym.slug, email, password: body.passwordTemporal })
        .expect(200);

      return login.body.accessToken;
    };

    it('un alumno no puede crear salas, packs, turnos ni reservas', async () => {
      const salaId = await crearSala();
      const token = await tokenDeAlumno(salaId);
      const turnoId = await crearTurno(salaId);

      await request(servidor).post('/salas').set(auth(token)).send({ nombre: 'X' }).expect(403);
      await request(servidor)
        .post('/packs')
        .set(auth(token))
        .send({ nombre: 'X', tipo: 'MENSUAL' })
        .expect(403);
      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(token))
        .send({ perfilId: 'perf-x' })
        .expect(403);
      await request(servidor).get('/usuarios').set(auth(token)).expect(403);
    });

    it('un alumno no ve las salas ocultas ni las de baja', async () => {
      const visible = await crearSala('Visible');
      const { body: oculta } = await request(servidor)
        .post('/salas')
        .set(auth(gym.adminToken))
        .send({ nombre: 'Oculta', visibleAlumnos: false })
        .expect(201);

      const token = await tokenDeAlumno(visible);

      const lista = await request(servidor).get('/salas').set(auth(token)).expect(200);

      expect(lista.body.map((s: any) => s.id)).toEqual([visible]);

      await request(servidor).get(`/salas/${oculta.id}`).set(auth(token)).expect(404);
    });

    it('un alumno ve su propio detalle pero no el de otro', async () => {
      const salaId = await crearSala();
      const propio = await crearAlumno([salaId]);
      const ajeno = await crearAlumno([salaId]);

      const login = await request(servidor)
        .post('/auth/login')
        .send({
          tenantSlug: gym.slug,
          email: propio.body.email,
          password: propio.body.passwordTemporal,
        })
        .expect(200);

      const token = login.body.accessToken;

      await request(servidor).get(`/usuarios/${propio.id}`).set(auth(token)).expect(200);
      await request(servidor).get(`/usuarios/${ajeno.id}`).set(auth(token)).expect(403);
    });

    it('sin token, todo devuelve 401', async () => {
      await request(servidor).get('/salas').expect(401);
      await request(servidor).get('/turnos').expect(401);
      await request(servidor).get('/usuarios').expect(401);
    });
  });
});
