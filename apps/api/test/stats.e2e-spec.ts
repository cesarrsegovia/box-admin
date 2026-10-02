/**
 * Los e2e de la Fase 6A: que los numeros de la analitica CUADREN.
 *
 * No es una suite de humo. El criterio de exito que el PDF pone en la portada
 * es que los reportes coincidan con los datos reales, asi que cada caso de aqui
 * compara una cifra del endpoint contra una suma hecha POR FUERA del codigo que
 * la produce: a mano en el propio test, o contra el otro endpoint que tiene que
 * dar lo mismo.
 *
 * ⚠️ NO CORRER CON OTRA API VIVA CONTRA EL MISMO REDIS. Dos de estos casos
 * publican un mes —y eso es un job del worker—, y el caso de la invalidacion va
 * contra el Redis de verdad: una segunda instancia se lleva los jobs y vuelve la
 * suite intermitente.
 */

import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAdminOperativo,
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

// El mes devengado, el mismo que usa profesor.e2e-spec.ts y por el mismo
// motivo: la API no publica meses pasados, y el dia 7 es siempre la PRIMERA
// aparicion de su dia de semana, asi que ese dia cae exactamente cuatro veces
// en el mes (7, 14, 21 y 28). Cuatro clases de una hora, contables sin depender
// del dia en que se corran los tests.
const ANIO = 2099;
const MES = 9;
const DIA_SEMANA = new Date('2099-09-07T00:00:00.000Z').getUTCDay();

/**
 * El mes de CAJA, que no puede ser 2099.
 *
 * `cobrado` se cuenta por `Pago.createdAt`, asi que un pago cargado por la API
 * cae siempre en el mes de hoy: preguntar por 2099-09 devolveria cero pagos
 * hiciera lo que hiciera el test. Y va en UTC porque `pagosDelMes` corta con
 * `primerDiaDelMesUtc`: con la hora local, el ultimo dia del mes a la noche en
 * Argentina el test pediria un mes y el filtro miraria el otro.
 */
const HOY = new Date();
const ANIO_CAJA = HOY.getUTCFullYear();
const MES_CAJA = HOY.getUTCMonth() + 1;

/** Un periodo de cobertura que no caduca durante la vida del test. */
const CUBRE = { cubreDesde: '2020-01-01', cubreHasta: '2099-12-31' };

/**
 * Centavos a partir del texto, SIN pasar por un float y SIN pasar por `src`.
 *
 * Es la mitad del valor de esta suite: si el test llamara a `aCentavos` del
 * codigo de produccion, estaria preguntandole al mismo programa que esta
 * probando cuanto suman sus propios pagos. Multiplicar por 100 un `Number`
 * tampoco vale —`18500.5 * 100` no es exactamente 1850050 en binario—, asi que
 * se parte el string y se suman enteros.
 */
function centavosDe(texto: string): number {
  const [enteros, decimales = ''] = texto.split('.');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0'));
}

/** Un pago tal y como el test lo va a cargar, para poder sumarlo a mano. */
interface PagoDeTest {
  perfilId: string;
  monto: string;
  metodo: 'EFECTIVO' | 'TRANSFERENCIA' | 'CORTESIA' | 'OTRO';
  anulado?: boolean;
}

interface Escenario {
  gym: GimnasioDeTest;
  salaId: string;
}

