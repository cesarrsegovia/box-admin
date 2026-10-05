import { Injectable, NotFoundException } from '@nestjs/common';
import {
  aFechaISO,
  comienzoDeHoyUtc,
  type PackEnLanding,
  type PreguntaPublica,
  type SalonPublico,
  type TestimonioPublico,
  type TurnoLibrePublico,
} from '@boxadmin/shared';
import { runUnscoped, runWithTenant } from '../common/tenant/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { ORDEN_DE_CONTENIDO } from './web-salon.service';

/**
 * EL MISMO 404 PARA LOS CUATRO CASOS: slug que no existe, tenant desactivado,
 * gimnasio sin fila de `WebSalonConfig`, y `activa: false`.
 *
 * Es una constante y no cuatro `new NotFoundException(...)` repartidos a
 * proposito. Distinguirlos convierte este endpoint en un DIRECTORIO DE
 * GIMNASIOS: cualquiera prueba nombres y, por la diferencia entre "no existe" y
 * "existe pero esta apagada", averigua cuales existen. Con un unico mensaje no
 * hay nada que enumerar, y tenerlo en un solo sitio es lo que impide que un
 * cambio futuro desempate uno de los cuatro sin querer.
 */
export const NO_HAY_WEB = 'No hay ninguna web publicada en esa direccion';

/**
 * Cuantos dias de agenda se publican cuando `mostrarTurnosLibres` esta
 * encendido.
 *
 * Una semana: es lo que alguien que mira la landing puede llegar a planificar,
 * y es poco suficiente como para que publicar la agenda no sea publicar el
 * calendario entero del gimnasio.
 */
const DIAS_DE_AGENDA = 7;

/**
 * Tope de turnos devueltos. Una landing no pagina, y sin tope un gimnasio con
 * ocho salas mete cientos de filas en una pagina publica y sin sesion.
 */
const MAXIMO_TURNOS = 100;

/**
 * Cuantos turnos se LEEN para quedarse con los `MAXIMO_TURNOS` que tienen
 * lugar.
 *
 * Son dos numeros y no uno porque el filtro de "tiene lugar" se hace en
 * memoria: Prisma no sabe comparar una cuenta de relacion contra otra columna
 * dentro del `where`. Con un solo tope, un gimnasio cuyos primeros cien turnos
 * esten llenos publicaria una agenda vacia teniendo lugares libres el viernes.
 * El pool es el tope de lo que la base tiene que devolver para que eso no pase.
 */
const TURNOS_LEIDOS = 500;

const UN_DIA_MS = 24 * 60 * 60 * 1000;

/** Fila de turno tal como la devuelve el `select` de `turnosLibres`. */
interface FilaTurnoLibre {
  nombre: string;
  fecha: Date;
  horaInicio: string;
  cupo: number;
  sala: { nombre: string };
  _count: { reservas: number };
}

