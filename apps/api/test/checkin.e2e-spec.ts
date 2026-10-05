/**
 * Los e2e del check-in por QR (Fase 6B, tarea 9).
 *
 * El gimnasio imprime un QR ESTATICO Y FIRMADO y lo pega en la pared; la URL
 * lleva `?f=<firma>`. El alumno escanea al llegar y `POST /checkin` lo marca
 * presente. El QR garantiza COMODIDAD, NO PRESENCIA: la ventana acota *cuando*,
 * no *donde*.
 *
 * LO QUE SOLO SE PUEDE VER AQUI, y que es la razon de ser de esta suite:
 *
 * 1. LA ZONA HORARIA CONTRA EL RELOJ DE VERDAD. Los unitarios inyectan `ahora`;
 *    aqui no hay inyeccion posible: el service usa `new Date()` y el turno se
 *    siembra en el reloj de pared del gimnasio. Esa distincion ya produjo dos
 *    bugs en esta fase.
 * 2. `Reserva.asistio` Y LA FILA DE `Asistencia` ESCRITAS JUNTAS. Se comprueban
 *    LAS DOS en la base, nunca una de las dos y el 201: escribir una sin la
 *    otra deja el sistema mintiendo en uno de los dos sentidos, y un doble no
 *    distingue "la transaccion escribio las dos" de "el service devolvio bien".
 * 3. EL @@unique([tenantId, reservaId]) DE POSTGRES, que es lo que cierra la
 *    ventana entre comprobar y escribir. Un doble no tiene indices.
 *
 * LA FIRMA SE RECALCULA A MANO, no se importa `firmarTenant` de `src`. Es
 * deliberado: el cartel esta IMPRESO Y PEGADO EN LA PARED, asi que el formato
 * de la firma es un contrato con objetos fisicos que ya existen. Si el test
 * llamara a la misma funcion que el servidor, cambiar el proposito o el
 * algoritmo seguiria en verde y el dia del despliegue todos los carteles
 * impresos dejarian de funcionar a la vez.
 */

import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  crearProfesor,
  limpiarBaseDeDatos,
  type AlumnoDeTest,
  type EntornoE2E,
  type GimnasioDeTest,
  type ProfesorDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const UN_MINUTO_MS = 60_000;

/**
 * La zona del despliegue, leida del entorno igual que la lee la API.
 *
 * Los e2e corren con `.env.test`, que la fija en America/Argentina/Buenos_Aires
 * (UTC-3, sin horario de verano). Los casos de abajo que distinguen la zona de
 * UTC necesitan que el desfase NO sea cero; si alguien cambiara la variable a
 * `UTC`, esos casos quedarian vacios en silencio, asi que hay una guarda que lo
 * dice en voz alta.
 */
const ZONA = process.env.ZONA_HORARIA ?? 'America/Argentina/Buenos_Aires';

/**
 * La firma del QR, RECONSTRUIDA A MANO desde el contrato.
 *
 * Ver la cabecera del archivo: el prefijo `checkin-qr:v1:` y el base64url del
 * HMAC-SHA256 con la APP_ENCRYPTION_KEY EN TEXTO (los 64 caracteres hex, no los
 * 32 bytes decodificados) son lo que llevan los carteles ya impresos.
 */
function firmaDelCartel(tenantId: string): string {
  const clave = process.env.APP_ENCRYPTION_KEY;
  if (clave === undefined) throw new Error('Falta APP_ENCRYPTION_KEY en el entorno de test');

  return createHmac('sha256', clave).update(`checkin-qr:v1:${tenantId}`).digest('base64url');
}

/**
 * El reloj de pared del gimnasio dentro de `minutos`, partido en `fecha` y
 * `horaInicio` tal y como los guarda un turno.
 *
 * Se formatea con `Intl` en vez de restar un desfase fijo: restar "tres horas"
 * acierta en julio y falla en noviembre en cualquier zona con horario de
 * verano, y el fallo es invisible hasta que alguien no puede marcar presente.
 *
 * `hourCycle: 'h23'` Y NO `hour12: false`: con el segundo, la medianoche se
 * formatea "24:00", que no es una hora valida para la columna.
 */