describe('Fase 6A — la analitica cuadra contra los datos (e2e)', () => {
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

    return { gym, salaId: sala.body.id };
  }

  /** Carga un pago por la API y, si toca, lo anula por la API. */
  async function cargarPago(e: Escenario, pago: PagoDeTest): Promise<void> {
    const { body } = await request(servidor)
      .post('/pagos')
      .set(auth(e.gym.adminToken))
      .send({ perfilId: pago.perfilId, monto: pago.monto, metodo: pago.metodo, ...CUBRE })
      .expect(201);

    if (pago.anulado === true) {
      await request(servidor)
        .patch(`/pagos/${body.id}/anular`)
        .set(auth(e.gym.adminToken))
        .expect(200);
    }
  }

  async function caja(e: Escenario, anio = ANIO_CAJA, mes = MES_CAJA) {
    const { body } = await request(servidor)
      .get('/stats/caja')
      .query({ anio, mes })
      .set(auth(e.gym.adminToken))
      .expect(200);

    return body;
  }

  async function liquidacionDe(e: Escenario, perfilId: string) {
    const { body } = await request(servidor)
      .get(`/liquidacion/${perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(e.gym.adminToken))
      .expect(200);

    return body;
  }

  /** Un patron semanal de una hora con su tarifa, para una profesora. */
  async function darHorario(
    e: Escenario,
    profesor: ProfesorDeTest,
    horaInicio: string,
    horaFin: string,
    tarifaPorHora: string,
  ): Promise<void> {
    await request(servidor)
      .post('/horarios-profesor')
      .set(auth(e.gym.adminToken))
      .send({
        profesorId: profesor.perfilId,
        salaId: e.salaId,
        diaSemana: DIA_SEMANA,
        horaInicio,
        horaFin,
        desde: '2099-09-01',
        tarifaPorHora,
      })
      .expect(201);
  }

  /** Una rutina fija: sin ella el motor no genera ni un turno, y sin turnos no hay horas dictadas. */
  async function darRutina(e: Escenario, perfilId: string, horaInicio: string, horaFin: string) {
    await request(servidor)
      .post('/rutinas')
      .set(auth(e.gym.adminToken))
      .send({
        perfilId,
        salaId: e.salaId,
        nombre: 'Pilates',
        diaSemana: DIA_SEMANA,
        horaInicio,
        horaFin,
        desde: '2099-09-01',
      })
      .expect(201);
  }

  // --- 1. La caja contra la suma de Pago -----------------------------------

  it('la caja cuadra exactamente contra la suma de Pago del periodo', async () => {
    const e = await montar('s6a-caja');
    const uno = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
    const dos = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
    const tres = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);

    // Estas cuatro filas son la verdad del test. Todo lo que se afirma abajo
    // sale de sumarlas aqui, nunca de preguntarle al reporte.
    const pagos: PagoDeTest[] = [
      { perfilId: uno.perfilId, monto: '25000.00', metodo: 'EFECTIVO' },
      { perfilId: dos.perfilId, monto: '18500.50', metodo: 'TRANSFERENCIA' },
      // Una cortesia con monto REAL, no cero: es el caso que distingue
      // `bonificado` de `cobrado`. Con una cortesia de 0.00 los dos numeros
      // cuadrarian aunque el reporte las sumara mal.
      { perfilId: tres.perfilId, monto: '7000.00', metodo: 'CORTESIA' },
      // Y uno anulado, que la fila sigue estando y no se cuenta.
      { perfilId: uno.perfilId, monto: '9999.99', metodo: 'EFECTIVO', anulado: true },
    ];

    for (const pago of pagos) await cargarPago(e, pago);

    const vivos = pagos.filter((p) => p.anulado !== true);
    const esperadoCobrado = vivos
      .filter((p) => p.metodo !== 'CORTESIA')
      .reduce((total, p) => total + centavosDe(p.monto), 0);
    const esperadoBonificado = vivos
      .filter((p) => p.metodo === 'CORTESIA')
      .reduce((total, p) => total + centavosDe(p.monto), 0);

    const body = await caja(e);

    expect(body.cobrado.centavos).toBe(esperadoCobrado);
    expect(body.cobrado.texto).toBe('43500.50');
    expect(body.bonificado.centavos).toBe(esperadoBonificado);
    expect(body.bonificado.texto).toBe('7000.00');

    // El desglose tiene que sumar el total: si no, uno de los dos miente.
    const porMetodo = Object.fromEntries(
      body.porMetodo.map((fila: any) => [fila.metodo, fila.importe.centavos]),
    );
    expect(porMetodo).toEqual({ EFECTIVO: 2_500_000, TRANSFERENCIA: 1_850_050 });
    expect(body.porMetodo.reduce((t: number, f: any) => t + f.importe.centavos, 0)).toBe(
      esperadoCobrado,
    );

    // Sin profesoras no hay costo, asi que el margen es lo cobrado pelado.
    expect(body.costoProfesoras.centavos).toBe(0);
    expect(body.margen.centavos).toBe(esperadoCobrado);
  });

  // --- 2. El cuadre que la spec promete "por construccion" -----------------

  it('el costo de profesoras de la caja coincide con la suma de las liquidaciones', async () => {
    const e = await montar('s6a-costo');
    const fati = await crearProfesor(app, e.gym, [e.salaId], { nombre: 'Fati Gomez' });
    const ana = await crearProfesor(app, e.gym, [e.salaId], { nombre: 'Ana Ruiz' });

    // Dos franjas que no se solapan, con tarifas distintas: si el costo saliera
    // de multiplicar las horas totales por una sola tarifa, no cuadraria.
    await darHorario(e, fati, '18:00', '19:00', '1500.00');
    await darHorario(e, ana, '19:00', '20:00', '2000.00');

    const alumnoUno = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
    const alumnoDos = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
    await darRutina(e, alumnoUno.perfilId, '18:00', '19:00');
    await darRutina(e, alumnoDos.perfilId, '19:00', '20:00');
    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const deFati = await liquidacionDe(e, fati.perfilId);
    const deAna = await liquidacionDe(e, ana.perfilId);
    const body = await caja(e, ANIO, MES);

    // El cuadre, que es el punto entero del caso.
    expect(body.costoProfesoras.centavos).toBe(
      deFati.importes.aPagar.centavos + deAna.importes.aPagar.centavos,
    );

    // Y que no sea el cuadre trivial de dos ceros: cuatro clases de una hora a
    // 1500 son 6000, y cuatro a 2000 son 8000.
    expect(deFati.importes.aPagar.texto).toBe('6000.00');
    expect(deAna.importes.aPagar.texto).toBe('8000.00');
    expect(body.costoProfesoras.texto).toBe('14000.00');

    // Ningun pago cayo en 2099-09, asi que el margen se va a rojo: el costo se
    // RESTA, y el numero tiene que poder decirlo.
    expect(body.cobrado.centavos).toBe(0);
    expect(body.margen.centavos).toBe(-1_400_000);
    expect(body.margen.texto).toBe('-14000.00');
  });

  // --- 3. Horas Y importes --------------------------------------------------

  it('la liquidacion devuelve horas Y importes', async () => {
    const e = await montar('s6a-liquidacion');
    const fati = await crearProfesor(app, e.gym, [e.salaId], { nombre: 'Fati Gomez' });
    await darHorario(e, fati, '18:00', '19:00', '1500.00');

    const alumno = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);
    await darRutina(e, alumno.perfilId, '18:00', '19:00');
    await publicarMes(app, e.gym.adminToken, e.salaId, ANIO, MES);

    const body = await liquidacionDe(e, fati.perfilId);

    // Las horas, como ya hacia el e2e de la Fase 4.
    expect(body.minutosDictados).toBe(240);
    expect(body.horasDictadas).toBe('4.00');
    expect(body.horasContratadas).toBe('4.00');
    expect(body.franjas[0].tarifaPorHora).toBe('1500.00');

    // Y los importes, que son lo que agrega la 6A: cuatro horas por 1500.
    expect(body.importes.dictadas.texto).toBe('6000.00');
    expect(body.importes.aPagar.texto).toBe('6000.00');
    expect(body.importes.aPagar.centavos).toBe(600_000);
    expect(body.importes.cerradas.centavos).toBe(0);
    expect(body.importes.contratadasSinDictar.centavos).toBe(0);
    // Si esto fuera mayor que cero, los 6000 serian un numero incompleto
    // presentado como completo.
    expect(body.importes.minutosSinTarifa).toBe(0);
  });

  // --- 4. La invalidacion, contra el Redis de verdad ------------------------

  it('un pago recien cargado aparece en la caja de inmediato', async () => {
    const e = await montar('s6a-invalidacion');
    const alumno = await crearAlumnoPorInvitacion(app, e.gym, [e.salaId]);

    // El primer GET deja el cero CACHEADO. Sin el, el segundo podria acertar
    // simplemente porque nunca hubo nada guardado que invalidar.
    expect((await caja(e)).cobrado.centavos).toBe(0);

    await cargarPago(e, { perfilId: alumno.perfilId, monto: '12345.67', metodo: 'EFECTIVO' });

    // Sin esperas ni reintentos: el contador de version se incrementa dentro
    // del propio POST, asi que el GET siguiente ya tiene que ver el cobro.
    const despues = await caja(e);
    expect(despues.cobrado.centavos).toBe(centavosDe('12345.67'));
    expect(despues.cobrado.texto).toBe('12345.67');
  });

  // --- 5. Los roles ---------------------------------------------------------

  it('ADMIN_OPERATIVO no puede ver la caja ni la liquidacion', async () => {
    const e = await montar('s6a-rol-403');
    const fati = await crearProfesor(app, e.gym, [e.salaId]);
    const operativo = await crearAdminOperativo(app, entorno.prisma, e.gym);

    await request(servidor)
      .get('/stats/caja')
      .query({ anio: ANIO_CAJA, mes: MES_CAJA })
      .set(auth(operativo.token))
      .expect(403);

    await request(servidor)
      .get(`/liquidacion/${fati.perfilId}`)
      .query({ anio: ANIO, mes: MES })
      .set(auth(operativo.token))
      .expect(403);
  });

  it('ADMIN_OPERATIVO si puede ver el operativo', async () => {
    // Sin este caso, los dos 403 de arriba podrian ser porque el rol no sirve
    // para nada en vez de porque esos dos endpoints ensenan dinero.
    const e = await montar('s6a-rol-200');
    const operativo = await crearAdminOperativo(app, entorno.prisma, e.gym);

    const { body } = await request(servidor)
      .get('/stats/operativo')
      .query({ anio: ANIO, mes: MES })
      .set(auth(operativo.token))
      .expect(200);

    expect(body.actual).toMatchObject({ anio: ANIO, mes: MES });
    expect(body.trimestre).toHaveLength(3);
  });
});