@Injectable()
export class PublicoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lo que ve cualquiera, sin sesion, en `GET /public/salon/:slug`.
   *
   * ES EL UNICO ENDPOINT SIN SESION QUE LEE DATOS DE UN GIMNASIO, y se audita
   * por lo que NO manda: ni un email, ni un id de perfil, ni el nombre de una
   * profesora, ni cuantos alumnos hay. Cada campo del objeto que se devuelve
   * esta escrito a mano abajo; lo que no esta ahi no sale.
   *
   * `ahora` es inyectable para los tests; en produccion es el reloj.
   */
  async salon(slug: string, ahora: Date = new Date()): Promise<SalonPublico> {
    // `runUnscoped` ENVUELVE UNA SOLA CONSULTA: la que resuelve el slug a un
    // tenant, que por definicion no puede correr dentro de un gimnasio porque
    // es la que decide cual es. Todo lo demas va dentro de `runWithTenant`.
    //
    // Es el patron que `auth.service.ts` usa para el login desde la Fase 0, y
    // la regla es que esta ventana sea de una linea y se vea. Ensancharla a
    // todo el metodo es desactivar el aislamiento para el endpoint publico, que
    // es el peor sitio del sistema donde se puede desactivar: ahi no hay JWT
    // que limite nada, y una consulta sin filtro devolveria los packs y los
    // testimonios de todos los gimnasios a quien pase por la URL.
    //
    // Va por `this.prisma.db` y no por `this.prisma.base`: `Tenant` es un
    // modelo GLOBAL para la extension, asi que el cliente extendido lo deja
    // pasar igual, y asi la unica puerta de salida del aislamiento sigue siendo
    // `runUnscoped` y no "el cliente que no lo tiene".
    //
    // `async () => await ...` Y NO `() => ...`: una PrismaPromise es PEREZOSA,
    // asi que una lambda que la DEVUELVE sin esperarla sale de runUnscoped
    // antes de que la consulta arranque, y la consulta se ejecuta ya fuera del
    // AsyncLocalStorage -> MissingTenantContextError y un 500 en CADA llamada
    // al endpoint publico. Es el mismo `await` explicito que `auth.service.ts`
    // tiene en sus tres runUnscoped desde la Fase 0.
    const tenant = await runUnscoped(
      async () =>
        await this.prisma.db.tenant.findUnique({
          where: { slug },
          select: { id: true, nombre: true, activo: true },
        }),
    );

    // Los dos primeros de los cuatro casos del mismo 404.
    if (tenant === null || !tenant.activo) throw new NotFoundException(NO_HAY_WEB);

    return await runWithTenant(tenant.id, async () => {
      const config = await this.prisma.db.webSalonConfig.findFirst({
        select: {
          activa: true,
          colorPrimario: true,
          colorSecundario: true,
          tituloPrincipal: true,
          tagline: true,
          sobreElSalon: true,
          imagenPrincipalUrl: true,
          whatsapp: true,
          instagram: true,
          linkExtra: true,
          mostrarPrecios: true,
          mostrarTestimonios: true,
          mostrarFAQ: true,
          mostrarTurnosLibres: true,
          planDestacadoId: true,
        },
      });

      // Los otros dos: sin fila la web esta apagada, e `activa: false` es
      // apagarla a mano. Mismo 404 que un slug inventado.
      if (config === null || !config.activa) throw new NotFoundException(NO_HAY_WEB);

      return {
        nombre: tenant.nombre,
        colorPrimario: config.colorPrimario,
        colorSecundario: config.colorSecundario,
        tituloPrincipal: config.tituloPrincipal,
        tagline: config.tagline,
        sobreElSalon: config.sobreElSalon,
        imagenPrincipalUrl: config.imagenPrincipalUrl,
        whatsapp: config.whatsapp,
        instagram: config.instagram,
        linkExtra: config.linkExtra,

        // UNA BANDERA APAGADA SIGNIFICA QUE EL DATO NO SALE DEL SERVIDOR.
        //
        // No que salga con un `false` al lado para que el cliente lo esconda:
        // si el servidor lo manda, los precios ya estan en el HTML, en la cache
        // del navegador y en el primer "ver codigo fuente". `undefined` no se
        // serializa en JSON, asi que la clave directamente no existe en el
        // cuerpo, y eso es lo que afirman los tests: sobre el cuerpo
        // serializado, no sobre el objeto.
        //
        // Las cuatro consultas van condicionadas y no filtradas despues: con la
        // bandera apagada el dato ni se lee de la base.
        ...(config.mostrarPrecios ? { packs: await this.packs(config.planDestacadoId) } : {}),
        ...(config.mostrarTestimonios ? { testimonios: await this.testimonios() } : {}),
        ...(config.mostrarFAQ ? { preguntas: await this.preguntas() } : {}),
        ...(config.mostrarTurnosLibres ? { turnosLibres: await this.turnosLibres(ahora) } : {}),
      };
    });
  }

  /**
   * Los packs que se muestran en la landing.
   *
   * SOLO LOS ACTIVOS. Un pack dado de baja sigue existiendo porque hay alumnos
   * colgando de el; publicarlo seria ofrecer un plan que ya no se vende.
   *
   * El `id` se lee para poder marcar el destacado y NO SE DEVUELVE. `precio`
   * sale por `toFixed(2)` sobre el Decimal y no por `Number(...)`: convertirlo
   * a number aqui reintroduciria el error de coma flotante que el Decimal
   * existe para evitar, en la unica pantalla del sistema donde el precio lo lee
   * alguien que todavia no es cliente.
   */
  private async packs(planDestacadoId: string | null): Promise<PackEnLanding[]> {
    const filas = await this.prisma.db.pack.findMany({
      where: { activo: true },
      select: { id: true, nombre: true, precio: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });

    return filas.map((pack) => ({
      nombre: pack.nombre,
      precio: pack.precio === null ? null : pack.precio.toFixed(2),
      destacado: pack.id === planDestacadoId,
    }));
  }

  /**
   * EL `select` NO BASTA Y POR ESO ADEMAS SE MAPEA CAMPO A CAMPO.
   *
   * Un `select` es una promesa sobre la CONSULTA; el mapeo es una promesa sobre
   * la RESPUESTA, y solo la segunda sobrevive al dia en que alguien ensanche el
   * `select` para depurar algo. Devolver `findMany` tal cual es lo que haria
   * que ese dia el `id` y el `tenantId` de cada testimonio salieran por una
   * pagina indexada sin que ningun test se enterara. Aqui el coste de la
   * redundancia es una linea por campo.
   */
  private async testimonios(): Promise<TestimonioPublico[]> {
    const filas = await this.prisma.db.testimonio.findMany({
      select: { nombre: true, texto: true },
      orderBy: [...ORDEN_DE_CONTENIDO],
    });

    return filas.map((fila) => ({ nombre: fila.nombre, texto: fila.texto }));
  }

  /** Ver `testimonios`. */
  private async preguntas(): Promise<PreguntaPublica[]> {
    const filas = await this.prisma.db.preguntaFrecuente.findMany({
      select: { pregunta: true, respuesta: true },
      orderBy: [...ORDEN_DE_CONTENIDO],
    });

    return filas.map((fila) => ({ pregunta: fila.pregunta, respuesta: fila.respuesta }));
  }

  /**
   * Los turnos con lugar de la proxima semana.
   *
   * LA VENTANA SE CALCULA EN UTC Y NO EN LA ZONA DEL GIMNASIO, a diferencia de
   * la del check-in. Es deliberado: la regla de esta fase es que la zona se use
   * en DOS sitios —la ventana del check-in y el patron del cron— y en ninguno
   * mas. Aqui se compara una columna `@db.Date` contra un rango de dias, y para
   * eso el dia UTC es el mismo dia en todas partes. El unico efecto visible es
   * que una clase de hoy que ya empezo sigue listada hasta que cambia el dia
   * UTC, y eso es preferible a meter un tercer uso de la zona horaria.
   *
   * NO SALE LA PROFESORA. El `select` no la toca, y es la omision mas facil de
   * deshacer sin querer: el resto del sistema la trae en casi todas las
   * consultas de turnos. El nombre de quien trabaja ahi no es dato de una
   * pagina publica.
   *
   * Tampoco sale el cupo ni cuantos lugares quedan: "cuan vacio esta el
   * gimnasio" es exactamente lo que el checklist pide no publicar de mas. La
   * cuenta se usa para FILTRAR y se descarta.
   */
  private async turnosLibres(ahora: Date): Promise<TurnoLibrePublico[]> {
    const desde = comienzoDeHoyUtc(ahora);
    const hasta = new Date(desde.getTime() + DIAS_DE_AGENDA * UN_DIA_MS);

    const filas = (await this.prisma.db.turno.findMany({
      where: {
        fecha: { gte: desde, lt: hasta },
        // Una sala apagada o no visible para los alumnos tampoco se publica a
        // quien no tiene ni cuenta.
        sala: { activa: true, visibleAlumnos: true },
      },
      select: {
        nombre: true,
        fecha: true,
        horaInicio: true,
        cupo: true,
        sala: { select: { nombre: true } },
        // Las canceladas NO ocupan lugar: la reserva nunca se borra, se cancela.
        // El `where` del `_count` es la unica pieza que lo garantiza; sin el,
        // un turno de cupo 10 con 8 reservas vivas y 2 canceladas desaparece de
        // la landing por lleno teniendo dos lugares. Hay un e2e dedicado.
        _count: { select: { reservas: { where: { canceladaEn: null } } } },
      },
      orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
      take: TURNOS_LEIDOS,
    })) as FilaTurnoLibre[];

    return filas
      .filter((turno) => turno._count.reservas < turno.cupo)
      .slice(0, MAXIMO_TURNOS)
      .map((turno) => ({
        fecha: aFechaISO(turno.fecha),
        horaInicio: turno.horaInicio,
        // `clase` sale de `Turno.nombre`: la columna se llama `nombre` y
        // "clase" es como se le dice de cara al alumno, igual que en las
        // plantillas de la Fase 5B.
        clase: turno.nombre,
        salaNombre: turno.sala.nombre,
      }));
  }
}