function relojDelGimnasio(minutos: number, zona = ZONA): { fecha: string; hora: string } {
  const instante = new Date(Date.now() + minutos * UN_MINUTO_MS);

  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instante);

  const parte = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';

  return {
    fecha: `${parte('year')}-${parte('month')}-${parte('day')}`,
    hora: `${parte('hour')}:${parte('minute')}`,
  };
}

/** El mismo reloj, pero leido como si el gimnasio viviera en UTC. */
function relojEnUtc(minutos: number): { fecha: string; hora: string } {
  const iso = new Date(Date.now() + minutos * UN_MINUTO_MS).toISOString();
  return { fecha: iso.slice(0, 10), hora: iso.slice(11, 16) };
}

/** Minutos que la zona del gimnasio esta por delante de UTC ahora mismo. */
function desfaseDeLaZona(): number {
  const local = relojDelGimnasio(0);
  const utc = relojEnUtc(0);
  const aMinutos = (reloj: { fecha: string; hora: string }): number =>
    Date.parse(`${reloj.fecha}T${reloj.hora}:00.000Z`) / UN_MINUTO_MS;

  return aMinutos(local) - aMinutos(utc);
}

/**
 * Una hora de fin una hora despues del inicio, SIN cruzar la medianoche.
 *
 * `exigirHorasCoherentes` rechaza un `horaFin` que no sea posterior al inicio,
 * asi que una clase sembrada a las 23:30 no puede terminar a las 00:30. Se
 * recorta a las 23:59: lo que importa en esta suite es el INICIO, que es sobre
 * lo que se mide la ventana del check-in.
 */
