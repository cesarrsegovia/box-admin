import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  comienzoDeHoyUtc,
  desdeFechaISO,
  rolAlcanza,
  type ComprobanteCreado,
  type ComprobantePublico,
  type EstadoComprobante,
  type JwtPayload,
} from '@boxadmin/shared';
import { ALMACEN_DE_ARCHIVOS, type AlmacenDeArchivos } from '../almacen/almacen.interface';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { AprobarComprobanteDto } from './dto/aprobar-comprobante.dto';
import type { CrearComprobanteDto } from './dto/crear-comprobante.dto';

/**
 * Tipos admitidos, con la extension que les corresponde.
 *
 * Lista blanca y no negra: es lo unico que funciona cuando lo que se acepta son
 * archivos que despues alguien va a abrir. La extension sale de AQUI y no del
 * nombre que manda el cliente.
 */
const TIPOS_ADMITIDOS: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface FilaComprobante {
  id: string;
  tenantId: string;
  perfilId: string;
  claveArchivo: string;
  nombreOriginal: string;
  tipoMime: string;
  subidoEn: Date | null;
  estado: EstadoComprobante;
  revisadoPor: string | null;
  revisadoEn: Date | null;
  nota: string | null;
  createdAt: Date;
}

export interface FiltroComprobantes {
  estado?: EstadoComprobante;
}

@Injectable()
export class ComprobantesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ALMACEN_DE_ARCHIVOS) private readonly almacen: AlmacenDeArchivos,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearComprobanteDto): Promise<ComprobanteCreado> {
    const extension = TIPOS_ADMITIDOS[dto.tipoMime];
    if (!extension) {
      throw new ConflictException(
        `Tipo de archivo no admitido: ${dto.tipoMime}. Se aceptan PDF, JPEG, PNG y WebP.`,
      );
    }

    const perfil = await this.perfilDelActor(actor);

