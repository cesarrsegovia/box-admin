import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  ConfiguracionWebSalon,
  JwtPayload,
  PreguntaAdmin,
  TestimonioAdmin,
} from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearFaqDto } from './dto/crear-faq.dto';
import type { CrearTestimonioDto } from './dto/crear-testimonio.dto';
import type { GuardarWebSalonDto } from './dto/guardar-web-salon.dto';

/**
 * Lo que ve un gimnasio que nunca toco la web.
 *
 * Los mismos valores que los `@default` del schema, a proposito y por el mismo
 * motivo que `CONFIG_CHECKIN_POR_DEFECTO`: la ausencia de fila tiene que
 * significar lo mismo en la pantalla y en la base. `activa: false` es la pieza
 * importante: sin fila la web esta APAGADA, no "a medio configurar".
 */
export const WEB_SALON_POR_DEFECTO = {
  activa: false,
  colorPrimario: '#000000',
  colorSecundario: '#ffffff',
  tituloPrincipal: null,
  tagline: null,
  sobreElSalon: null,
  imagenPrincipalUrl: null,
  whatsapp: null,
  instagram: null,
  linkExtra: null,
  mostrarPrecios: true,
  mostrarTestimonios: false,
  mostrarFAQ: false,
  mostrarTurnosLibres: false,
  planDestacadoId: null,
} as const;

/** Fila de configuracion tal como vive en la base. */
interface FilaWebSalon {
  activa: boolean;
  colorPrimario: string;
  colorSecundario: string;
  tituloPrincipal: string | null;
  tagline: string | null;
  sobreElSalon: string | null;
  imagenPrincipalUrl: string | null;
  whatsapp: string | null;
  instagram: string | null;
  linkExtra: string | null;
  mostrarPrecios: boolean;
  mostrarTestimonios: boolean;
  mostrarFAQ: boolean;
  mostrarTurnosLibres: boolean;
  planDestacadoId: string | null;
}

/**
 * Las columnas que se leen de `web_salon_config` en el lado admin.
 *
 * Es un `select` explicito y no la fila entera: asi el dia que el modelo crezca
 * no se escapa una columna nueva por el contrato sin que nadie lo decida. Es la
 * misma disciplina que `config-checkin.service.ts`.
 */
const COLUMNAS_DE_CONFIG = {
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
} as const;

/**
 * El orden en el que salen testimonios y preguntas, aqui y en la landing.
 *
 * El desempate por `id` NO sobra: con dos filas del mismo `orden`, Postgres
 * puede devolverlas en cualquier orden y en cualquier corrida, asi que la
 * pagina cambiaria sola entre recargas y un test que lo mirara seria
 * intermitente.
 */
export const ORDEN_DE_CONTENIDO = [{ orden: 'asc' }, { id: 'asc' }] as const;

