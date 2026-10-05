/**
 * Los e2e de la web publica del salon (Fase 6B, tarea 9).
 *
 * `GET /public/salon/:slug` es EL UNICO ENDPOINT DEL SISTEMA SIN SESION QUE LEE
 * DATOS DE UN GIMNASIO, asi que esta suite no es humo: es la auditoria de que
 * sale por esa puerta.
 *
 * COMO SE AUDITA, QUE ES LO QUE DA VALOR A ESTA SUITE. El cuerpo se compara
 * ENTERO contra un objeto escrito a mano, no con `toHaveProperty` ni buscando
 * subcadenas prohibidas. La razon es historia de esta misma fase:
 *
 * 1. Auditar por LISTA NEGRA —sembrar un email conocido y buscarlo en la
 *    respuesta— deja pasar cualquier campo que nadie penso en nombrar. Anadir
 *    el `id` del pack al contrato pasaba los siete tests que lo intentaban.
 * 2. Auditar por CLAVES EXACTAS tampoco alcanza: una fuga dentro de un valor
 *    legitimo —meter los lugares libres en el nombre de la clase, "Pilates (8
 *    lugares libres)"— deja las claves identicas y pasa igual.
 *
 * Solo comparar el objeto entero contra un valor esperado explicito atrapa las
 * dos. Y el gimnasio se siembra CON RUIDO —un alumno con email, una profesora
 * con nombre, reservas, un pack dado de baja, una sala oculta, contenido de
 * otro gimnasio— para que ese "entero" signifique algo: que el cuerpo sea
 * exactamente el esperado teniendo todo eso al lado vale mas que diez
 * afirmaciones de ausencia.
 *
 * ⚠️ Lo que esta suite NO puede ver: que el cliente no pinte algo que el
 * servidor si manda. Eso vive en `apps/web`.
 */

