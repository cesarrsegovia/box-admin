/**
 * ⚠️⚠️ ESTE ARCHIVO NUNCA SE HA EJECUTADO. Escrito el 24/09/2026 con Docker
 * caido en la maquina de desarrollo: sin Postgres y sin Redis, los e2e no se
 * pueden correr. Lo unico que se le paso fue `tsc --noEmit` y `prettier`.
 *
 * O sea: compila, pero NADIE HA VISTO NI UN SOLO CASO EN VERDE. Quien lo corra
 * por primera vez tiene que leer los fallos como "todavia no estaba probado",
 * no como "esto se rompio". Las incognitas conocidas estan anotadas donde
 * aparecen, con el prefijo `SIN VERIFICAR:`.
 *
 * Borra esta cabecera quien lo vea pasar entero.
 *
 * ---
 *
 * Los e2e de la Fase 5B: SMTP por gimnasio, plantillas, avisos y push.
 *
 * Todo va contra el adaptador de email EN MEMORIA (`app.get(ENVIOS_DE_EMAIL)`),
 * que guarda lo que se habria enviado y no toca la red. Ese adaptador NO guarda
 * `smtp.clave` a proposito, asi que ni el objeto que estos tests imprimen al
 * fallar puede filtrar una credencial.
 *
 * ⚠️ NO CORRER CON OTRA API VIVA CONTRA EL MISMO REDIS. Media fase son jobs, y
 * una segunda instancia se lleva los del worker: los avisos saldrian por la otra
 * bandeja y aqui se veria como "el email no llego nunca".
 */

// PUSH_TIPO se cambia ANTES de importar nada de la aplicacion, igual que
// throttling.e2e-spec.ts hace con el limite del throttler y por el mismo motivo:
// `ComunicacionModule.forRoot()` lee `process.env.PUSH_TIPO` al EVALUAR el
// decorador de AppModule, o sea en el `import`, no al levantar la app. Por eso
// `./helpers` —que arrastra AppModule— se importa dinamicamente dentro del
// beforeAll y no aqui arriba.
//
// Con `.env.test` tal cual (PUSH_TIPO=memoria) el adaptador de push es
// PushEnMemoria, que declara `habilitado = true` aunque no haya claves VAPID, y
// entonces POST /push/suscripcion responde 204. El 503 que exige la spec es el
// del adaptador REAL sin VAPID, y este archivo no necesita el push en memoria
// para nada: el email sale igual con el push desactivado.
//
// El valor valido es 'web-push' CON GUION, no 'webpush': lo comprueba
// validarEntorno y con cualquier otra cosa la aplicacion no arranca.
process.env.PUSH_TIPO = 'web-push';

import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { TIPOS_DE_PLANTILLA } from '@boxadmin/shared';
import type { EmailEnMemoria } from '../src/comunicacion/email-memoria';
import { ENVIOS_DE_EMAIL } from '../src/comunicacion/envios.interface';
import { GENERACION_MES_QUEUE } from '../src/jobs/generacion-mes/cola';
import {
  NOTIFICACION_LISTA_ESPERA_QUEUE,
  NOTIFICACION_RESERVA_QUEUE,
} from '../src/jobs/notificaciones/colas';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { GimnasioDeTest } from './helpers';

// El mismo mes futuro fijo que usan selfservice y recurrencia, para que los
// tests no caduquen. 2099-10-13 es martes (diaSemana 2).
const ANIO = 2099;
const MES = 10;
const FECHA = '2099-10-13';

const PASSWORD = 'Password123!';

/**
 * La contrasena SMTP de los tests. Es el valor que dos casos buscan y NO tienen
 * que encontrar: ni en la respuesta del PUT ni en la columna de la base.
 *
 * Larga y con un tramo que no se parece a nada: si fuera corta o pareciera un
 * trozo cualquiera de JSON, un `not.toContain` podria fallar por casualidad y el
 * test dejaria de decir lo que dice.
 */
