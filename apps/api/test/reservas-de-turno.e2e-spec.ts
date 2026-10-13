/**
 * Los e2e de `GET /turnos/:turnoId/reservas` (Fase 9, tarea 1).
 *
 * POR QUE ESTA SUITE NO ES UN EXTRA. El endpoint es el que le da al admin los
 * ids con los que ya podia cancelar y reasignar, y hasta ahora no tenia de
 * donde sacarlos. Y lo que se prueba aqui NO LO PUEDE VER NINGUN UNITARIO:
 *
 * 1. QUE LA RUTA EXISTE Y RESPONDE. La Fase 6B dejo la regla escrita con
 *    sangre: un doble escrito a mano solo sabe lo que su autor creia. Alli dos
 *    funciones centrales resultaron no haber funcionado nunca con 1290
 *    unitarios en verde, porque los dobles no eran perezosos y tenian metodos
 *    que la extension real rechaza.
 * 2. EL `orderBy` DE VERDAD. En el unitario solo se puede comprobar que se le
 *    PIDE el orden a Postgres: el doble devuelve el array que le pongas, asi
 *    que ordenar alli seria autorreferencial. Aqui los dos alumnos se siembran
 *    AL REVES del orden esperado.
 * 3. EL AISLAMIENTO POR INQUILINO. Lo pone la extension de Prisma desde el
 *    contexto de la peticion, no el handler. Un doble no tiene extension.
 * 4. QUE LA LISTA ES DEL TURNO PEDIDO Y NO DE TODOS. Por eso el gimnasio tiene
 *    DOS turnos con reservas distintas y no uno: con un solo turno sembrado, un
 *    `where` que se dejara de filtrar por turnoId seguiria en verde. Es el caso
 *    ciego clasico —el test de borrado con un solo registro, que no distingue
 *    "borro el suyo" de "borro todos"— y aqui estaria a un descuido de distancia.
 */

import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAdminOperativo,
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  type AdminOperativoDeTest,
  type AlumnoDeTest,
  type EntornoE2E,
  type GimnasioDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Las claves del contrato `ReservaEnTurno`, ya en el orden que da `.sort()`. */
const CLAVES_DEL_CONTRATO = [
  'asistio',
  'cancelacionTipo',
  'canceladaEn',
  'esPrueba',
  'id',
  'nombreCompleto',
  'origen',
  'pagoRealizado',
  'perfilId',
];

interface Escenario {
  gym: GimnasioDeTest;
  /** Un ADMIN_OPERATIVO, que es EL ROL MINIMO que pide la ruta. */
  operativo: AdminOperativoDeTest;
  salaId: string;
  /** El turno bajo prueba: Zoe y Ana reservadas, en ese orden de insercion. */
  turnoId: string;
  /** Otro turno del MISMO gimnasio, con su propia reserva. */
  otroTurnoId: string;
  zoePerfilId: string;
  anaPerfilId: string;
  /** El alumno con token, para el caso del 403. */
  alumno: AlumnoDeTest;
}