function masUnaHora(hora: string): string {
  const [hh, mm] = hora.split(':').map(Number);
  if (hh + 1 >= 24) return '23:59';
  return `${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

interface Escenario {
  gym: GimnasioDeTest;
  salaId: string;
  alumno: AlumnoDeTest;
  firma: string;
}

describe('Fase 6B — el check-in por QR (e2e)', () => {
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
      .send({ nombre: 'Sala Grande', cupoBase: 10 })
      .expect(201);

    const alumno = await crearAlumnoPorInvitacion(app, gym, [sala.body.id], {
      email: `alumno-${slug}@correo-privado.test`,
    });

    return { gym, salaId: sala.body.id, alumno, firma: firmaDelCartel(gym.tenantId) };
  }

  /** Un turno con su reserva viva, en el reloj que pida el caso. */
  async function claseReservada(
    e: Escenario,
    reloj: { fecha: string; hora: string },
    opciones: { nombre?: string; profesorId?: string; perfilId?: string } = {},
  ): Promise<{ turnoId: string; reservaId: string }> {
    const turno = await request(servidor)
      .post('/turnos')
      .set(auth(e.gym.adminToken))
      .send({
        salaId: e.salaId,
        nombre: opciones.nombre ?? 'Pilates',
        fecha: reloj.fecha,
        horaInicio: reloj.hora,
        horaFin: masUnaHora(reloj.hora),
        cupo: 5,
        ...(opciones.profesorId ? { profesorId: opciones.profesorId } : {}),
      })
      .expect(201);

    const reserva = await request(servidor)
      .post(`/turnos/${turno.body.id}/reservas`)
      .set(auth(e.gym.adminToken))
      .send({ perfilId: opciones.perfilId ?? e.alumno.perfilId })
      .expect(201);

    return { turnoId: turno.body.id, reservaId: reserva.body.id };
  }

  const marcar = (e: Escenario, firma = e.firma) =>
    request(servidor).post('/checkin').set(auth(e.alumno.token)).send({ firma });

  /** Lo que la base dice de una reserva: la verdad y la evidencia, juntas. */
  async function enLaBase(reservaId: string): Promise<{
    asistio: boolean | null;
    asistencias: { origen: string; dispositivo: string | null }[];
  }> {
    const reserva = await entorno.prisma.base.reserva.findUniqueOrThrow({
      where: { id: reservaId },
      select: { asistio: true },
    });

    const asistencias = await entorno.prisma.base.asistencia.findMany({
      where: { reservaId },
      select: { origen: true, dispositivo: true },
    });

    return { asistio: reserva.asistio, asistencias };
  }

  describe('la ventana se mide en el reloj del gimnasio', () => {
    it('ACEPTA a la hora de la clase en la zona del gimnasio, y escribe asistio Y la fila de Asistencia', async () => {
      const e = await montar('qr-en-hora');
      const reloj = relojDelGimnasio(0);
      const { turnoId, reservaId } = await claseReservada(e, reloj, { nombre: 'Pilates' });

      const { body } = await marcar(e).expect(201);

      expect(body).toEqual({
        reservaId,
        turnoId,
        fecha: reloj.fecha,
        horaInicio: reloj.hora,
        clase: 'Pilates',
        marcadaEn: expect.any(String),
      });
      // ISO-8601 de verdad, no un string cualquiera.
      expect(new Date(body.marcadaEn).toISOString()).toBe(body.marcadaEn);

      // LAS DOS COSAS EN LA BASE, no el 201 y una de las dos. `asistio` es la
      // unica verdad sobre si vino; la fila de Asistencia es la evidencia de
      // COMO se marco. Una sin la otra es un presente sin rastro, o un rastro
      // de un presente que no figura.
      const estado = await enLaBase(reservaId);
      expect(estado.asistio).toBe(true);
      expect(estado.asistencias).toHaveLength(1);
      expect(estado.asistencias[0].origen).toBe('QR');
    });

    it('LA MISMA HORA LEIDA COMO UTC queda fuera de ventana', async () => {
      // Esta es la pareja del caso de arriba y es la que hace que valgan los
      // dos: si la ventana se calculara en UTC, los dos resultados se
      // INTERCAMBIAN. Con un solo caso, leer la hora en UTC solo rompe uno.
      // Si el despliegue viviera en UTC los dos relojes serian el mismo y este
      // caso no afirmaria nada. Que se note en voz alta y no en silencio.
      expect(Math.abs(desfaseDeLaZona())).toBeGreaterThan(15);

      const e = await montar('qr-en-utc');
      // Un turno cuyo reloj de pared coincide con la hora UTC de ahora mismo:
      // en Argentina eso son las tres de la tarde cuando en el gimnasio son las
      // doce, o sea tres horas lejos de la ventana.
      const reloj = relojEnUtc(0);
      await claseReservada(e, reloj, { nombre: 'Funcional' });

      const { body } = await marcar(e).expect(409);

      expect(body.motivo).toBe('fuera-de-ventana');
      expect(body.clase).toBe('Funcional');
      expect(body.horaInicio).toBe(reloj.hora);
    });

    it('RECHAZA fuera de ventana, diciendo cual era la clase y a que hora', async () => {
      const e = await montar('qr-fuera');
      const reloj = relojDelGimnasio(120);
      await claseReservada(e, reloj, { nombre: 'Yoga' });

      const { body } = await marcar(e).expect(409);

      expect(body).toEqual({
        statusCode: 409,
        path: '/checkin',
        timestamp: expect.any(String),
        motivo: 'fuera-de-ventana',
        message: expect.stringContaining('Yoga'),
        clase: 'Yoga',
        fecha: reloj.fecha,
        horaInicio: reloj.hora,
      });

      // Y no escribio nada: un rechazo no deja rastro de asistencia.
      expect(await entorno.prisma.base.asistencia.count()).toBe(0);
    });

    it('la ventana del gimnasio MANDA: con 0 y 0 la clase de dentro de diez minutos ya no entra', async () => {
      const e = await montar('qr-ventana-cero');

      await request(servidor)
        .put('/config/checkin-qr')
        .set(auth(e.gym.adminToken))
        .send({ minutosAntes: 0, minutosDespues: 0 })
        .expect(200);

      await claseReservada(e, relojDelGimnasio(10));

      const { body } = await marcar(e).expect(409);
      expect(body.motivo).toBe('fuera-de-ventana');
    });

    it('con la ventana ancha, la misma clase de dentro de diez minutos SI entra', async () => {
      const e = await montar('qr-ventana-ancha');

      await request(servidor)
        .put('/config/checkin-qr')
        .set(auth(e.gym.adminToken))
        .send({ minutosAntes: 60, minutosDespues: 60 })
        .expect(200);

      const { reservaId } = await claseReservada(e, relojDelGimnasio(10));

      await marcar(e).expect(201);
      expect((await enLaBase(reservaId)).asistio).toBe(true);
    });
  });

  describe('los cuatro motivos del 409 no se confunden entre si', () => {
    it('sin-reserva es el unico que NO habla de ninguna clase', async () => {
      const e = await montar('qr-sin-reserva');

      const { body } = await marcar(e).expect(409);

      expect(body).toEqual({
        statusCode: 409,
        path: '/checkin',
        timestamp: expect.any(String),
        motivo: 'sin-reserva',
        message: 'No tenes ninguna reserva para marcar ahora mismo.',
      });
    });

    it('EL SEGUNDO INTENTO es ya-marcada, y sigue habiendo UNA sola fila de Asistencia', async () => {
      const e = await montar('qr-dos-veces');
      const reloj = relojDelGimnasio(0);
      const { reservaId } = await claseReservada(e, reloj, { nombre: 'Pilates' });

      await marcar(e).expect(201);

      const { body } = await marcar(e).expect(409);

      expect(body.motivo).toBe('ya-marcada');
      expect(body.clase).toBe('Pilates');
      expect(body.fecha).toBe(reloj.fecha);
      expect(body.horaInicio).toBe(reloj.hora);

      // El @@unique([tenantId, reservaId]) es lo que hace que el segundo escaneo
      // sea un 409 EN LA BASE y no solo en el codigo.
      expect((await enLaBase(reservaId)).asistencias).toHaveLength(1);
    });

    it('DOS ESCANEOS SIMULTANEOS dan exactamente un 201 y un 409 de ya-marcada', async () => {
      const e = await montar('qr-carrera');
      await claseReservada(e, relojDelGimnasio(0));

      // Entre mirar "ya marcada" y escribir hay una ventana: los dos pasan la
      // comprobacion y uno choca contra el indice unico. El alumno no tiene por
      // que ver la diferencia, asi que recibe el mismo 409.
      const respuestas = await Promise.all([marcar(e), marcar(e)]);
      const estados = respuestas.map((r) => r.status).sort();

      expect(estados).toEqual([201, 409]);
      const rechazo = respuestas.find((r) => r.status === 409);
      expect(rechazo?.body.motivo).toBe('ya-marcada');
      expect(await entorno.prisma.base.asistencia.count()).toBe(1);
    });

    it('LISTA-YA-PASADA no es ya-marcada: la profesora paso lista y el alumno no marco nada', async () => {
      const e = await montar('qr-lista-pasada');

      const profesora: ProfesorDeTest = await crearProfesor(app, e.gym, [e.salaId], {
        nombre: 'Fati Gomez',
      });

      // El turno arranco hace cinco minutos: sigue dentro de la ventana de
      // quince, y la profesora ya puede pasar lista (no se pasa lista de una
      // clase que no empezo).
      const reloj = relojDelGimnasio(-5);
      const { turnoId, reservaId } = await claseReservada(e, reloj, {
        nombre: 'Funcional',
        profesorId: profesora.perfilId,
      });

      // Lista pasada con el alumno AUSENTE. Eso escribe `asistio` SIN dejar
      // fila de Asistencia, que es exactamente lo que distingue este motivo.
      await request(servidor)
        .post(`/mis-clases/${turnoId}/asistencia`)
        .set(auth(profesora.token))
        .send({ presentes: [] })
        .expect(201);

      const antes = await enLaBase(reservaId);
      expect(antes).toEqual({ asistio: false, asistencias: [] });

      const { body } = await marcar(e).expect(409);

      // Decirle "ya marcaste" a quien no marco lo manda a buscar un problema
      // que no existe. Lo que tiene que hacer es hablar con su profesora.
      expect(body.motivo).toBe('lista-ya-pasada');
      expect(body.message).toContain('profesora');
      expect(body.clase).toBe('Funcional');
      expect(body.fecha).toBe(reloj.fecha);
      expect(body.horaInicio).toBe(reloj.hora);

      // Y LA PROFESORA MANDA: el parte no se toca desde el telefono del alumno.
      expect(await enLaBase(reservaId)).toEqual({ asistio: false, asistencias: [] });
    });

    it('con dos clases en ventana se marca LA MAS CERCANA, y la otra queda intacta', async () => {
      const e = await montar('qr-dos-clases');

      await request(servidor)
        .put('/config/checkin-qr')
        .set(auth(e.gym.adminToken))
        .send({ minutosAntes: 90, minutosDespues: 90 })
        .expect(200);

      // Las dos estan dentro de la ventana de noventa minutos. La de hace una
      // hora empezo antes; la de ahora es la que el alumno esta por hacer.
      const vieja = await claseReservada(e, relojDelGimnasio(-60), { nombre: 'Pilates' });
      const ahora = await claseReservada(e, relojDelGimnasio(0), { nombre: 'Funcional' });

      const { body } = await marcar(e).expect(201);
      expect(body.turnoId).toBe(ahora.turnoId);
      expect(body.clase).toBe('Funcional');

      // La otra no se toco: marcar presente escribe sobre UNA reserva.
      expect(await enLaBase(vieja.reservaId)).toEqual({ asistio: null, asistencias: [] });
      expect((await enLaBase(ahora.reservaId)).asistio).toBe(true);
      expect(await entorno.prisma.base.asistencia.count()).toBe(1);
    });
  });

  describe('el QR es de un gimnasio y de uno solo', () => {
    it('EL CARTEL DE OTRO GIMNASIO da 404 y no llega a tocar ninguna reserva', async () => {
      const uno = await montar('qr-gym-uno');
      const otro = await montar('qr-gym-otro');

      // El alumno del primero, con su clase en hora, pero escaneando el cartel
      // que esta colgado en la pared del segundo.
      const { reservaId } = await claseReservada(uno, relojDelGimnasio(0));

      const { body } = await marcar(uno, otro.firma).expect(404);

      // 404 Y NO 403: un 403 diria "la firma es buena, pero no es tuya", o sea
      // confirmaria que el gimnasio de esa firma existe.
      expect(body.statusCode).toBe(404);
      expect(body.message).toBe('Ese codigo QR no es de este gimnasio');

      expect(await enLaBase(reservaId)).toEqual({ asistio: null, asistencias: [] });

      // Y con el suyo, la misma peticion funciona: lo unico que cambio es el cartel.
      await marcar(uno).expect(201);
    });

    it('una firma inventada da el MISMO 404 que la de otro gimnasio', async () => {
      const e = await montar('qr-firma-falsa');
      await claseReservada(e, relojDelGimnasio(0));

      // Mismo largo que una firma real (43 caracteres de base64url): el
      // rechazo no puede depender de que se note a simple vista.
      const inventada = 'a'.repeat(e.firma.length);
      const falsa = await marcar(e, inventada).expect(404);
      const ajena = await marcar(e, firmaDelCartel('otro-tenant-que-no-existe')).expect(404);

      expect(falsa.body.message).toBe(ajena.body.message);
      expect(await entorno.prisma.base.asistencia.count()).toBe(0);
    });

    it('el cartel se descarga como PNG, y solo lo descarga el ADMIN_SALON', async () => {
      const e = await montar('qr-cartel');

      const png = await request(servidor)
        .get('/config/checkin-qr/imagen')
        .set(auth(e.gym.adminToken))
        .expect(200);

      expect(png.headers['content-type']).toContain('image/png');
      // `no-store`: la imagen lleva la firma del gimnasio dentro, asi que esta
      // al nivel de una credencial y no se queda en el disco de un proxy.
      expect(png.headers['cache-control']).toBe('no-store');
      expect(png.body.slice(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );

      await request(servidor)
        .get('/config/checkin-qr/imagen')
        .set(auth(e.alumno.token))
        .expect(403);
    });
  });

  describe('la puerta de entrada', () => {
    it('sin token no se marca nada', async () => {
      const e = await montar('qr-sin-token');
      await claseReservada(e, relojDelGimnasio(0));

      await request(servidor).post('/checkin').send({ firma: e.firma }).expect(401);
      expect(await entorno.prisma.base.asistencia.count()).toBe(0);
    });

    it('un usuario sin perfil de alumno no tiene reservas que marcar', async () => {
      const e = await montar('qr-sin-perfil');

      // El ADMIN_SALON alcanza el rol ALUMNO por jerarquia, asi que el guard lo
      // deja pasar: lo que lo para es no tener perfil.
      const { body } = await request(servidor)
        .post('/checkin')
        .set(auth(e.gym.adminToken))
        .send({ firma: e.firma })
        .expect(404);

      expect(body.message).toContain('perfil de alumno');
    });

    it('el cuerpo solo acepta la firma', async () => {
      const e = await montar('qr-cuerpo');

      await request(servidor).post('/checkin').set(auth(e.alumno.token)).send({}).expect(400);

      await request(servidor)
        .post('/checkin')
        .set(auth(e.alumno.token))
        .send({ firma: e.firma, perfilId: e.alumno.perfilId })
        .expect(400);
    });
  });
});
