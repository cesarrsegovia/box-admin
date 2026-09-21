import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  crearProfesor,
  limpiarBaseDeDatos,
  publicarMes,
  type EntornoE2E,
  type GimnasioDeTest,
  type ProfesorDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// 2099 y no una fecha cercana: la API no publica meses pasados, y un mes
// concreto hace que los turnos generados sean contables sin depender del dia en
// que se corran los tests.
const ANIO = 2099;
const MES = 9;
// El dia 7 es siempre la PRIMERA aparicion de su dia de semana en el mes, asi
// que ese dia de semana cae exactamente cuatro veces: 7, 14, 21 y 28.
const PRIMERA_FECHA = '2099-09-07';
const DIA_SEMANA = new Date(`${PRIMERA_FECHA}T00:00:00.000Z`).getUTCDay();

interface Escenario {
  gym: GimnasioDeTest;
  salaId: string;
  otraSalaId: string;
  fati: ProfesorDeTest;
  ana: ProfesorDeTest;
  alumnoPerfilId: string;
}

describe('Fase 4 — el profesor como entidad real (e2e)', () => {
  let entorno: EntornoE2E;
  let app: INestApplication;
  let servidor: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    entorno = await crearAppDeTest();
    app = entorno.app;
    servidor = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(entorno.prisma);
  });

  async function montar(slug: string): Promise<Escenario> {
    const gym = await crearGimnasio(app, slug);

    const sala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 5 })
      .expect(201);

    const otraSala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala B', cupoBase: 5 })
      .expect(201);

    const fati = await crearProfesor(app, gym, [sala.body.id], { nombre: 'Fati Gomez' });
    const ana = await crearProfesor(app, gym, [sala.body.id], { nombre: 'Ana Ruiz' });
    const alumno = await crearAlumnoPorInvitacion(app, gym, [sala.body.id]);

    return {
      gym,
      salaId: sala.body.id,
      otraSalaId: otraSala.body.id,
      fati,
      ana,
      alumnoPerfilId: alumno.perfilId,
    };
  }

  async function darHorario(
    e: Escenario,
    perfilId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
        tarifaPorHora: '1500.00',
        ...extra,
      })
      .expect(201);

    return body.id;
  }

  async function darRutinaYPublicar(e: Escenario): Promise<void> {
    await request(servidor)
      .post('/rutinas')
      .set(auth(e.gym.adminToken))
      .send({
        perfilId: e.alumnoPerfilId,
        salaId: e.salaId,
        nombre: 'Pilates',
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(201);

    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);
  }

  async function turnosDelMes(e: Escenario, extra: Record<string, unknown> = {}) {
    const { body } = await request(servidor)
      .get('/turnos')
      .query({ desde: '2099-09-01', hasta: '2099-09-30', ...extra })
      .set(auth(e.gym.adminToken))
      .expect(200);

    return body;
  }

  // --- Punto 1 del checklist ------------------------------------------------

  it('un turno generado desde un horario trae profesorId, sin tocar el nombre', async () => {
    const e = await montar('p4-uno');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const turnos = await turnosDelMes(e);

    expect(turnos.length).toBe(4);
    for (const turno of turnos) {
      expect(turno.profesor).toEqual({ id: e.fati.perfilId, nombreCompleto: 'Fati Gomez' });
      // El hallazgo central de TurnoFit era que el vinculo vivia DENTRO del
      // nombre. Aqui el nombre no sabe nada de la profesora.
      expect(turno.nombre).toBe('Pilates');
    }
  });

  it('el horario dado de alta DESPUES de publicar rellena los turnos huerfanos', async () => {
    const e = await montar('p4-tarde');
    await darRutinaYPublicar(e);

    const antes = await turnosDelMes(e);
    expect(antes[0].profesor).toBeNull();

    await darHorario(e, e.fati.perfilId);
    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const despues = await turnosDelMes(e);
    expect(despues.every((t: any) => t.profesor?.id === e.fati.perfilId)).toBe(true);
  });

  // --- Punto 2: la suplencia -----------------------------------------------

  it('la suplencia sobrevive a republicar el mes y no toca el patron', async () => {
    const e = await montar('p4-suplencia');
    const horarioId = await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const turnoId = (await turnosDelMes(e))[0].id;

    await request(servidor)
      .patch(`/turnos/${turnoId}/profesor`)
      .set(auth(e.gym.adminToken))
      .send({ profesorId: e.ana.perfilId })
      .expect(200);

    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const despues = await request(servidor)
      .get(`/turnos/${turnoId}`)
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(despues.body.profesor.id).toBe(e.ana.perfilId);

    // Y el patron semanal sigue diciendo lo que decia.
    const horarios = await request(servidor)
      .get('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(horarios.body.find((h: any) => h.id === horarioId).profesorId).toBe(e.fati.perfilId);
  });

  // --- Punto 3: aislamiento de la vista ------------------------------------

  it('cada profesora ve unicamente sus clases', async () => {
    const e = await montar('p4-aislada');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const deFati = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.fati.token))
      .expect(200);
    expect(deFati.body.length).toBe(4);

    const deAna = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.ana.token))
      .expect(200);
    expect(deAna.body).toEqual([]);
  });

  it('un admin no tiene clases propias: 404', async () => {
    const e = await montar('p4-admin');

    await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.gym.adminToken))
      .expect(404);
  });

  // --- Punto 4: aislamiento de la lista ------------------------------------

  it('la lista de alumnos de una clase ajena devuelve 404', async () => {
    const e = await montar('p4-lista');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const clases = await request(servidor)
      .get('/mis-clases')
      .query({ desde: '2099-09-01', hasta: '2099-09-30' })
      .set(auth(e.fati.token))
      .expect(200);
    const turnoId = clases.body[0].turnoId;

    const propia = await request(servidor)
      .get(`/mis-clases/${turnoId}/alumnos`)
      .set(auth(e.fati.token))
      .expect(200);
    expect(propia.body[0]).toMatchObject({ perfilId: e.alumnoPerfilId, asistio: null });
    // Ni telefono ni ficha medica.
    expect(Object.keys(propia.body[0]).sort()).toEqual(['asistio', 'nombreCompleto', 'perfilId']);

    await request(servidor)
      .get(`/mis-clases/${turnoId}/alumnos`)
      .set(auth(e.ana.token))
      .expect(404);
  });

  // --- Punto 6: el filtro del calendario admin -----------------------------

  it('?profesorId= filtra el calendario admin', async () => {
    const e = await montar('p4-filtro');
    await darHorario(e, e.fati.perfilId);
    await darRutinaYPublicar(e);

    const deFati = await turnosDelMes(e, { profesorId: e.fati.perfilId });
    expect(deFati.length).toBe(4);

    const deAna = await turnosDelMes(e, { profesorId: e.ana.perfilId });
    expect(deAna).toEqual([]);
  });

  // --- Los dos solapes ------------------------------------------------------

  it('409 si otra profesora ya cubre esa sala, dia y hora', async () => {
    const e = await montar('p4-solape');
    await darHorario(e, e.fati.perfilId);

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.ana.perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:30',
        horaFin: '19:30',
        desde: '2099-09-01',
      })
      .expect(409);
  });

  it('409 si la misma profesora ya esta en otra sala a esa hora', async () => {
    const e = await montar('p4-doble');
    await darHorario(e, e.fati.perfilId);

    // Primero hay que darle acceso a la otra sala, o el 400 taparia el 409.
    await request(servidor)
      .patch(`/usuarios/${e.fati.usuarioId}/salas`)
      .set(auth(e.gym.adminToken))
      .send({ salaIds: [e.salaId, e.otraSalaId] })
      .expect(200);

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.fati.perfilId,
        salaId: e.otraSalaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(409);
  });

  it('asignar una profesora a una sala a la que no tiene acceso se rechaza', async () => {
    const e = await montar('p4-sin-acceso');

    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.fati.perfilId,
        salaId: e.otraSalaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2099-09-01',
      })
      .expect(400);
  });

  // --- Puntos 5 y 9: la liquidacion ----------------------------------------

  it('la liquidacion separa contratadas, dictadas y cerradas', async () => {
    const e = await montar('p4-liquidacion');
    await darHorario(e, e.fati.perfilId);

    // Un feriado sobre uno de los cuatro dias del patron.
    await request(servidor)
      .post('/ausencias')
      .set(auth(e.gym.adminToken))
      .send({ salaId: e.salaId, desde: '2099-09-21', hasta: '2099-09-21', motivo: 'Feriado' })
      .expect(201);

    await darRutinaYPublicar(e);

    const { body } = await request(servidor)
      .get(`/liquidacion/${e.fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.gym.adminToken))
      .expect(200);

    expect(body.horasCerradas).toBe('1.00');
    expect(body.minutosContratados).toBe(180);
    // El motor no genera turno el dia cerrado, asi que dictadas son los otros tres.
    expect(body.minutosDictados).toBe(180);
    expect(body.franjas.find((f: any) => f.cerrada).motivoCierre).toBe('Feriado');
    // La tarifa viaja resuelta, pero no hay ni un importe.
    expect(body.franjas[0].tarifaPorHora).toBe('1500.00');
    expect(body.franjas[0].origenTarifa).toBe('HORARIO');
    expect(JSON.stringify(body)).not.toMatch(/importe/i);
  });

  it('una profesora sin horarios devuelve ceros, no un error', async () => {
    const e = await montar('p4-sin-horarios');

    const { body } = await request(servidor)
      .get(`/liquidacion/${e.fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.gym.adminToken))
      .expect(200);

    expect(body).toMatchObject({
      minutosContratados: 0,
      minutosDictados: 0,
      horasContratadas: '0.00',
      franjas: [],
    });
  });

  it('la liquidacion la ve ADMIN_SALON, no un profesor', async () => {
    const e = await montar('p4-permiso');

    await request(servidor)
      .get(`/liquidacion/${e.fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.fati.token))
      .expect(403);
  });

  // --- Punto 8: pasar lista -------------------------------------------------

  describe('pasar lista', () => {
    /** Un turno en el pasado, creado a mano: no se pasa lista del futuro. */
    async function claseYaDada(e: Escenario): Promise<string> {
      const turno = await request(servidor)
        .post('/turnos')
        .set(auth(e.gym.adminToken))
        .send({
          salaId: e.salaId,
          nombre: 'Pilates',
          fecha: '2020-01-06',
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 5,
          profesorId: e.fati.perfilId,
        })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turno.body.id}/reservas`)
        .set(auth(e.gym.adminToken))
        .send({ perfilId: e.alumnoPerfilId })
        .expect(201);

      return turno.body.id;
    }

    it('es idempotente y marca ausente a quien no esta en la lista', async () => {
      const e = await montar('p4-lista-ok');
      const turnoId = await claseYaDada(e);

      const otro = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
      await request(servidor)
        .post(`/turnos/${turnoId}/reservas`)
        .set(auth(e.gym.adminToken))
        .send({ perfilId: otro.perfilId })
        .expect(201);

      const porPerfil = (cuerpo: any[]) =>
        Object.fromEntries(cuerpo.map((a) => [a.perfilId, a.asistio]));

      const primera = await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.alumnoPerfilId] })
        .expect(201);

      expect(porPerfil(primera.body)).toEqual({
        [e.alumnoPerfilId]: true,
        [otro.perfilId]: false,
      });

      const segunda = await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.alumnoPerfilId] })
        .expect(201);

      expect(porPerfil(segunda.body)).toEqual(porPerfil(primera.body));
    });

    it('no se puede pasar lista de una clase que no empezo', async () => {
      const e = await montar('p4-lista-futura');
      await darHorario(e, e.fati.perfilId);
      await darRutinaYPublicar(e);

      const clases = await request(servidor)
        .get('/mis-clases')
        .query({ desde: '2099-09-01', hasta: '2099-09-30' })
        .set(auth(e.fati.token))
        .expect(200);

      await request(servidor)
        .post(`/mis-clases/${clases.body[0].turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [] })
        .expect(400);
    });

    it('un perfilId sin reserva activa es 400, no un no-op', async () => {
      const e = await montar('p4-lista-intruso');
      const turnoId = await claseYaDada(e);

      await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(e.fati.token))
        .send({ presentes: [e.ana.perfilId] })
        .expect(400);
    });
  });
});