@Injectable()
export class WebSalonService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * La configuracion del gimnasio, o los valores por defecto si no hay fila.
   *
   * SE MAPEA CAMPO A CAMPO Y NO SE HACE UN SPREAD DE LA FILA, por el mismo
   * motivo que explica `publico.service.ts`: un `select` es una promesa sobre
   * la CONSULTA y el mapeo es una promesa sobre la RESPUESTA, y solo la segunda
   * sobrevive al dia en que alguien ensanche el `select` para depurar algo. Hoy
   * `COLUMNAS_DE_CONFIG` esta bien y el spread no filtraba nada; el punto es
   * que no dependa de que siga estandolo.
   */
  async ver(): Promise<ConfiguracionWebSalon> {
    const fila = ((await this.prisma.db.webSalonConfig.findFirst({
      select: COLUMNAS_DE_CONFIG,
    })) ?? WEB_SALON_POR_DEFECTO) as FilaWebSalon;

    const testimonios = await this.listarTestimonios();
    const preguntas = await this.listarPreguntas();

    return {
      activa: fila.activa,
      colorPrimario: fila.colorPrimario,
      colorSecundario: fila.colorSecundario,
      tituloPrincipal: fila.tituloPrincipal,
      tagline: fila.tagline,
      sobreElSalon: fila.sobreElSalon,
      imagenPrincipalUrl: fila.imagenPrincipalUrl,
      whatsapp: fila.whatsapp,
      instagram: fila.instagram,
      linkExtra: fila.linkExtra,
      mostrarPrecios: fila.mostrarPrecios,
      mostrarTestimonios: fila.mostrarTestimonios,
      mostrarFAQ: fila.mostrarFAQ,
      mostrarTurnosLibres: fila.mostrarTurnosLibres,
      planDestacadoId: fila.planDestacadoId,
      testimonios,
      preguntas,
    };
  }

  async guardar(actor: JwtPayload, dto: GuardarWebSalonDto): Promise<ConfiguracionWebSalon> {
    const planDestacadoId = await this.planDestacadoDeEsteGimnasio(dto.planDestacadoId);

    // REEMPLAZO COMPLETO: lo que no viene vuelve a su valor por defecto. Es lo
    // que permite que el admin BORRE el tagline mandando el formulario sin el;
    // con semantica de parche no habria forma de vaciar un campo sin inventar
    // un centinela.
    //
    // NO lleva tenantId: en el `create` lo pone la extension, y en el `data` de
    // un `update` seria un intento de mover la fila a otro gimnasio, que la
    // extension lee como ataque (ReasignacionDeTenantError).
    const campos = {
      activa: dto.activa ?? WEB_SALON_POR_DEFECTO.activa,
      colorPrimario: dto.colorPrimario ?? WEB_SALON_POR_DEFECTO.colorPrimario,
      colorSecundario: dto.colorSecundario ?? WEB_SALON_POR_DEFECTO.colorSecundario,
      tituloPrincipal: dto.tituloPrincipal ?? null,
      tagline: dto.tagline ?? null,
      sobreElSalon: dto.sobreElSalon ?? null,
      imagenPrincipalUrl: dto.imagenPrincipalUrl ?? null,
      whatsapp: dto.whatsapp ?? null,
      instagram: dto.instagram ?? null,
      linkExtra: dto.linkExtra ?? null,
      mostrarPrecios: dto.mostrarPrecios ?? WEB_SALON_POR_DEFECTO.mostrarPrecios,
      mostrarTestimonios: dto.mostrarTestimonios ?? WEB_SALON_POR_DEFECTO.mostrarTestimonios,
      mostrarFAQ: dto.mostrarFAQ ?? WEB_SALON_POR_DEFECTO.mostrarFAQ,
      mostrarTurnosLibres: dto.mostrarTurnosLibres ?? WEB_SALON_POR_DEFECTO.mostrarTurnosLibres,
      planDestacadoId,
    };

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // NO es un `upsert`, y no puede serlo: la extension de aislamiento lo
      // tiene en OPERACIONES_UNICAS y lanza UnsafeUniqueOperationError porque
      // su `where` solo acepta campos unicos y ahi no hay donde inyectar el
      // filtro de tenant. Mismo camino que `config-email.service.ts` desde la
      // Fase 5B y que `config-checkin.service.ts`: las dos ramas corren dentro
      // de la misma transaccion, que ya serializa la lectura y la escritura.
      const existente = await cliente.webSalonConfig.findFirst({ select: { tenantId: true } });

      if (existente === null) {
        // La extension inyecta el tenantId, pero el tipo generado por Prisma lo
        // exige bajo strict.
        await cliente.webSalonConfig.create({ data: { tenantId: actor.tenantId, ...campos } });
      } else {
        await cliente.webSalonConfig.update({
          where: { tenantId: actor.tenantId },
          data: campos,
        });
      }
    });

    return await this.ver();
  }

  async crearTestimonio(actor: JwtPayload, dto: CrearTestimonioDto): Promise<TestimonioAdmin> {
    const fila = await this.prisma.db.testimonio.create({
      data: {
        tenantId: actor.tenantId,
        nombre: dto.nombre,
        texto: dto.texto,
        orden: dto.orden ?? 0,
      },
      select: { id: true, nombre: true, texto: true, orden: true },
    });

    // Mapeo campo a campo, ver `ver()`. Aqui pesa aun mas: el `data` de este
    // `create` SI lleva el tenantId, asi que la fila escrita lo tiene delante.
    return { id: fila.id, nombre: fila.nombre, texto: fila.texto, orden: fila.orden };
  }

  async borrarTestimonio(id: string): Promise<void> {
    // `deleteMany` y no `delete`: el `where` de un `delete` solo acepta campos
    // unicos, asi que la extension no puede inyectarle el tenantId y lo
    // bloquea. Con `deleteMany` el filtro entra, y el testimonio de otro
    // gimnasio simplemente no aparece: `count` queda en 0 y la fila ajena ni se
    // toca.
    const { count } = await this.prisma.db.testimonio.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Ese testimonio no existe');
  }

  async crearPregunta(actor: JwtPayload, dto: CrearFaqDto): Promise<PreguntaAdmin> {
    const fila = await this.prisma.db.preguntaFrecuente.create({
      data: {
        tenantId: actor.tenantId,
        pregunta: dto.pregunta,
        respuesta: dto.respuesta,
        orden: dto.orden ?? 0,
      },
      select: { id: true, pregunta: true, respuesta: true, orden: true },
    });

    // Ver `crearTestimonio`.
    return {
      id: fila.id,
      pregunta: fila.pregunta,
      respuesta: fila.respuesta,
      orden: fila.orden,
    };
  }

  async borrarPregunta(id: string): Promise<void> {
    // Ver `borrarTestimonio`.
    const { count } = await this.prisma.db.preguntaFrecuente.deleteMany({ where: { id } });
    if (count === 0) throw new NotFoundException('Esa pregunta no existe');
  }

  /** Ver `ver()`: el `select` filtra la consulta y el mapeo filtra la respuesta. */
  private async listarTestimonios(): Promise<TestimonioAdmin[]> {
    const filas = await this.prisma.db.testimonio.findMany({
      select: { id: true, nombre: true, texto: true, orden: true },
      orderBy: [...ORDEN_DE_CONTENIDO],
    });

    return filas.map((fila) => ({
      id: fila.id,
      nombre: fila.nombre,
      texto: fila.texto,
      orden: fila.orden,
    }));
  }

  /** Ver `listarTestimonios`. */
  private async listarPreguntas(): Promise<PreguntaAdmin[]> {
    const filas = await this.prisma.db.preguntaFrecuente.findMany({
      select: { id: true, pregunta: true, respuesta: true, orden: true },
      orderBy: [...ORDEN_DE_CONTENIDO],
    });

    return filas.map((fila) => ({
      id: fila.id,
      pregunta: fila.pregunta,
      respuesta: fila.respuesta,
      orden: fila.orden,
    }));
  }

  /**
   * El pack destacado, comprobado contra ESTE gimnasio.
   *
   * La FK compuesta `(tenantId, planDestacadoId)` ya impide en la base que
   * apunte a un pack ajeno, pero su violacion llega como un error de Postgres
   * que nadie traduce y sale como un 500 opaco. Comprobarlo antes lo convierte
   * en un 400 que dice que pasa. El `findFirst` va con el filtro de tenant
   * inyectado, asi que el pack de otro gimnasio no existe para esta consulta.
   */
  private async planDestacadoDeEsteGimnasio(id: string | undefined): Promise<string | null> {
    if (id === undefined) return null;

    const pack = await this.prisma.db.pack.findFirst({ where: { id }, select: { id: true } });
    if (pack === null) {
      throw new BadRequestException('Ese plan destacado no existe en este gimnasio');
    }

    return pack.id;
  }
}
