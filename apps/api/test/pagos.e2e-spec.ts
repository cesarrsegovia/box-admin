import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  limpiarBaseDeDatos,
  type EntornoE2E,
  type GimnasioDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Un periodo que no caduca durante la vida del test. */
const FUTURO = '2099-12-31';

describe('Fase 5A — el ciclo de cobro (e2e)', () => {
  let entorno: EntornoE2E;
  let app: INestApplication;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;
  let salaId: string;

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
    gym = await crearGimnasio(app, `p5a${Date.now()}`);

    const sala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 5 })
      .expect(201);
    salaId = sala.body.id;
  });

  async function alumno() {
    return await crearAlumnoPorInvitacion(app, gym, [salaId]);
  }

  async function detalleDe(usuarioId: string) {
    const { body } = await request(servidor)
      .get(`/usuarios/${usuarioId}`)
      .set(auth(gym.adminToken))
      .expect(200);

    return body;
  }

  async function pagar(perfilId: string, extra: Record<string, unknown> = {}) {
    const { body } = await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId,
        monto: '25000.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
        ...extra,
      })
      .expect(201);

    return body;
  }

  async function pagosDe(perfilId: string) {
    const { body } = await request(servidor)
      .get('/pagos')
      .query({ perfilId })
      .set(auth(gym.adminToken))
      .expect(200);

    return body;
  }

  it('un alumno recien dado de alta NO esta al dia', async () => {
    const a = await alumno();

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('un pago manual sin comprobante lo pone al dia', async () => {
    const a = await alumno();

    const pago = await pagar(a.perfilId, { nota: 'pago en mano' });

    // El monto vuelve con dos decimales, como string: es dinero.
    expect(pago.monto).toBe('25000.00');
    expect(pago.registradoPor).toBe(gym.adminId);
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);
  });

  it('el estado tambien sale en el LISTADO, no solo en el detalle', async () => {
    const a = await alumno();
    await pagar(a.perfilId);

    const { body } = await request(servidor)
      .get('/usuarios')
      .query({ tipo: 'alumno' })
      .set(auth(gym.adminToken))
      .expect(200);

    expect(body.find((u: any) => u.id === a.usuarioId).pagoAlDia).toBe(true);
  });

  it('un pago VENCIDO no pone al dia, sin que nadie toque nada', async () => {
    // El corazon de la fase: el estado caduca solo.
    const a = await alumno();
    await pagar(a.perfilId, { cubreDesde: '2020-01-01', cubreHasta: '2020-01-31' });

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('una sena no pone al dia', async () => {
    const a = await alumno();
    await pagar(a.perfilId, { monto: '5000.00', esSena: true });

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);
  });

  it('anular un pago lo saca del calculo sin borrar la fila', async () => {
    const a = await alumno();
    const pago = await pagar(a.perfilId);
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);

    await request(servidor).patch(`/pagos/${pago.id}/anular`).set(auth(gym.adminToken)).expect(200);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(false);

    // La fila sigue ahi: es dinero, y borrarla reescribiria la caja.
    const listado = await pagosDe(a.perfilId);
    expect(listado).toHaveLength(1);
    expect(listado[0].anuladoEn).not.toBeNull();
  });

  it('anular dos veces el mismo pago es 409', async () => {
    const a = await alumno();
    const pago = await pagar(a.perfilId);

    await request(servidor).patch(`/pagos/${pago.id}/anular`).set(auth(gym.adminToken)).expect(200);
    await request(servidor).patch(`/pagos/${pago.id}/anular`).set(auth(gym.adminToken)).expect(409);
  });

  it('anular un pago no lo puede hacer cualquiera', async () => {
    const a = await alumno();
    const pago = await pagar(a.perfilId);

    await request(servidor).patch(`/pagos/${pago.id}/anular`).set(auth(a.token)).expect(403);
  });

  it('la cortesia del admin pone al dia con importe cero', async () => {
    const a = await alumno();

    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: true, cubreHasta: FUTURO, nota: 'beca' })
      .expect(200);

    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);

    const pagos = await pagosDe(a.perfilId);
    expect(pagos[0]).toMatchObject({ monto: '0.00', metodo: 'CORTESIA' });
  });

  it('quitar el estado anula la cortesia y NO el pago real', async () => {
    const a = await alumno();
    await pagar(a.perfilId);
    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: true, cubreHasta: FUTURO })
      .expect(200);

    await request(servidor)
      .patch(`/usuarios/${a.usuarioId}/estado-pago`)
      .set(auth(gym.adminToken))
      .send({ alDia: false })
      .expect(200);

    const pagos = await pagosDe(a.perfilId);
    const cortesia = pagos.find((p: any) => p.metodo === 'CORTESIA');
    const real = pagos.find((p: any) => p.metodo === 'EFECTIVO');
    expect(cortesia.anuladoEn).not.toBeNull();
    expect(real.anuladoEn).toBeNull();
    // Y sigue al dia, porque el pago de verdad nunca se toco.
    expect((await detalleDe(a.usuarioId)).pagoAlDia).toBe(true);
  });

  it('el alumno ve su propio estado en mi-pack', async () => {
    const a = await alumno();
    await pagar(a.perfilId);

    const { body } = await request(servidor).get('/mi-pack').set(auth(a.token)).expect(200);

    expect(body.pagoAlDia).toBe(true);
  });

  it('pagoAlDia ya no se puede declarar en el alta', async () => {
    // forbidNonWhitelisted: mandar un campo que ya no existe es 400, no un
    // campo ignorado en silencio.
    await request(servidor)
      .post('/usuarios/alumnos')
      .set(auth(gym.adminToken))
      .send({
        nombreCompleto: 'Quien Sea',
        email: `declara-${Date.now()}@test.io`,
        salaIds: [salaId],
        pagoAlDia: true,
      })
      .expect(400);
  });

  it('un pago no se puede enlazar al comprobante de otro alumno', async () => {
    const uno = await alumno();
    const otro = await alumno();

    const comprobante = await request(servidor)
      .post('/comprobantes')
      .set(auth(uno.token))
      .send({ nombreOriginal: 'x.pdf', tipoMime: 'application/pdf' })
      .expect(201);

    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: otro.perfilId,
        monto: '1.00',
        metodo: 'TRANSFERENCIA',
        cubreDesde: '2020-01-01',
        cubreHasta: FUTURO,
        comprobanteId: comprobante.body.comprobante.id,
      })
      .expect(400);
  });

  it('el periodo invertido es 400', async () => {
    const a = await alumno();

    await request(servidor)
      .post('/pagos')
      .set(auth(gym.adminToken))
      .send({
        perfilId: a.perfilId,
        monto: '1.00',
        metodo: 'EFECTIVO',
        cubreDesde: '2026-09-30',
        cubreHasta: '2026-09-01',
      })
      .expect(400);
  });
});