import type { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import {
  crearAlumnoPorInvitacion,
  crearAppDeTest,
  crearGimnasio,
  crearProfesor,
  limpiarBaseDeDatos,
  type EntornoE2E,
  type GimnasioDeTest,
} from './helpers';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * El mismo literal que `NO_HAY_WEB` del service, ESCRITO A MANO.
 *
 * No se importa de `src` a proposito: si el test leyera la constante del codigo
 * que prueba, cambiar el mensaje por el nombre del gimnasio ("El salon X no
 * tiene web") seguiria en verde. Aqui el mensaje es parte del contrato de
 * seguridad —es lo que hace indistinguibles los cuatro caminos— asi que el
 * test lo fija.
 */
const NO_HAY_WEB = 'No hay ninguna web publicada en esa direccion';

/**
 * `YYYY-MM-DD` de hoy UTC mas `offsetDias`.
 *
 * UTC y no la zona del gimnasio porque la ventana de `turnosLibres` se calcula
 * en UTC a proposito (ver el comentario de `PublicoService.turnosLibres`): la
 * zona horaria se usa en dos sitios del sistema, y este no es uno.
 */
function diaUtc(offsetDias: number): string {
  return new Date(Date.now() + offsetDias * UN_DIA_MS).toISOString().slice(0, 10);
}

/** La respuesta de error sin los dos campos que el `AllExceptionsFilter` hace variar. */
function sinRuidoDelFiltro(cuerpo: Record<string, unknown>): Record<string, unknown> {
  // `path` es la URL que el propio cliente pidio y `timestamp` es el reloj:
  // ninguno de los dos puede servir de oraculo sobre que gimnasios existen, y
  // los dos difieren entre llamadas por construccion. Todo lo demas SI se
  // compara, que es el punto del caso de los cuatro 404.
  const { path, timestamp, ...resto } = cuerpo;
  void path;
  void timestamp;
  return resto;
}

interface Escenario {
  gym: GimnasioDeTest;
  /** La sala que los alumnos ven. Sus turnos pueden salir en la landing. */
  salaId: string;
  /** Una sala apagada para los alumnos. Sus turnos NO pueden salir. */
  salaOcultaId: string;
  packDestacadoId: string;
  alumnoPerfilId: string;
  profesorPerfilId: string;
}

describe('Fase 6B — la web publica del salon (e2e)', () => {
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

  /** Un gimnasio con TODO el ruido que no tiene que salir por la puerta publica. */
  async function montar(slug: string): Promise<Escenario> {
    const gym = await crearGimnasio(app, slug);

    const sala = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala Grande', cupoBase: 10, visibleAlumnos: true })
      .expect(201);

    const salaOculta = await request(servidor)
      .post('/salas')
      .set(auth(gym.adminToken))
      .send({ nombre: 'Sala Privada', cupoBase: 10, visibleAlumnos: false })
      .expect(201);

    // RUIDO: una profesora con nombre y apellido. El resto del sistema la trae
    // en casi todas las consultas de turnos, asi que es la omision mas facil de
    // deshacer sin querer en el `select` de la landing.
    const profesora = await crearProfesor(app, gym, [sala.body.id, salaOculta.body.id], {
      nombre: 'Fati Gomez',
      email: `fati-${slug}@correo-privado.test`,
    });

    // RUIDO: un alumno con un email reconocible.
    const alumno = await crearAlumnoPorInvitacion(app, gym, [sala.body.id], {
      email: `ana.perez-${slug}@correo-privado.test`,
    });

    const packDestacado = await crearPack(gym, { nombre: 'Mensual 8', precio: '18500.50' });
    await crearPack(gym, { nombre: 'Total 20' });

    // RUIDO: un pack dado de baja. Sigue existiendo porque hay alumnos
    // colgando de el, pero publicarlo seria ofrecer un plan que ya no se vende.
    const packViejo = await crearPack(gym, { nombre: 'Promo Vieja', precio: '9999.99' });
    await request(servidor).delete(`/packs/${packViejo}`).set(auth(gym.adminToken)).expect(200);

    return {
      gym,
      salaId: sala.body.id,
      salaOcultaId: salaOculta.body.id,
      packDestacadoId: packDestacado,
      alumnoPerfilId: alumno.perfilId,
      profesorPerfilId: profesora.perfilId,
    };
  }

  async function crearPack(
    gym: GimnasioDeTest,
    datos: { nombre: string; precio?: string },
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/packs')
      .set(auth(gym.adminToken))
      .send({ tipo: 'MENSUAL', clasesPorMes: 8, ...datos })
      .expect(201);

    return body.id;
  }

  async function crearTurno(
    gym: GimnasioDeTest,
    datos: {
      salaId: string;
      nombre: string;
      fecha: string;
      horaInicio: string;
      horaFin: string;
      cupo: number;
      profesorId?: string;
    },
  ): Promise<string> {
    const { body } = await request(servidor)
      .post('/turnos')
      .set(auth(gym.adminToken))
      .send(datos)
      .expect(201);

    return body.id;
  }

  async function reservar(gym: GimnasioDeTest, turnoId: string, perfilId: string): Promise<string> {
    const { body } = await request(servidor)
      .post(`/turnos/${turnoId}/reservas`)
      .set(auth(gym.adminToken))
      .send({ perfilId })
      .expect(201);

    return body.id;
  }

  /** Enciende la web con la configuracion que pida el caso. */
  async function publicarWeb(
    gym: GimnasioDeTest,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await request(servidor)
      .put('/config/web-salon')
      .set(auth(gym.adminToken))
      .send({
        activa: true,
        colorPrimario: '#1b998b',
        colorSecundario: '#f0f3f5',
        tituloPrincipal: 'Entrena con nosotras',
        tagline: 'Pilates y funcional en el centro',
        sobreElSalon: 'Tres salas, diez profesoras y veinte anios.',
        imagenPrincipalUrl: 'https://cdn.ejemplo.test/portada.jpg',
        whatsapp: '+5491122334455',
        instagram: '@salondeprueba',
        linkExtra: 'https://ejemplo.test/reservas',
        ...extra,
      })
      .expect(200);
  }

  /**
   * Perfiles sembrados DIRECTAMENTE en la base, sin pasar por el alta.
   *
   * El alta de verdad hashea la contrasena con argon2, y los casos de conteo de
   * abajo necesitan diez o mas alumnos: por la API serian varios segundos de
   * hashing para probar una cuenta de SQL. Lo que importa aqui es que haya
   * perfiles distintos colgando de reservas distintas, y eso es lo que esto
   * hace. El resto de la suite si pasa por el alta real.
   */
  async function sembrarPerfiles(
    gym: GimnasioDeTest,
    cuantos: number,
    salaId: string,
  ): Promise<string[]> {
    const ids: string[] = [];

    for (let i = 0; i < cuantos; i++) {
      const usuario = await entorno.prisma.base.usuario.create({
        data: {
          tenantId: gym.tenantId,
          nombreCompleto: `Alumna Sembrada ${i}`,
          email: `sembrada-${i}-${gym.slug}@correo-privado.test`,
          passwordHash: 'no-se-usa',
          rol: 'ALUMNO',
        },
      });

      const perfil = await entorno.prisma.base.perfil.create({
        data: { tenantId: gym.tenantId, usuarioId: usuario.id },
      });

      // Sin la union con la sala, el alta de reserva responde 403: un alumno
      // solo reserva en las salas que tiene asignadas.
      await entorno.prisma.base.usuarioSala.create({
        data: { tenantId: gym.tenantId, perfilId: perfil.id, salaId },
      });

      ids.push(perfil.id);
    }

    return ids;
  }

  describe('se ve sin sesion, y solo lo que el gimnasio eligio publicar', () => {
    it('EL CUERPO ENTERO es exactamente el esperado, con todo el ruido sembrado al lado', async () => {
      const e = await montar('web-completa');

      // Dos testimonios y dos preguntas, con el `orden` cruzado respecto al de
      // creacion: asi el test tambien fija que la landing ordena por `orden` y
      // no por fecha de alta.
      await request(servidor)
        .post('/config/web-salon/testimonios')
        .set(auth(e.gym.adminToken))
        .send({ nombre: 'Marta', texto: 'Volvi a moverme despues de anios.', orden: 2 })
        .expect(201);
      await request(servidor)
        .post('/config/web-salon/testimonios')
        .set(auth(e.gym.adminToken))
        .send({ nombre: 'Lucia', texto: 'Las clases son chiquitas y eso se nota.', orden: 1 })
        .expect(201);

      await request(servidor)
        .post('/config/web-salon/faq')
        .set(auth(e.gym.adminToken))
        .send({ pregunta: 'Hay que reservar?', respuesta: 'Si, desde la app.', orden: 2 })
        .expect(201);
      await request(servidor)
        .post('/config/web-salon/faq')
        .set(auth(e.gym.adminToken))
        .send({ pregunta: 'Puedo probar?', respuesta: 'La primera clase es gratis.', orden: 1 })
        .expect(201);

      // RUIDO: contenido de OTRO gimnasio. Si la consulta publica corriera sin
      // el filtro de inquilino, esto apareceria en la landing de este.
      const otro = await crearGimnasio(app, 'web-del-vecino');
      await request(servidor)
        .post('/config/web-salon/testimonios')
        .set(auth(otro.adminToken))
        .send({ nombre: 'Del Vecino', texto: 'Esto es de otro gimnasio.', orden: 0 })
        .expect(201);
      await request(servidor)
        .post('/config/web-salon/faq')
        .set(auth(otro.adminToken))
        .send({ pregunta: 'Del vecino?', respuesta: 'Tampoco esto.', orden: 0 })
        .expect(201);

      const manana = diaUtc(1);
      const pasado = diaUtc(2);

      // Un turno con lugar, con profesora asignada: tiene que salir, y SIN ella.
      await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Pilates',
        fecha: manana,
        horaInicio: '09:00',
        horaFin: '10:00',
        cupo: 2,
        profesorId: e.profesorPerfilId,
      });

      // Un turno LLENO: no sale.
      const lleno = await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Funcional',
        fecha: manana,
        horaInicio: '10:00',
        horaFin: '11:00',
        cupo: 1,
      });
      await reservar(e.gym, lleno, e.alumnoPerfilId);

      // Un turno con lugar pero en una sala que los alumnos no ven: no sale.
      await crearTurno(e.gym, {
        salaId: e.salaOcultaId,
        nombre: 'Personalizado',
        fecha: pasado,
        horaInicio: '08:00',
        horaFin: '09:00',
        cupo: 5,
      });

      // Un turno con lugar fuera de la semana que se publica: no sale.
      await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Yoga',
        fecha: diaUtc(9),
        horaInicio: '08:00',
        horaFin: '09:00',
        cupo: 5,
      });

      await publicarWeb(e.gym, {
        mostrarPrecios: true,
        mostrarTestimonios: true,
        mostrarFAQ: true,
        mostrarTurnosLibres: true,
        planDestacadoId: e.packDestacadoId,
      });

      // SIN NINGUNA CABECERA: ni Authorization ni nada.
      const { body } = await request(servidor).get('/public/salon/web-completa').expect(200);

      expect(body).toEqual({
        nombre: 'web-completa',
        colorPrimario: '#1b998b',
        colorSecundario: '#f0f3f5',
        tituloPrincipal: 'Entrena con nosotras',
        tagline: 'Pilates y funcional en el centro',
        sobreElSalon: 'Tres salas, diez profesoras y veinte anios.',
        imagenPrincipalUrl: 'https://cdn.ejemplo.test/portada.jpg',
        whatsapp: '+5491122334455',
        instagram: '@salondeprueba',
        linkExtra: 'https://ejemplo.test/reservas',
        packs: [
          // Ordenados por nombre. "Promo Vieja" esta dada de baja y no figura
          // aunque alfabeticamente caeria en el medio.
          { nombre: 'Mensual 8', precio: '18500.50', destacado: true },
          { nombre: 'Total 20', precio: null, destacado: false },
        ],
        testimonios: [
          { nombre: 'Lucia', texto: 'Las clases son chiquitas y eso se nota.' },
          { nombre: 'Marta', texto: 'Volvi a moverme despues de anios.' },
        ],
        preguntas: [
          { pregunta: 'Puedo probar?', respuesta: 'La primera clase es gratis.' },
          { pregunta: 'Hay que reservar?', respuesta: 'Si, desde la app.' },
        ],
        turnosLibres: [
          { fecha: manana, horaInicio: '09:00', clase: 'Pilates', salaNombre: 'Sala Grande' },
        ],
      });
    });

    it('una bandera apagada OMITE la clave: no viaja con un false al lado', async () => {
      const e = await montar('web-apagadas');

      await request(servidor)
        .post('/config/web-salon/testimonios')
        .set(auth(e.gym.adminToken))
        .send({ nombre: 'Marta', texto: 'Esto no tiene que viajar.' })
        .expect(201);
      await request(servidor)
        .post('/config/web-salon/faq')
        .set(auth(e.gym.adminToken))
        .send({ pregunta: 'Esto tampoco?', respuesta: 'Tampoco.' })
        .expect(201);
      await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Pilates',
        fecha: diaUtc(1),
        horaInicio: '09:00',
        horaFin: '10:00',
        cupo: 5,
      });

      await publicarWeb(e.gym, {
        mostrarPrecios: false,
        mostrarTestimonios: false,
        mostrarFAQ: false,
        mostrarTurnosLibres: false,
      });

      const respuesta = await request(servidor).get('/public/salon/web-apagadas').expect(200);

      // SOBRE EL CUERPO SERIALIZADO, no sobre el objeto: `undefined` no se
      // serializa, y lo que se afirma es que la clave NO ESTA EN EL JSON. Un
      // `toEqual` sobre el objeto ya parseado trata `{a: undefined}` y `{}`
      // como iguales, asi que no distinguiria "no sale" de "sale vacio".
      const crudo = respuesta.text;
      expect(crudo).not.toContain('packs');
      expect(crudo).not.toContain('testimonios');
      expect(crudo).not.toContain('preguntas');
      expect(crudo).not.toContain('turnosLibres');

      expect(respuesta.body).toEqual({
        nombre: 'web-apagadas',
        colorPrimario: '#1b998b',
        colorSecundario: '#f0f3f5',
        tituloPrincipal: 'Entrena con nosotras',
        tagline: 'Pilates y funcional en el centro',
        sobreElSalon: 'Tres salas, diez profesoras y veinte anios.',
        imagenPrincipalUrl: 'https://cdn.ejemplo.test/portada.jpg',
        whatsapp: '+5491122334455',
        instagram: '@salondeprueba',
        linkExtra: 'https://ejemplo.test/reservas',
      });
    });

    it('un pack dado de baja desaparece de la landing sin tocar nada mas', async () => {
      const e = await montar('web-packs');
      await publicarWeb(e.gym, { mostrarPrecios: true, planDestacadoId: e.packDestacadoId });

      const antes = await request(servidor).get('/public/salon/web-packs').expect(200);
      expect(antes.body.packs).toEqual([
        { nombre: 'Mensual 8', precio: '18500.50', destacado: true },
        { nombre: 'Total 20', precio: null, destacado: false },
      ]);

      await request(servidor)
        .delete(`/packs/${e.packDestacadoId}`)
        .set(auth(e.gym.adminToken))
        .expect(200);

      const despues = await request(servidor).get('/public/salon/web-packs').expect(200);
      expect(despues.body.packs).toEqual([{ nombre: 'Total 20', precio: null, destacado: false }]);
    });
  });

  describe('los caminos al 404 son indistinguibles entre si', () => {
    it('slug inexistente, gimnasio inactivo, web apagada, sin configuracion y slug mal formado dan la MISMA respuesta', async () => {
      // 1. Un gimnasio que nunca toco la web: no hay fila de configuracion.
      await crearGimnasio(app, 'cuatro-sin-config');

      // 2. Un gimnasio con la web guardada pero apagada a mano.
      const apagada = await crearGimnasio(app, 'cuatro-apagada');
      await publicarWeb(apagada, { activa: false });

      // 3. Un gimnasio con la web encendida pero el inquilino desactivado. Se
      //    hace por la base porque no hay endpoint que desactive un inquilino.
      const inactiva = await crearGimnasio(app, 'cuatro-inactiva');
      await publicarWeb(inactiva);
      await entorno.prisma.base.tenant.update({
        where: { id: inactiva.tenantId },
        data: { activo: false },
      });

      const respuestas = await Promise.all([
        request(servidor).get('/public/salon/cuatro-no-existe'),
        request(servidor).get('/public/salon/cuatro-sin-config'),
        request(servidor).get('/public/salon/cuatro-apagada'),
        request(servidor).get('/public/salon/cuatro-inactiva'),
        // El quinto camino: un slug que ni siquiera tiene la forma de un slug.
        // Lo corta el controller ANTES de la base, y tiene que dar el mismo
        // 404 y no un 400: un 400 por "mal formado" y un 404 por "no hay web"
        // ya son dos respuestas distintas, y cada una estrecha la lista.
        request(servidor).get('/public/salon/Cuatro_Mal_Formado'),
      ]);

      // ESPERADO ESCRITO A MANO, y no "todas iguales entre si": si el service
      // dejara de lanzar y las cinco devolvieran un 200 vacio, "todas iguales"
      // seguiria en verde.
      const esperado = { statusCode: 404, message: NO_HAY_WEB, error: 'Not Found' };

      for (const respuesta of respuestas) {
        expect(respuesta.status).toBe(404);
        // El cuerpo ENTERO, no solo el `message`: el 404 que ve el cliente pasa
        // por el `AllExceptionsFilter`, y si esa capa agregara un campo que
        // distinga un camino de otro, el oraculo que dice que gimnasios existen
        // se vuelve a abrir sin que el service cambie ni una linea.
        expect(sinRuidoDelFiltro(respuesta.body)).toEqual(esperado);
      }

      // Y entre si, por si algun dia el esperado se escribe mal.
      const cuerpos = respuestas.map((r) => JSON.stringify(sinRuidoDelFiltro(r.body)));
      expect(new Set(cuerpos).size).toBe(1);
    });

    it('apagar la web devuelve el gimnasio al mismo 404 del que existe sin web', async () => {
      const e = await montar('web-encender-apagar');

      await publicarWeb(e.gym, { activa: true });
      await request(servidor).get('/public/salon/web-encender-apagar').expect(200);

      await publicarWeb(e.gym, { activa: false });
      const apagado = await request(servidor).get('/public/salon/web-encender-apagar').expect(404);

      expect(sinRuidoDelFiltro(apagado.body)).toEqual({
        statusCode: 404,
        message: NO_HAY_WEB,
        error: 'Not Found',
      });
    });
  });

  /**
   * `turnosLibres` es la unica consulta del modulo que usa construcciones que
   * ningun unitario ejerce contra Postgres: un `_count` filtrado y un filtro
   * por relacion anidada. Hasta estos e2e nunca habia corrido contra filas de
   * verdad.
   */
  describe('turnosLibres contra filas de verdad', () => {
    it('UNA RESERVA CANCELADA NO OCUPA LUGAR: cupo 10 con 8 vivas y 2 canceladas sigue saliendo', async () => {
      const e = await montar('web-canceladas');

      const turnoId = await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Pilates',
        fecha: diaUtc(1),
        horaInicio: '09:00',
        horaFin: '10:00',
        cupo: 10,
      });

      const perfiles = await sembrarPerfiles(e.gym, 10, e.salaId);

      for (const perfilId of perfiles.slice(0, 8)) {
        await reservar(e.gym, turnoId, perfilId);
      }

      for (const perfilId of perfiles.slice(8)) {
        const reservaId = await reservar(e.gym, turnoId, perfilId);
        await request(servidor)
          .delete(`/reservas/${reservaId}?tipo=recuperable`)
          .set(auth(e.gym.adminToken))
          .expect(200);
      }

      // La base tiene DIEZ filas de reserva en un turno de cupo diez. Dos estan
      // canceladas, asi que quedan dos lugares libres y el turno tiene que
      // salir. Si el `_count` contara tambien las canceladas, el turno
      // desapareceria de la landing por lleno.
      const vivas = await entorno.prisma.base.reserva.count({
        where: { turnoId, canceladaEn: null },
      });
      const todas = await entorno.prisma.base.reserva.count({ where: { turnoId } });
      expect([vivas, todas]).toEqual([8, 10]);

      await publicarWeb(e.gym, { mostrarTurnosLibres: true });

      const { body } = await request(servidor).get('/public/salon/web-canceladas').expect(200);

      expect(body.turnosLibres).toEqual([
        { fecha: diaUtc(1), horaInicio: '09:00', clase: 'Pilates', salaNombre: 'Sala Grande' },
      ]);
    });

    it('un turno exactamente lleno no sale, y liberar un lugar lo devuelve', async () => {
      const e = await montar('web-lleno');

      const turnoId = await crearTurno(e.gym, {
        salaId: e.salaId,
        nombre: 'Funcional',
        fecha: diaUtc(1),
        horaInicio: '19:00',
        horaFin: '20:00',
        cupo: 2,
      });

      const perfiles = await sembrarPerfiles(e.gym, 2, e.salaId);
      const reservas = [
        await reservar(e.gym, turnoId, perfiles[0]),
        await reservar(e.gym, turnoId, perfiles[1]),
      ];

      await publicarWeb(e.gym, { mostrarTurnosLibres: true });

      const lleno = await request(servidor).get('/public/salon/web-lleno').expect(200);
      expect(lleno.body.turnosLibres).toEqual([]);

      await request(servidor)
        .delete(`/reservas/${reservas[0]}?tipo=definitiva`)
        .set(auth(e.gym.adminToken))
        .expect(200);

      const conLugar = await request(servidor).get('/public/salon/web-lleno').expect(200);
      expect(conLugar.body.turnosLibres).toEqual([
        { fecha: diaUtc(1), horaInicio: '19:00', clase: 'Funcional', salaNombre: 'Sala Grande' },
      ]);
    });

    it('SE LEEN MAS TURNOS DE LOS QUE SE PUBLICAN: el libre que esta detras de 120 llenos sale igual', async () => {
      const e = await montar('web-dos-topes');
      const [perfilId] = await sembrarPerfiles(e.gym, 1, e.salaId);

      // 120 turnos LLENOS, todos antes del libre en el orden de la consulta
      // (fecha, horaInicio, id). Son mas que el tope de publicacion (100) y
      // menos que el de lectura (500): si los dos topes fueran el mismo numero,
      // la base devolveria 100 turnos llenos, el filtro los descartaria todos y
      // la agenda saldria vacia teniendo un lugar libre.
      const llenos = 120;
      for (let i = 0; i < llenos; i++) {
        const turnoId = await sembrarTurno(e, {
          nombre: `Llena ${i}`,
          fecha: diaUtc(1),
          horaInicio: horaDelIndice(i),
          cupo: 1,
        });
        await entorno.prisma.base.reserva.create({
          data: { tenantId: e.gym.tenantId, turnoId, perfilId, origen: 'ADMIN' },
        });
      }

      await sembrarTurno(e, {
        nombre: 'La ultima con lugar',
        fecha: diaUtc(2),
        horaInicio: '23:55',
        cupo: 5,
      });

      await publicarWeb(e.gym, { mostrarTurnosLibres: true });

      const { body } = await request(servidor).get('/public/salon/web-dos-topes').expect(200);

      expect(body.turnosLibres).toEqual([
        {
          fecha: diaUtc(2),
          horaInicio: '23:55',
          clase: 'La ultima con lugar',
          salaNombre: 'Sala Grande',
        },
      ]);
    });

    it('la agenda publica se corta en 100 turnos aunque haya mas con lugar', async () => {
      const e = await montar('web-tope-publicado');

      const cuantos = 130;
      for (let i = 0; i < cuantos; i++) {
        await sembrarTurno(e, {
          nombre: `Libre ${i}`,
          fecha: diaUtc(1),
          horaInicio: horaDelIndice(i),
          cupo: 5,
        });
      }

      await publicarWeb(e.gym, { mostrarTurnosLibres: true });

      const { body } = await request(servidor).get('/public/salon/web-tope-publicado').expect(200);

      // Una landing no pagina: sin tope, un gimnasio con ocho salas mete
      // cientos de filas en una pagina publica y sin sesion.
      expect(body.turnosLibres).toHaveLength(100);
      expect(body.turnosLibres[0]).toEqual({
        fecha: diaUtc(1),
        horaInicio: horaDelIndice(0),
        clase: 'Libre 0',
        salaNombre: 'Sala Grande',
      });
    });
  });

  /** Turnos sembrados en la base: los casos de volumen no caben por la API. */
  async function sembrarTurno(
    e: Escenario,
    datos: { nombre: string; fecha: string; horaInicio: string; cupo: number },
  ): Promise<string> {
    const turno = await entorno.prisma.base.turno.create({
      data: {
        tenantId: e.gym.tenantId,
        salaId: e.salaId,
        nombre: datos.nombre,
        fecha: new Date(`${datos.fecha}T00:00:00.000Z`),
        horaInicio: datos.horaInicio,
        horaFin: '23:59',
        cupo: datos.cupo,
      },
    });

    return turno.id;
  }

  /**
   * Horas distintas para cada indice: `@@unique([tenantId, salaId, fecha,
   * horaInicio])` impide dos turnos a la misma hora en la misma sala. De cinco
   * en cinco minutos entran 288 por dia, de sobra para los casos de volumen.
   */
  function horaDelIndice(i: number): string {
    const minutos = i * 5;
    const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
    const mm = String(minutos % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }
});
