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

  // --- La reactivacion de un horario dado de baja ---------------------------

  /**
   * EL VIAJE ENTERO DE LA REACTIVACION, contra el ValidationPipe y Postgres de
   * verdad.
   *
   * Los tests del service corren sobre un doble de Prisma, asi que no prueban
   * las dos cosas que aqui se caen de verdad si estan mal: que el
   * `@ValidateIf` del DTO deje pasar `hasta: null` sin que el whitelist se lo
   * coma —`@IsOptional` a secas tambien lo dejaba, pero el que declara la
   * intencion es este— y que la columna acepte el NULL.
   *
   * `desdeDeHoy` y no las fechas de 2099 del resto del archivo: el DELETE
   * cierra el `hasta` en HOY, y con un `desde` en 2099 la fila queda con
   * `hasta` ANTERIOR a `desde`. Ver el test de mas abajo, que documenta eso.
   */
  const HOY = new Date().toISOString().slice(0, 10);

  async function darHorarioQueYaRige(e: Escenario, perfilId: string): Promise<string> {
    const { body } = await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        // Un dia que ya paso, para que el cierre del DELETE caiga DESPUES del
        // desde y la fila quede coherente.
        desde: '2020-01-06',
      })
      .expect(201);

    return body.id;
  }

  it('la baja cierra el hasta en hoy: es la premisa de toda la reactivacion', async () => {
    const e = await montar('p4-baja-cierra');
    const id = await darHorarioQueYaRige(e, e.fati.perfilId);

    // Nace indefinido.
    const antes = await request(servidor)
      .get('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .expect(200);
    expect(antes.body.find((h: any) => h.id === id).hasta).toBeNull();

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    const despues = await request(servidor)
      .get('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .expect(200);
    const fila = despues.body.find((h: any) => h.id === id);

    expect(fila.activo).toBe(false);
    // EL DATO PERDIDO: era indefinido y ahora dice «hasta hoy». Nadie puede
    // saber, mirando esta fila, si era indefinido o si terminaba en una fecha.
    expect(fila.hasta).toBe(HOY);
  });

  it('reactivar con hasta: null vuelve a dejar la vigencia indefinida', async () => {
    const e = await montar('p4-reactivar-null');
    const id = await darHorarioQueYaRige(e, e.fati.perfilId);

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    const { body } = await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ activo: true, desde: '2020-01-06', hasta: null })
      .expect(200);

    expect(body.activo).toBe(true);
    expect(body.hasta).toBeNull();
  });

  it('reactivar sin mandar hasta CONSERVA el que escribio la baja', async () => {
    // La otra mitad del par. Con un solo test, «llego el null» y «no llego
    // nada» no se distinguen.
    const e = await montar('p4-reactivar-ausente');
    const id = await darHorarioQueYaRige(e, e.fati.perfilId);

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    const { body } = await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ activo: true })
      .expect(200);

    expect(body.activo).toBe(true);
    expect(body.hasta).toBe(HOY);
  });

  it('reactivar con una fecha pone ESA fecha', async () => {
    const e = await montar('p4-reactivar-fecha');
    const id = await darHorarioQueYaRige(e, e.fati.perfilId);

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    const { body } = await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ activo: true, hasta: '2099-12-31' })
      .expect(200);

    expect(body.hasta).toBe('2099-12-31');
  });

  /**
   * EL CASO QUE IMPORTA: mientras estuvo de baja, OTRA profesora ocupo la
   * franja. `exigirSinSolape` vuelve a correr porque `activo` queda en `true`.
   */
  it('409 si el horario reactivado ahora choca con otra profesora', async () => {
    const e = await montar('p4-reactivar-choca');
    const id = await darHorarioQueYaRige(e, e.fati.perfilId);

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    // Con el hueco libre, Ana entra: esto tiene que pasar, porque un horario de
    // baja no choca con nada.
    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: e.ana.perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio: '18:00',
        horaFin: '19:00',
        desde: '2020-01-06',
      })
      .expect(201);

    const { body } = await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ activo: true, desde: '2020-01-06', hasta: null })
      .expect(409);

    expect(body.message).toBe(
      'Ya hay otra profesora asignada a esa sala en ese dia y hora. ' +
        'Un turno tiene una sola profesora, asi que dos horarios que se pisan ' +
        'no se pueden resolver.',
    );
  });

  /**
   * LO QUE EL DELETE DEJA ROTO EN UN HORARIO QUE TODAVIA NO EMPEZO, y que ESTE
   * CAMBIO NO ARREGLA: documentado, no afirmado como correcto.
   *
   * `eliminar` escribe `hasta = hoy` sin compararlo con `desde`. En un horario
   * cargado para el futuro —`desde: 2099-09-01`, que es lo que usa el resto de
   * este archivo— la fila queda con `hasta` ANTERIOR a `desde`, y a partir de
   * ahi cualquier PATCH que no vuelva a mandar una de las dos fechas se come un
   * 400 de `exigirFechasCoherentes` aunque solo venga a cambiar la tarifa.
   *
   * La pantalla de reactivar lo esquiva porque manda SIEMPRE `desde` y `hasta`.
   * Se deja aqui escrito para que, si alguien decide arreglarlo en `eliminar`,
   * este test se caiga y lo obligue a mirar.
   */
  it('un horario FUTURO dado de baja queda con hasta anterior a desde, y eso rompe el PATCH', async () => {
    const e = await montar('p4-baja-futuro');
    // `darHorario` usa `desde: 2099-09-01`.
    const id = await darHorario(e, e.fati.perfilId);

    await request(servidor)
      .delete(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .expect(204);

    const lista = await request(servidor)
      .get('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .expect(200);
    const fila = lista.body.find((h: any) => h.id === id);
    expect(fila.hasta).toBe(HOY);
    expect(fila.hasta < fila.desde).toBe(true);

    // Y un PATCH que no toca ninguna fecha se cae por culpa de eso.
    const { body } = await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ tarifaPorHora: '2000.00' })
      .expect(400);
    expect(body.message).toBe('hasta no puede ser anterior a desde');

    // Mandando las dos fechas, que es lo que hace la pantalla de reactivar, sale.
    await request(servidor)
      .patch(`/horarios-profesor/${id}`)
      .set(auth(e.gym.adminToken))
      .send({ activo: true, desde: '2099-09-01', hasta: null })
      .expect(200);
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
    expect(body.franjas[0].tarifaPorHora).toBe('1500.00');
    expect(body.franjas[0].origenTarifa).toBe('HORARIO');
    // Hasta la Fase 6A esta linea afirmaba que NO habia ni un importe. La
    // afirmacion caduco con la fase: la tarifa que viajaba resuelta ahora se
    // multiplica, y la liquidacion llega con su dinero calculado. Se invierte en
    // vez de borrarse para que el endpoint siga teniendo quien lo mire.
    // Tres horas dictadas a 1500.00 y una cerrada, que se calcula y no se paga.
    expect(body.importes.dictadas.texto).toBe('4500.00');
    expect(body.importes.aPagar.texto).toBe('4500.00');
    expect(body.importes.cerradas.texto).toBe('1500.00');
    expect(body.importes.contratadasSinDictar.centavos).toBe(0);
    expect(body.importes.minutosSinTarifa).toBe(0);
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
