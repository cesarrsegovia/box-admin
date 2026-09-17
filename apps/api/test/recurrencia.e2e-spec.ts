import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import * as request from 'supertest';
import {
  crearAppDeTest,
  crearGimnasio,
  esperarPublicacion,
  limpiarBaseDeDatos,
  type GimnasioDeTest,
} from './helpers';
import { GENERACION_MES_QUEUE } from '../src/jobs/generacion-mes/cola';
import type { PrismaService } from '../src/prisma/prisma.service';

describe('Fase 2 — motor de recurrencia (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let cola: Queue;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let gym: GimnasioDeTest;

  // Un mes futuro fijo, para que los tests no caduquen. 2099-10 tiene cuatro
  // martes: 6, 13, 20 y 27.
  const ANIO = 2099;
  const MES = 10;
  const MARTES = ['2099-10-06', '2099-10-13', '2099-10-20', '2099-10-27'];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const entorno = await crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
    servidor = app.getHttpServer();
    cola = app.get<Queue>(getQueueToken(GENERACION_MES_QUEUE));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await limpiarBaseDeDatos(prisma);
    // Los jobs viven en Redis, no en Postgres: truncar tablas no los borra, y
    // uno rezagado de otra corrida enturbiaria el sondeo de estado.
    await cola.obliterate({ force: true });
    gym = await crearGimnasio(app, 'boxrec');
  });

  // Helpers locales -------------------------------------------------------

  /**
   * Siempre con `cupoBase`: sin el, el planificador no tiene de donde sacar el
   * cupo del turno nuevo y devuelve SALA_SIN_CUPO_BASE, que haria fallar todos
   * los casos por una razon que no es la que se esta probando.
   */
  const crearSala = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const { body } = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 10, ...extra })
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
  ): Promise<{ id: string; perfilId: string }> => {
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
    return { id: body.id, perfilId: body.perfilId };
  };

  /** `horaFin` sale de sumar una hora a `horaInicio`, salvo que se pase a mano. */
  const unaHoraMasTarde = (hora: string): string =>
    `${String(Number(hora.slice(0, 2)) + 1).padStart(2, '0')}:${hora.slice(3)}`;

  const crearRutina = async (
    perfilId: string,
    salaId: string,
    diaSemana: number,
    horaInicio: string,
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, any>> => {
    const { body } = await request(servidor)
      .post('/rutinas')
      .set(auth(gym.adminToken))
      .send({
        perfilId,
        salaId,
        nombre: 'Pilates',
        diaSemana,
        horaInicio,
        horaFin: unaHoraMasTarde(horaInicio),
        // Antes del mes que se planifica: la rutina ya esta vigente cuando llega.
        desde: '2099-01-01',
        ...extra,
      })
      .expect(201);
    return body;
  };

  const crearAusencia = async (cuerpo: Record<string, unknown>): Promise<Record<string, any>> => {
    const { body } = await request(servidor)
      .post('/ausencias')
      .set(auth(gym.adminToken))
      .send(cuerpo)
      .expect(201);
    return body;
  };

  const crearVacacion = async (
    perfilId: string,
    desde: string,
    hasta: string,
  ): Promise<Record<string, any>> => {
    const { body } = await request(servidor)
      .post('/vacaciones-alumnos')
      .set(auth(gym.adminToken))
      .send({ perfilId, desde, hasta })
      .expect(201);
    return body;
  };

  const previsualizar = async (
    salaId: string,
    anio = ANIO,
    mes = MES,
  ): Promise<Record<string, any>> => {
    const { body } = await request(servidor)
      .post(`/calendario/${salaId}/${anio}/${mes}/previsualizar`)
      .set(auth(gym.adminToken))
      .expect(200);
    return body;
  };

  const publicar = (salaId: string, anio = ANIO, mes = MES): request.Test =>
    request(servidor)
      .post(`/calendario/${salaId}/${anio}/${mes}/publicar`)
      .set(auth(gym.adminToken))
      .expect(202);

  const contarTurnos = (tenantId = gym.tenantId): Promise<number> =>
    prisma.base.turno.count({ where: { tenantId } });

  const contarReservas = (tenantId = gym.tenantId): Promise<number> =>
    prisma.base.reserva.count({ where: { tenantId, canceladaEn: null } });

  // 1 — Rutinas fijas -----------------------------------------------------

  describe('checklist 1: cargar una rutina fija', () => {
    it('crea la rutina y la devuelve al listar', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);

      const rutina = await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      expect(rutina).toMatchObject({
        perfilId: alumno.perfilId,
        salaId,
        nombre: 'Pilates',
        diaSemana: 2,
        horaInicio: '18:00',
        horaFin: '19:00',
        activa: true,
        desde: '2099-01-01',
        hasta: null,
      });

      const lista = await request(servidor)
        .get('/rutinas')
        .query({ salaId })
        .set(auth(gym.adminToken))
        .expect(200);

      expect(lista.body).toHaveLength(1);
      expect(lista.body[0].id).toBe(rutina.id);
    });

    it('403 si el alumno no tiene acceso a la sala', async () => {
      const salaConAcceso = await crearSala({ nombre: 'Sala A', cupoBase: 5 });
      const salaAjena = await crearSala({ nombre: 'Sala B', cupoBase: 5 });
      const alumno = await crearAlumno([salaConAcceso]);

      await request(servidor)
        .post('/rutinas')
        .set(auth(gym.adminToken))
        .send({
          perfilId: alumno.perfilId,
          salaId: salaAjena,
          nombre: 'Pilates',
          diaSemana: 2,
          horaInicio: '18:00',
          horaFin: '19:00',
          desde: '2099-01-01',
        })
        .expect(403);
    });
  });

  // 2 — Previsualizacion ---------------------------------------------------

  describe('checklist 2: previsualizar no escribe nada', () => {
    it('devuelve los cuatro turnos y las cuatro reservas del mes', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      const plan = await previsualizar(salaId);

      expect(plan.turnosACrear.map((turno: any) => turno.fecha)).toEqual(MARTES);
      expect(plan.reservasACrear.map((reserva: any) => reserva.fecha)).toEqual(MARTES);
      expect(plan.resumen).toEqual({ turnos: 4, reservas: 4, conflictos: 0, exclusiones: 0 });
      expect(plan.turnosACrear[0]).toMatchObject({
        salaId,
        nombre: 'Pilates',
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 5,
      });
    });

    it('la base sigue vacia de turnos y reservas despues de previsualizar', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await previsualizar(salaId);

      expect(await contarTurnos()).toBe(0);
      expect(await contarReservas()).toBe(0);
      // Previsualizar tampoco abre la fila del mes: el estado sigue siendo el
      // inicial, sin id y sin publicacion.
      const mes = await request(servidor)
        .get(`/calendario/${salaId}/${ANIO}/${MES}`)
        .set(auth(gym.adminToken))
        .expect(200);
      expect(mes.body).toMatchObject({ id: null, estado: 'BORRADOR', publicacion: null });
    });

    it('previsualizar dos veces devuelve exactamente lo mismo', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      const primera = await previsualizar(salaId);
      const segunda = await previsualizar(salaId);

      expect(segunda).toEqual(primera);
    });
  });

  // 3 — Conflictos ---------------------------------------------------------

  describe('checklist 3: los conflictos no interrumpen el proceso', () => {
    it('con cupo 1 y dos alumnos, planifica uno y reporta el otro en cada fecha', async () => {
      const salaId = await crearSala({ cupoBase: 1 });
      const uno = await crearAlumno([salaId]);
      const otro = await crearAlumno([salaId]);
      await crearRutina(uno.perfilId, salaId, 2, '18:00');
      await crearRutina(otro.perfilId, salaId, 2, '18:00');

      const plan = await previsualizar(salaId);

      // Cuatro turnos (uno por martes), una reserva en cada uno y el segundo
      // alumno reportado en las cuatro fechas: el conflicto no aborta el mes.
      expect(plan.resumen).toEqual({ turnos: 4, reservas: 4, conflictos: 4, exclusiones: 0 });
      expect(plan.conflictos.map((conflicto: any) => conflicto.fecha)).toEqual(MARTES);
      expect(plan.conflictos.every((conflicto: any) => conflicto.tipo === 'CUPO_LLENO')).toBe(true);

      // El desempate es determinista: siempre entra el mismo perfil.
      const perdedor = plan.conflictos[0].perfilId;
      const ganador = plan.reservasACrear[0].perfilId;
      expect([uno.perfilId, otro.perfilId]).toContain(perdedor);
      expect(ganador).not.toBe(perdedor);
      expect(plan.conflictos.every((c: any) => c.perfilId === perdedor)).toBe(true);
    });

    it('un pack vencido a mitad de mes deja las primeras fechas y reporta las ultimas', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const packId = await crearPack();
      // La vigencia muere entre el segundo y el tercer martes.
      const alumno = await crearAlumno([salaId], { packId, vigenciaHasta: '2099-10-14' });
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      const plan = await previsualizar(salaId);

      // El turno se crea igual en los cuatro martes: que este alumno no pueda
      // venir no borra la clase.
      expect(plan.resumen).toEqual({ turnos: 4, reservas: 2, conflictos: 2, exclusiones: 0 });
      expect(plan.reservasACrear.map((reserva: any) => reserva.fecha)).toEqual(MARTES.slice(0, 2));
      expect(plan.conflictos.map((conflicto: any) => conflicto.fecha)).toEqual(MARTES.slice(2));
      expect(plan.conflictos.every((conflicto: any) => conflicto.tipo === 'FUERA_DE_PACK')).toBe(
        true,
      );
    });

    it('GET /conflictos devuelve solo los conflictos, sin las exclusiones', async () => {
      const salaId = await crearSala({ cupoBase: 1 });
      const uno = await crearAlumno([salaId]);
      const otro = await crearAlumno([salaId]);
      await crearRutina(uno.perfilId, salaId, 2, '18:00');
      await crearRutina(otro.perfilId, salaId, 2, '18:00');
      // Los dos de vacaciones el primer martes: esa fecha sale por exclusion,
      // no por conflicto.
      await crearVacacion(uno.perfilId, MARTES[0], MARTES[0]);
      await crearVacacion(otro.perfilId, MARTES[0], MARTES[0]);

      const plan = await previsualizar(salaId);
      expect(plan.resumen).toMatchObject({ conflictos: 3, exclusiones: 2 });

      const { body } = await request(servidor)
        .get(`/calendario/${salaId}/${ANIO}/${MES}/conflictos`)
        .set(auth(gym.adminToken))
        .expect(200);

      expect(body).toEqual(plan.conflictos);
      expect(body).toHaveLength(3);
      expect(body.every((conflicto: any) => conflicto.tipo === 'CUPO_LLENO')).toBe(true);
      // Ni rastro de las vacaciones: son informativas y no piden decision.
      expect(body.some((conflicto: any) => conflicto.fecha === MARTES[0])).toBe(false);
    });
  });

  // 4 — Publicacion --------------------------------------------------------

  describe('checklist 4: publicar es real e idempotente', () => {
    it('responde 202 con el jobId', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      const { body } = await publicar(salaId);

      expect(body).toMatchObject({ salaId, anio: ANIO, mes: MES });
      expect(typeof body.jobId).toBe('string');
      expect(body.jobId.length).toBeGreaterThan(0);

      // Se espera a que el job termine aunque a este caso solo le interese la
      // respuesta: dejarlo a medias haria que el `obliterate` del siguiente
      // beforeEach le borrase las claves por debajo, y el worker emitiria un
      // `error` ("Missing key for job N. moveToFinished") que nadie escucha.
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);
    });

    it('crea los turnos y las reservas, y deja el mes HABILITADO', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      const mes = await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(mes.publicacion).toMatchObject({ estado: 'terminado', error: null });
      expect(mes.publicacion.resumen).toEqual({
        turnos: 4,
        reservas: 4,
        conflictos: 0,
        exclusiones: 0,
      });
      expect(mes.estado).toBe('HABILITADO');
      expect(mes.publicadoEn).not.toBeNull();
      expect(mes.publicadoPor).toBe(gym.adminId);

      expect(await contarTurnos()).toBe(4);
      expect(await contarReservas()).toBe(4);

      const turnos = await prisma.base.turno.findMany({
        where: { tenantId: gym.tenantId },
        orderBy: { fecha: 'asc' },
      });
      expect(turnos.map((turno) => turno.fecha.toISOString().slice(0, 10))).toEqual(MARTES);
      expect(turnos.every((turno) => turno.horaInicio === '18:00' && turno.cupo === 5)).toBe(true);

      const reservas = await prisma.base.reserva.findMany({ where: { tenantId: gym.tenantId } });
      expect(reservas.every((reserva) => reserva.origen === 'RUTINA')).toBe(true);
    });

    it('PUBLICAR DOS VECES no cambia el numero de reservas', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      const primeras = await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } });
      const turnosPrimera = await prisma.base.turno.count({ where: { tenantId: gym.tenantId } });

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } })).toBe(primeras);
      expect(await prisma.base.turno.count({ where: { tenantId: gym.tenantId } })).toBe(
        turnosPrimera,
      );
      expect(primeras).toBe(4);
    });

    it('publicar despues de anadir una rutina crea solo lo que falta', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const uno = await crearAlumno([salaId]);
      await crearRutina(uno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);
      expect(await contarTurnos()).toBe(4);
      expect(await contarReservas()).toBe(4);

      // El segundo alumno entra en los turnos que ya existen: no hay que crear
      // ni un turno mas.
      const otro = await crearAlumno([salaId]);
      await crearRutina(otro.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      const mes = await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(mes.publicacion.resumen).toMatchObject({ turnos: 0, reservas: 4 });
      expect(await contarTurnos()).toBe(4);
      expect(await contarReservas()).toBe(8);
    });

    it('400 al publicar un mes que ya paso', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await request(servidor)
        .post(`/calendario/${salaId}/2020/1/publicar`)
        .set(auth(gym.adminToken))
        .expect(400);

      // Y no encola nada: la fila del mes ni siquiera se abre.
      const mes = await request(servidor)
        .get(`/calendario/${salaId}/2020/1`)
        .set(auth(gym.adminToken))
        .expect(200);
      expect(mes.body.id).toBeNull();
    });
  });

  // 5 — Ausencias ----------------------------------------------------------

  describe('checklist 5: una ausencia excluye la fecha para todos', () => {
    it('un cierre de todo el salon quita esa fecha del plan', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const uno = await crearAlumno([salaId]);
      const otro = await crearAlumno([salaId]);
      await crearRutina(uno.perfilId, salaId, 2, '18:00');
      await crearRutina(otro.perfilId, salaId, 2, '18:00');
      // Sin salaId: cierra el salon entero.
      await crearAusencia({ desde: MARTES[1], hasta: MARTES[1], motivo: 'Feriado' });

      const plan = await previsualizar(salaId);

      expect(plan.reservasACrear.map((reserva: any) => reserva.fecha)).not.toContain(MARTES[1]);
      expect(plan.resumen).toMatchObject({ turnos: 3, reservas: 6, conflictos: 0, exclusiones: 2 });
      // Excluye a los dos alumnos, y como ausencia de sala, no como vacacion.
      expect(plan.exclusiones.every((exclusion: any) => exclusion.tipo === 'AUSENCIA_SALA')).toBe(
        true,
      );
      expect(plan.exclusiones.every((exclusion: any) => exclusion.fecha === MARTES[1])).toBe(true);
    });

    it('un cierre no crea el turno: si nadie puede venir, no hay clase', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');
      await crearAusencia({ salaId, desde: MARTES[1], hasta: MARTES[1] });

      const plan = await previsualizar(salaId);

      expect(plan.turnosACrear.map((turno: any) => turno.fecha)).toEqual([
        MARTES[0],
        MARTES[2],
        MARTES[3],
      ]);
    });

    it('tras publicar, esa fecha no tiene turno en la base', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');
      await crearAusencia({ salaId, desde: MARTES[1], hasta: MARTES[1] });

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(await contarTurnos()).toBe(3);
      expect(await contarReservas()).toBe(3);

      const delDiaCerrado = await prisma.base.turno.findFirst({
        where: { tenantId: gym.tenantId, fecha: new Date(`${MARTES[1]}T00:00:00.000Z`) },
      });
      expect(delDiaCerrado).toBeNull();
    });
  });

  // 6 — Vacaciones ---------------------------------------------------------

  describe('checklist 6: una vacacion excluye solo a su alumno', () => {
    it('el turno se crea igual y el otro alumno conserva su reserva', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const deVacaciones = await crearAlumno([salaId]);
      const presente = await crearAlumno([salaId]);
      await crearRutina(deVacaciones.perfilId, salaId, 2, '18:00');
      await crearRutina(presente.perfilId, salaId, 2, '18:00');
      await crearVacacion(deVacaciones.perfilId, MARTES[1], MARTES[1]);

      const plan = await previsualizar(salaId);
      expect(plan.resumen).toMatchObject({ turnos: 4, reservas: 7, exclusiones: 1 });

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      const turnoDelDia = await prisma.base.turno.findFirst({
        where: { tenantId: gym.tenantId, fecha: new Date(`${MARTES[1]}T00:00:00.000Z`) },
        include: { reservas: true },
      });
      expect(turnoDelDia).not.toBeNull();
      expect(turnoDelDia!.reservas).toHaveLength(1);
      expect(turnoDelDia!.reservas[0].perfilId).toBe(presente.perfilId);
      expect(await contarReservas()).toBe(7);
    });

    it('la vacacion aparece como exclusion, nunca como conflicto', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');
      await crearVacacion(alumno.perfilId, MARTES[1], MARTES[2]);

      const plan = await previsualizar(salaId);

      expect(plan.conflictos).toEqual([]);
      expect(plan.exclusiones).toEqual([
        {
          tipo: 'VACACION_ALUMNO',
          perfilId: alumno.perfilId,
          fecha: MARTES[1],
          detalle: expect.any(String),
        },
        {
          tipo: 'VACACION_ALUMNO',
          perfilId: alumno.perfilId,
          fecha: MARTES[2],
          detalle: expect.any(String),
        },
      ]);
    });
  });

  // 7 — El job corre en background -----------------------------------------

  describe('checklist 7: el job corre en background', () => {
    it('POST /publicar responde en menos de un segundo aunque haya 10 rutinas', async () => {
      const salaId = await crearSala({ cupoBase: 20 });
      for (let i = 0; i < 10; i++) {
        const alumno = await crearAlumno([salaId]);
        await crearRutina(alumno.perfilId, salaId, 2, '18:00');
      }

      const inicio = Date.now();
      const { body } = await publicar(salaId);
      const tardo = Date.now() - inicio;

      expect(body.jobId).toBeDefined();
      // El request encola y vuelve; la generacion ocurre en el worker.
      expect(tardo).toBeLessThan(1000);

      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);
      expect(await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } })).toBe(40);
    });
  });

  // Aislamiento ------------------------------------------------------------

  describe('aislamiento entre gimnasios', () => {
    it('un job encolado para un gimnasio no crea nada en el otro', async () => {
      const otro = await crearGimnasio(app, 'boxrec2');

      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);
      await crearRutina(alumno.perfilId, salaId, 2, '18:00');

      await publicar(salaId);
      await esperarPublicacion(servidor, gym.adminToken, salaId, ANIO, MES);

      expect(await prisma.base.turno.count({ where: { tenantId: otro.tenantId } })).toBe(0);
      expect(await prisma.base.reserva.count({ where: { tenantId: otro.tenantId } })).toBe(0);
      expect(await prisma.base.turno.count({ where: { tenantId: gym.tenantId } })).toBe(4);
    });

    it('404 al previsualizar una sala de otro gimnasio', async () => {
      const otro = await crearGimnasio(app, 'boxrec2');
      const salaId = await crearSala({ cupoBase: 5 });

      await request(servidor)
        .post(`/calendario/${salaId}/${ANIO}/${MES}/previsualizar`)
        .set(auth(otro.adminToken))
        .expect(404);

      await request(servidor)
        .post(`/calendario/${salaId}/${ANIO}/${MES}/publicar`)
        .set(auth(otro.adminToken))
        .expect(404);
    });
  });

  // Regresiones ------------------------------------------------------------

  describe('regresiones de la fase', () => {
    it('crear dos turnos en la misma sala, fecha y hora es 409, no 500', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const cuerpo = {
        salaId,
        nombre: 'Pilates',
        fecha: MARTES[0],
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 5,
      };

      await request(servidor).post('/turnos').set(auth(gym.adminToken)).send(cuerpo).expect(201);

      await request(servidor).post('/turnos').set(auth(gym.adminToken)).send(cuerpo).expect(409);
    });

    it('un alumno no puede tener dos reservas activas en el mismo turno', async () => {
      const salaId = await crearSala({ cupoBase: 5 });
      const alumno = await crearAlumno([salaId]);

      const { body: turno } = await request(servidor)
        .post('/turnos')
        .set(auth(gym.adminToken))
        .send({
          salaId,
          nombre: 'Pilates',
          fecha: MARTES[0],
          horaInicio: '18:00',
          horaFin: '19:00',
          cupo: 5,
        })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turno.id}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(201);

      await request(servidor)
        .post(`/turnos/${turno.id}/reservas`)
        .set(auth(gym.adminToken))
        .send({ perfilId: alumno.perfilId })
        .expect(409);

      expect(await contarReservas()).toBe(1);
    });
  });
});