    // La clave la genera el servidor. Usar el nombre del cliente seria path
    // traversal servido en bandeja, y ademas dos alumnos con el mismo nombre de
    // archivo se pisarian.
    const claveArchivo = `${randomUUID().replace(/-/g, '')}.${extension}`;

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const creado = await cliente.comprobante.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: perfil.id,
          claveArchivo,
          nombreOriginal: dto.nombreOriginal,
          tipoMime: dto.tipoMime,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { perfilId: perfil.id, tipoMime: dto.tipoMime },
        },
        cliente,
      );

      return creado as FilaComprobante;
    });

    return {
      comprobante: this.aPublico(fila, null),
      urlDeSubida: await this.almacen.urlDeSubida(claveArchivo, dto.tipoMime),
    };
  }

  /**
   * Marca que el archivo llego.
   *
   * Existe porque ni S3 ni el adaptador local pueden avisar a la API de que el
   * PUT termino. Sin este paso, saber si un comprobante tiene archivo obligaria
   * a consultar el almacen en cada listado.
   */
  async confirmar(actor: JwtPayload, id: string): Promise<ComprobantePublico> {
    const perfil = await this.perfilDelActor(actor);

    const fila = (await this.prisma.db.comprobante.findFirst({
      where: { id },
    })) as FilaComprobante | null;
    if (!fila) throw new NotFoundException('Comprobante inexistente');
    if (fila.perfilId !== perfil.id) {
      throw new ForbiddenException('Solo puedes confirmar tus propios comprobantes');
    }

    // Idempotente: repetir la confirmacion no reescribe una fecha que ya existe.
    if (fila.subidoEn !== null) return this.aPublico(fila, await this.firmarSiHayArchivo(fila));

    const actualizado = (await this.prisma.db.comprobante.update({
      where: { id },
      data: { subidoEn: new Date() },
    })) as FilaComprobante;

    return this.aPublico(actualizado, await this.firmarSiHayArchivo(actualizado));
  }

  async listar(actor: JwtPayload, filtro: FiltroComprobantes): Promise<ComprobantePublico[]> {
    const esPersonal = rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
    const where: Record<string, unknown> = {};

    if (filtro.estado) where.estado = filtro.estado;

    if (esPersonal) {
      // Al admin no se le muestran filas sin archivo: serian enlaces rotos.
      where.subidoEn = { not: null };
    } else {
      const perfil = await this.perfilDelActor(actor);
      // El alumno SI ve las suyas sin confirmar: son las que tiene que
      // terminar de subir.
      where.perfilId = perfil.id;
    }

    const filas = (await this.prisma.db.comprobante.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    })) as FilaComprobante[];

    const publicos: ComprobantePublico[] = [];
    for (const fila of filas) {
      publicos.push(this.aPublico(fila, await this.firmarSiHayArchivo(fila)));
    }

    return publicos;
  }

  async aprobar(
    actor: JwtPayload,
    id: string,
    dto: AprobarComprobanteDto,
  ): Promise<ComprobantePublico> {
    const cubreHasta = desdeFechaISO(dto.cubreHasta);

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await this.exigirRevisable(cliente, id);

      const actualizado = (await cliente.comprobante.update({
        where: { id },
        data: {
          estado: 'APROBADO',
          revisadoPor: actor.sub,
          revisadoEn: new Date(),
          nota: dto.nota ?? null,
        },
      })) as FilaComprobante;

      // El pago nace en la MISMA transaccion. Si naciera fuera, un fallo entre
      // las dos escrituras dejaria un comprobante aprobado sin cobro
      // registrado, y eso no se descubre hasta cuadrar la caja a fin de mes.
      //
      // Aprobar es lo que pone al alumno al dia, y desde la Fase 5A eso no es
      // encender una bandera: es que exista un pago que cubra hoy.
      await cliente.pago.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: existente.perfilId,
          monto: dto.monto,
          metodo: dto.metodo ?? 'TRANSFERENCIA',
          esSena: false,
          cubreDesde: comienzoDeHoyUtc(new Date()),
          cubreHasta,
          comprobanteId: id,
          registradoPor: actor.sub,
          nota: dto.nota ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: id,
          accion: 'APROBADO',
          detalle: { perfilId: existente.perfilId, monto: dto.monto, nota: dto.nota ?? null },
        },
        cliente,
      );

      return actualizado;
    });

    return this.aPublico(fila, await this.firmarSiHayArchivo(fila));
  }

  async rechazar(
    actor: JwtPayload,
    id: string,
    nota: string | undefined,
  ): Promise<ComprobantePublico> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirRevisable(cliente, id);

      const actualizado = (await cliente.comprobante.update({
        where: { id },
        data: {
          estado: 'RECHAZADO',
          revisadoPor: actor.sub,
          revisadoEn: new Date(),
          nota: nota ?? null,
        },
      })) as FilaComprobante;

      await this.historial.registrar(
        {
          actor,
          entidad: 'Comprobante',
          entidadId: id,
          accion: 'RECHAZADO',
          detalle: { nota: nota ?? null },
        },
        cliente,
      );

      return actualizado;
    });

    return this.aPublico(fila, await this.firmarSiHayArchivo(fila));
  }

  /** Las dos comprobaciones que comparten aprobar y rechazar. */
  private async exigirRevisable(
    cliente: ClientePrismaTx,
    id: string,
  ): Promise<FilaComprobante> {
    const existente = (await cliente.comprobante.findFirst({
      where: { id },
    })) as FilaComprobante | null;
    if (!existente) throw new NotFoundException('Comprobante inexistente');
    if (existente.estado !== 'PENDIENTE') {
      throw new ConflictException(`El comprobante ya estaba ${existente.estado.toLowerCase()}`);
    }
    if (existente.subidoEn === null) {
      throw new ConflictException(
        'Este comprobante todavia no tiene archivo: el alumno no termino de subirlo.',
      );
    }

    return existente;
  }

  private async perfilDelActor(actor: JwtPayload): Promise<{ id: string }> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      select: { id: true },
    });
    if (!perfil) throw new NotFoundException('Este usuario no tiene perfil de alumno');

    return perfil;
  }

  /** Sin archivo no hay nada que firmar, y firmar igualmente daria un 404 al abrirlo. */
  private async firmarSiHayArchivo(fila: FilaComprobante): Promise<string | null> {
    if (fila.subidoEn === null) return null;

    return this.almacen.urlDeDescarga(fila.claveArchivo);
  }

  /**
   * `claveArchivo` NO sale en el contrato publico: es la direccion permanente
   * dentro del almacen, y publicarla invitaria a construir URLs a mano.
   */
  private aPublico(fila: FilaComprobante, urlDeDescarga: string | null): ComprobantePublico {
    return {
      id: fila.id,
      tenantId: fila.tenantId,
      perfilId: fila.perfilId,
      nombreOriginal: fila.nombreOriginal,
      tipoMime: fila.tipoMime,
      subidoEn: fila.subidoEn === null ? null : fila.subidoEn.toISOString(),
      estado: fila.estado,
      revisadoPor: fila.revisadoPor,
      revisadoEn: fila.revisadoEn === null ? null : fila.revisadoEn.toISOString(),
      nota: fila.nota,
      createdAt: fila.createdAt.toISOString(),
      urlDeDescarga,
    };
  }
}