const CLAVE_SMTP = 'contrasena-smtp-de-prueba-9F3k';

const SMTP = {
  host: 'smtp.gimnasio.test',
  // 587, el de STARTTLS, asi que `seguro: false`. Lo que interesa aqui no es el
  // modo sino que el campo viaje entero de ida y vuelta.
  puerto: 587,
  seguro: false,
  usuario: 'avisos@gimnasio.test',
  clave: CLAVE_SMTP,
  emailOrigen: 'avisos@gimnasio.test',
  emailDestino: 'copia@gimnasio.test',
};

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('Fase 5B — comunicacion (e2e)', () => {
  // `typeof import(...)` es solo un tipo: no ejecuta el modulo, asi que no
  // adelanta la carga de AppModule. El modulo de verdad llega en el beforeAll.
  let helpers: typeof import('./helpers');
  let app: INestApplication;
  let prisma: PrismaService;
  let servidor: ReturnType<INestApplication['getHttpServer']>;
  let envios: EmailEnMemoria;
  let colas: Queue[];
  let gym: GimnasioDeTest;

  beforeAll(async () => {
    helpers = await import('./helpers');

    const entorno = await helpers.crearAppDeTest();
    app = entorno.app;
    prisma = entorno.prisma;
    servidor = app.getHttpServer();

    // Se pide por el token y se tipa como la clase concreta: `EnviosDeEmail` no
    // tiene `enviados` ni `limpiar`, que es justo lo que hace falta aqui.
    envios = app.get<EmailEnMemoria>(ENVIOS_DE_EMAIL);

    colas = [
      app.get<Queue>(getQueueToken(GENERACION_MES_QUEUE)),
      app.get<Queue>(getQueueToken(NOTIFICACION_RESERVA_QUEUE)),
      app.get<Queue>(getQueueToken(NOTIFICACION_LISTA_ESPERA_QUEUE)),
    ];
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await helpers.limpiarBaseDeDatos(prisma);

    // Los jobs viven en Redis, no en Postgres: truncar tablas no los borra. Un
    // aviso rezagado de otra corrida acabaria en la bandeja de este test, y eso
    // rompe justo el caso que comprueba que la bandeja sigue VACIA.
    for (const cola of colas) await cola.obliterate({ force: true });

    // Y la bandeja tambien: es un array del proceso, vive mientras viva la app.
    envios.limpiar();

    gym = await helpers.crearGimnasio(app, `com${Date.now()}`);
  });

  // Helpers locales ---------------------------------------------------------

  const configurarSmtp = async (
    extra: Record<string, unknown> = {},
  ): Promise<Record<string, any>> => {
    const { body } = await request(servidor)
      .put('/config/smtp')
      .set(auth(gym.adminToken))
      .send({ ...SMTP, ...extra })
      .expect(200);

    return body;
  };

  const crearSala = async (extra: Record<string, unknown> = {}): Promise<string> => {
    const { body } = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala A', cupoBase: 5, ...extra })
      .expect(201);

    return body.id;
  };

  const crearTurno = async (salaId: string): Promise<string> => {
    const { body } = await request(servidor)
      .post('/turnos')
      .set(auth(gym.adminToken))
      .send({
        salaId,
        nombre: 'Pilates',
        fecha: FECHA,
        horaInicio: '18:00',
        horaFin: '19:00',
        cupo: 5,
      })
      .expect(201);

    return body.id;
  };

  const crearRutina = async (perfilId: string, salaId: string): Promise<void> => {
    await request(servidor)
      .post('/rutinas')
      .set(auth(gym.adminToken))
      .send({
        perfilId,
        salaId,
        nombre: 'Pilates',
        diaSemana: 2,
        horaInicio: '18:00',
        horaFin: '19:00',
        // Antes del mes que se publica: la rutina ya esta vigente cuando llega.
        desde: '2099-01-01',
      })
      .expect(201);
  };

  /**
   * Un ADMIN_OPERATIVO con su token.
   *
   * Se inserta con el cliente base porque NO HAY ENDPOINT que cree uno: el alta
   * de usuarios solo hace alumnos y profesores, y `/auth/register` fija
   * ADMIN_SALON y ademas rechaza el segundo usuario del gimnasio. Mismo camino
   * que auth.e2e-spec.ts usa para fabricar un ALUMNO en la Fase 0.
   *
   * El login va DESPUES de crear la fila, y no al reves, porque el rol viaja
   * dentro del JWT: un token emitido antes seguiria diciendo lo de antes.
   */
  const crearAdminOperativo = async (): Promise<string> => {
    const email = `operativo-${Date.now()}@gimnasio.test`;
    const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

    await prisma.base.usuario.create({
      data: {
        tenantId: gym.tenantId,
        nombreCompleto: 'Ope Rativa',
        email,
        passwordHash,
        rol: 'ADMIN_OPERATIVO',
      },
    });

    const { body } = await request(servidor)
      .post('/auth/login')
      .send({ tenantSlug: gym.slug, email, password: PASSWORD })
      .expect(200);

    return body.accessToken;
  };

  // -------------------------------------------------------------------------
  // 1. La credencial SMTP
  // -------------------------------------------------------------------------
  describe('configuracion SMTP', () => {
    it('configurar SMTP no devuelve la contrasena', async () => {
      const guardada = await configurarSmtp();

      // `toMatchObject` para lo que si vuelve; lo que NO vuelve se comprueba
      // aparte y sobre el JSON entero, que es lo que de verdad viaja por el
      // cable.
      expect(guardada).toMatchObject({
        host: SMTP.host,
        puerto: SMTP.puerto,
        seguro: false,
        usuario: SMTP.usuario,
        emailOrigen: SMTP.emailOrigen,
        emailDestino: SMTP.emailDestino,
        tieneClave: true,
      });

      expect(guardada).not.toHaveProperty('clave');
      expect(guardada).not.toHaveProperty('claveCifrada');
      expect(JSON.stringify(guardada)).not.toContain(CLAVE_SMTP);

      const { body: leida } = await request(servidor)
        .get('/config/smtp')
        .set(auth(gym.adminToken))
        .expect(200);

      expect(leida.tieneClave).toBe(true);
      expect(leida).not.toHaveProperty('clave');
      expect(leida).not.toHaveProperty('claveCifrada');
      expect(JSON.stringify(leida)).not.toContain(CLAVE_SMTP);
    });

    /**
     * EL UNICO TEST DE LA FASE QUE MIRA LA BASE DIRECTAMENTE, y por eso existe:
     * todos los demas le creen a la API. Que el `GET` no devuelva la clave no
     * dice nada sobre como esta guardada; un `SELECT` si.
     *
     * Va por `prisma.base` —el cliente SIN scoping— a proposito: el de la
     * aplicacion pasa por la extension de aislamiento, y aqui interesa leer la
     * fila tal cual esta escrita, sin intermediarios.
     */
    it('la contrasena no esta en claro en la base', async () => {
      await configurarSmtp();

      const filas = await prisma.base.configuracionSMTP.findMany({
        where: { tenantId: gym.tenantId },
      });

      expect(filas).toHaveLength(1);
      const fila = filas[0];

      // `v1:<iv>:<tag>:<datos>`, todo en base64. El prefijo de version es lo que
      // hace posible rotar la clave sin que cada gimnasio tenga que volver a
      // teclear su contrasena.
      expect(fila.claveCifrada.startsWith('v1:')).toBe(true);
      expect(fila.claveCifrada.split(':')).toHaveLength(4);

      expect(fila.claveCifrada).not.toContain(CLAVE_SMTP);
      // La fila ENTERA, no solo esa columna: si algun dia alguien anade un campo
      // de conveniencia con la clave dentro, este expect lo caza.
      expect(JSON.stringify(fila)).not.toContain(CLAVE_SMTP);
    });

    it('configurar SMTP lo hace ADMIN_SALON, no ADMIN_OPERATIVO', async () => {
      const operativo = await crearAdminOperativo();

      await request(servidor).put('/config/smtp').set(auth(operativo)).send(SMTP).expect(403);

      await request(servidor).get('/config/smtp').set(auth(operativo)).expect(403);

      // Y el de arriba en la jerarquia si puede: sin esto, el caso pasaria igual
      // con un endpoint roto que devuelve 403 a todo el mundo.
      await configurarSmtp();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Las plantillas
  // -------------------------------------------------------------------------
  describe('plantillas de email', () => {
    it('guardar una plantilla propia la marca como no-por-defecto, y las cinco vienen siempre', async () => {
      const { body: antes } = await request(servidor)
        .get('/config/plantillas')
        .set(auth(gym.adminToken))
        .expect(200);

      // CINCO, no seis. Las plantillas por defecto son constantes del codigo, no
      // filas sembradas: un gimnasio recien creado las tiene todas sin haber
      // configurado nada.
      expect(antes).toHaveLength(5);
      expect(antes.map((p: { tipo: string }) => p.tipo).sort()).toEqual(
        [...TIPOS_DE_PLANTILLA].sort(),
      );
      expect(antes.every((p: { esPorDefecto: boolean }) => p.esPorDefecto)).toBe(true);

      const { body: guardada } = await request(servidor)
        .put('/config/plantillas/CONFIRMACION')
        .set(auth(gym.adminToken))
        .send({ asunto: 'Te esperamos en {{clase}}', cuerpoHtml: '<p>Hola {{alumno}}</p>' })
        .expect(200);

      expect(guardada).toEqual({
        tipo: 'CONFIRMACION',
        asunto: 'Te esperamos en {{clase}}',
        cuerpoHtml: '<p>Hola {{alumno}}</p>',
        esPorDefecto: false,
      });

      const { body: despues } = await request(servidor)
        .get('/config/plantillas')
        .set(auth(gym.adminToken))
        .expect(200);

      // Siguen siendo cinco: guardar la propia SUSTITUYE a la del codigo, no
      // anade una sexta entrada.
      expect(despues).toHaveLength(5);

      const confirmacion = despues.find((p: { tipo: string }) => p.tipo === 'CONFIRMACION');
      expect(confirmacion).toEqual({
        tipo: 'CONFIRMACION',
        asunto: 'Te esperamos en {{clase}}',
        cuerpoHtml: '<p>Hola {{alumno}}</p>',
        esPorDefecto: false,
      });

      const resto = despues.filter((p: { tipo: string }) => p.tipo !== 'CONFIRMACION');
      expect(resto.every((p: { esPorDefecto: boolean }) => p.esPorDefecto)).toBe(true);
    });

    it('un tipo de plantilla inventado es 400', async () => {
      // El tipo viene de la URL, asi que no pasa por el ValidationPipe: si nadie
      // lo comprobara a mano, llegaria a Prisma y saldria un 500.
      await request(servidor)
        .put('/config/plantillas/RECORDATORIO_DE_CUMPLEANOS')
        .set(auth(gym.adminToken))
        .send({ asunto: 'Felicidades', cuerpoHtml: '<p>Felicidades</p>' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Los avisos, que es lo que distingue esta fase
  // -------------------------------------------------------------------------
  describe('avisos', () => {
    it('reservar a mano manda un email', async () => {
      await configurarSmtp();

      const salaId = await crearSala();
      const turnoId = await crearTurno(salaId);
      const alumno = await helpers.crearAlumnoPorInvitacion(app, gym, [salaId]);
      // Sin el mes publicado el alumno no ve el turno: desde la Fase 3A el
      // descubrimiento exige que el mes este HABILITADO.
      await helpers.publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      await request(servidor)
        .post(`/turnos/${turnoId}/mi-reserva`)
        .set(auth(alumno.token))
        .expect(201);

      // El POST responde en cuanto commitea la reserva; el email sale DESPUES,
      // en el worker. Por eso se sondea.
      await helpers.esperarEmails(envios, 1);

      expect(envios.enviados).toHaveLength(1);
      const email = envios.enviados[0];

      expect(email.para).toBe(alumno.email);
      expect(email.desde).toBe(SMTP.emailOrigen);
      expect(email.host).toBe(SMTP.host);
      // La copia al salon va en BCC y sale de `emailDestino`.
      expect(email.copia).toBe(SMTP.emailDestino);
      // Plantilla CONFIRMACION por defecto: 'Reservaste {{clase}} para el {{fecha}}'.
      expect(email.asunto).toContain('Pilates');
      // El nombre con el que `crearAlumnoPorInvitacion` da de alta al alumno.
      expect(email.html).toContain('Alumno de Test');

      // El adaptador de memoria no guarda `smtp.clave` a proposito: este objeto
      // acaba impreso en el primer expect que falla.
      expect(JSON.stringify(envios.enviados)).not.toContain(CLAVE_SMTP);
    });

    /**
     * EL PUNTO 7 DEL CHECKLIST, y el caso por el que existe la regla de que las
     * reservas de origen RUTINA no avisan.
     *
     * Publicar un mes con una rutina son cuatro reservas por alumno; con treinta
     * alumnos, ciento veinte correos en el mismo minuto. Y ninguno dice nada: el
     * alumno ya sabe que va todos los martes.
     *
     * ⚠️ AQUI NO SE SONDEA, Y NO ES UN DESCUIDO. Lo que se comprueba es una
     * AUSENCIA: un sondeo del estilo de `esperarEmails` terminaria en su primera
     * vuelta —la bandeja esta vacia desde el principio— y daria verde aunque los
     * avisos salieran un segundo despues. La unica forma de comprobar que NO
     * llega nada es darle al worker tiempo de sobra para que llegue y mirar
     * entonces. Quien "arregle" esta espera fija convirtiendola en un sondeo
     * deja el test pasando siempre y probando nada.
     */
    it('publicar un mes NO manda ningun email', async () => {
      // Con SMTP configurado, para que la bandeja vacia signifique "no se quiso
      // mandar nada" y no "no habia por donde mandarlo".
      await configurarSmtp();

      const salaId = await crearSala();
      const alumno = await helpers.crearAlumnoPorInvitacion(app, gym, [salaId]);
      await crearRutina(alumno.perfilId, salaId);

      await helpers.publicarMes(app, gym.adminToken, salaId, ANIO, MES);

      // Primero: que la publicacion de verdad haya creado reservas. Sin esto, el
      // test pasaria igual con un planificador que no genera nada, que es la
      // forma mas facil de no mandar ningun email.
      const reservas = await prisma.base.reserva.count({ where: { tenantId: gym.tenantId } });
      expect(reservas).toBeGreaterThan(0);

      // SIN VERIFICAR: dos segundos es una estimacion, no una medida. Si al
      // correrlo se ve que el worker de avisos tarda mas, hay que subirlo: este
      // caso solo vale lo que valga esta espera.
      await new Promise((r) => setTimeout(r, 2_000));

      expect(envios.enviados).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Push
  // -------------------------------------------------------------------------
  describe('push', () => {
    it('sin VAPID, suscribirse a push es 503', async () => {
      const salaId = await crearSala();
      const alumno = await helpers.crearAlumnoPorInvitacion(app, gym, [salaId]);

      // 503 y no 400: el cuerpo es perfectamente valido. Lo que falta es una
      // capacidad del despliegue, no un dato del cliente.
      await request(servidor)
        .post('/push/suscripcion')
        .set(auth(alumno.token))
        .send({
          endpoint: 'https://push.example.test/suscripcion/abcdef',
          p256dh: 'BFakeP256dhKeyParaElTest',
          auth: 'FakeAuthSecret',
        })
        .expect(503);
    });
  });
});