describe('Fase 9 — las reservas de un turno para el admin (e2e)', () => {
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

  async function crearSala(gym: GimnasioDeTest, nombre = 'Sala A'): Promise<string> {
    const { body } = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre, cupoBase: 10 })
      .expect(201);
    return body.id;
  }

  async function crearTurno(
    gym: GimnasioDeTest,
    salaId: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/turnos')
      .set(auth(gym.adminToken))
      .send({
        salaId,
        nombre: 'Pilates',
        fecha: '2099-09-07',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 10,
        ...extra,
      })
      .expect(201);
    return body.id;
  }

  /** Un alumno con NOMBRE PROPIO: el orden del listado se juega en el nombre. */
  async function crearAlumno(
    gym: GimnasioDeTest,
    salaId: string,
    nombreCompleto: string,
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/usuarios/alumnos')
      .set(auth(gym.adminToken))
      .send({
        nombreCompleto,
        email: `${Math.random().toString(36).slice(2)}@alumnos.test`,
        salaIds: [salaId],
      })
      .expect(201);
    return body.perfilId;
  }

  async function reservar(gym: GimnasioDeTest, turnoId: string, perfilId: string): Promise<string> {
    const { body } = await request(servidor)
      .post(`/turnos/${turnoId}/reservas`)
      .set(auth(gym.adminToken))
      .send({ perfilId })
      .expect(201);
    return body.id;
  }

  async function montar(slug: string): Promise<Escenario> {
    const gym = await crearGimnasio(app, slug);
    const operativo = await crearAdminOperativo(app, entorno.prisma, gym);
    const salaId = await crearSala(gym);

    const turnoId = await crearTurno(gym, salaId);
    const otroTurnoId = await crearTurno(gym, salaId, { horaInicio: '20:00', horaFin: '21:00' });

    // Zoe PRIMERO y Ana DESPUES, a proposito: si el endpoint devolviera el
    // orden de insercion en vez del alfabetico, el caso del orden caeria.
    const zoePerfilId = await crearAlumno(gym, salaId, 'Zoe Vera');
    const anaPerfilId = await crearAlumno(gym, salaId, 'Ana Beltran');
    await reservar(gym, turnoId, zoePerfilId);
    await reservar(gym, turnoId, anaPerfilId);

    // La reserva del OTRO turno, con un tercer alumno: ninguna de las dos
    // listas puede contener a la otra.
    const otroPerfilId = await crearAlumno(gym, salaId, 'Beto Lopez');
    await reservar(gym, otroTurnoId, otroPerfilId);

    const alumno = await crearAlumnoPorInvitacion(app, gym, [salaId]);

    return { gym, operativo, salaId, turnoId, otroTurnoId, zoePerfilId, anaPerfilId, alumno };
  }

  const listar = (e: Escenario, turnoId: string, token = e.operativo.token) =>
    request(servidor).get(`/turnos/${turnoId}/reservas`).set(auth(token));

  it('un ADMIN_OPERATIVO ve las reservas del turno con el nombre resuelto', async () => {
    const e = await montar('boxlista');

    const { body } = await listar(e, e.turnoId).expect(200);

    expect(body).toHaveLength(2);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          perfilId: e.zoePerfilId,
          nombreCompleto: 'Zoe Vera',
          origen: 'ADMIN',
          canceladaEn: null,
          cancelacionTipo: null,
          asistio: null,
        }),
        expect.objectContaining({ perfilId: e.anaPerfilId, nombreCompleto: 'Ana Beltran' }),
      ]),
    );

    // EL ID DE LA RESERVA, que es la razon de ser del endpoint: con el, los dos
    // endpoints que ya existian se pueden usar de verdad.
    const ana = body.find((fila: { perfilId: string }) => fila.perfilId === e.anaPerfilId);
    await request(servidor)
      .delete(`/reservas/${ana.id}?tipo=recuperable`)
      .set(auth(e.operativo.token))
      .expect(200);
  });

  it('un ALUMNO recibe 403', async () => {
    const e = await montar('boxalumno');

    // El alumno de este gimnasio, con sesion valida y acceso a la sala: lo
    // unico que lo para es el rol. La lista lleva los nombres y el consumo de
    // pack de sus compañeros.
    await listar(e, e.turnoId, e.alumno.token).expect(403);
  });

  it('el turno de otro gimnasio da 404', async () => {
    const e = await montar('boxuno');
    const ajeno = await crearGimnasio(app, 'boxdos');
    const salaAjena = await crearSala(ajeno, 'Sala del otro');
    const turnoAjeno = await crearTurno(ajeno, salaAjena);
    const perfilAjeno = await crearAlumno(ajeno, salaAjena, 'Ajena Perez');
    await reservar(ajeno, turnoAjeno, perfilAjeno);

    // 404 y no 403: para este cliente de Prisma el turno NO EXISTE, y contestar
    // 403 ya seria confirmar que ese id es de alguien.
    const respuesta = await listar(e, turnoAjeno).expect(404);
    expect(JSON.stringify(respuesta.body)).not.toContain('Ajena');
  });

  it('el cuerpo trae EXACTAMENTE las claves del contrato', async () => {
    const e = await montar('boxclaves');

    const { body } = await listar(e, e.turnoId).expect(200);

    for (const fila of body) {
      expect(Object.keys(fila).sort()).toEqual(CLAVES_DEL_CONTRATO);
    }
    // Dicho tambien sobre el cuerpo entero: el tenantId es el id interno del
    // gimnasio y no tiene nada que hacer en una respuesta.
    expect(JSON.stringify(body)).not.toContain(e.gym.tenantId);
  });

  it('ordena por nombre, no por orden de insercion', async () => {
    const e = await montar('boxorden');

    const { body } = await listar(e, e.turnoId).expect(200);

    expect(body.map((fila: { nombreCompleto: string }) => fila.nombreCompleto)).toEqual([
      'Ana Beltran',
      'Zoe Vera',
    ]);
  });

  it('solo las reservas DE ESE turno, no las de los demas del gimnasio', async () => {
    const e = await montar('boxturno');

    const delTurno = await listar(e, e.turnoId).expect(200);
    const delOtro = await listar(e, e.otroTurnoId).expect(200);

    expect(delTurno.body.map((f: { nombreCompleto: string }) => f.nombreCompleto)).toEqual([
      'Ana Beltran',
      'Zoe Vera',
    ]);
    expect(delOtro.body.map((f: { nombreCompleto: string }) => f.nombreCompleto)).toEqual([
      'Beto Lopez',
    ]);
  });

  it('devuelve TAMBIEN las canceladas, con su tipo', async () => {
    const e = await montar('boxcancel');

    const antes = await listar(e, e.turnoId).expect(200);
    const zoe = antes.body.find((f: { perfilId: string }) => f.perfilId === e.zoePerfilId);

    await request(servidor)
      .delete(`/reservas/${zoe.id}?tipo=definitiva`)
      .set(auth(e.operativo.token))
      .expect(200);

    const { body } = await listar(e, e.turnoId).expect(200);

    // Sigue siendo una lista de DOS: la cancelada no desaparece de la ficha.
    expect(body).toHaveLength(2);
    const cancelada = body.find((f: { id: string }) => f.id === zoe.id);
    expect(cancelada.cancelacionTipo).toBe('DEFINITIVA');
    expect(typeof cancelada.canceladaEn).toBe('string');
    expect(new Date(cancelada.canceladaEn).getTime()).not.toBeNaN();
  });

  it('un turno sin reservas da 200 con lista vacia, y uno inexistente 404', async () => {
    const e = await montar('boxvacio');
    const vacio = await crearTurno(e.gym, e.salaId, { horaInicio: '07:00', horaFin: '08:00' });

    await listar(e, vacio).expect(200).expect([]);

    // El par que justifica el 404: las dos respuestas tienen que distinguirse.
    // El id es un `cuid` en una columna de texto, asi que un id inventado llega
    // al `where` tal cual y no revienta antes por el tipo.
    await listar(e, 'turno-que-no-existe').expect(404);
  });
});
