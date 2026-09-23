import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  aFechaISO,
  comienzoDeHoyUtc,
  desdeFechaISO,
  type JwtPayload,
  type MetodoPago,
  type PagoPublico,
} from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { CrearPagoDto } from './dto/crear-pago.dto';
import type { EstadoPagoDto } from './dto/estado-pago.dto';
import { estaAlDia, type PagoParaEstado } from './estado-de-pago';

export interface FiltroPagos {
  perfilId?: string;
  desde?: string;
  hasta?: string;
}

/** Fila de Prisma tal como la devuelve la base. */
interface FilaPago {
  id: string;
  tenantId: string;
  perfilId: string;
  monto: { toFixed(digitos: number): string };
  metodo: MetodoPago;
  esSena: boolean;
  cubreDesde: Date;
  cubreHasta: Date;
  comprobanteId: string | null;
  registradoPor: string;
  nota: string | null;
  anuladoEn: Date | null;
  anuladoPor: string | null;
  createdAt: Date;
}

export function aPagoPublico(fila: FilaPago): PagoPublico {
  return {
    id: fila.id,
    tenantId: fila.tenantId,
    perfilId: fila.perfilId,
    // toFixed y no toString: es dinero, y convertir a number reintroduciria el
    // error de coma flotante que el Decimal existe para evitar.
    monto: fila.monto.toFixed(2),
    metodo: fila.metodo,
    esSena: fila.esSena,
    cubreDesde: aFechaISO(fila.cubreDesde),
    cubreHasta: aFechaISO(fila.cubreHasta),
    comprobanteId: fila.comprobanteId,
    registradoPor: fila.registradoPor,
    nota: fila.nota,
    anuladoEn: fila.anuladoEn === null ? null : fila.anuladoEn.toISOString(),
    anuladoPor: fila.anuladoPor,
    createdAt: fila.createdAt.toISOString(),
  };
}

/** Las columnas que `estaAlDia` necesita, y ninguna mas. */
const COLUMNAS_DE_ESTADO = {
  perfilId: true,
  esSena: true,
  cubreDesde: true,
  cubreHasta: true,
  anuladoEn: true,
} as const;

@Injectable()
export class PagosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearPagoDto): Promise<PagoPublico> {
    const cubreDesde = desdeFechaISO(dto.cubreDesde);
    const cubreHasta = desdeFechaISO(dto.cubreHasta);
    if (cubreHasta.getTime() < cubreDesde.getTime()) {
      throw new BadRequestException('cubreHasta no puede ser anterior a cubreDesde');
    }

    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const perfil = await cliente.perfil.findFirst({ where: { id: dto.perfilId } });
      if (!perfil) throw new NotFoundException('Perfil inexistente');

      if (dto.comprobanteId !== undefined) {
        await this.exigirComprobanteUtilizable(cliente, dto.comprobanteId, dto.perfilId);
      }

      const creada = await cliente.pago.create({
        data: {
          tenantId: actor.tenantId,
          perfilId: dto.perfilId,
          monto: dto.monto,
          metodo: dto.metodo,
          esSena: dto.esSena ?? false,
          cubreDesde,
          cubreHasta,
          comprobanteId: dto.comprobanteId ?? null,
          // Del token, NUNCA del cuerpo: quien registra el cobro es quien esta
          // autenticado.
          registradoPor: actor.sub,
          nota: dto.nota ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pago',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: { perfilId: dto.perfilId, monto: dto.monto, metodo: dto.metodo },
        },
        cliente,
      );

      return creada;
    });

    return aPagoPublico(fila as unknown as FilaPago);
  }

  async listar(filtro: FiltroPagos): Promise<PagoPublico[]> {
    const where: Record<string, unknown> = {};
    if (filtro.perfilId) where.perfilId = filtro.perfilId;

    // El rango filtra por CUANDO ENTRO el dinero, no por el periodo que cubre.
    // Son dos preguntas distintas y la de la caja es esta.
    if (filtro.desde || filtro.hasta) {
      where.createdAt = {
        ...(filtro.desde ? { gte: desdeFechaISO(filtro.desde) } : {}),
        ...(filtro.hasta ? { lte: finDelDia(filtro.hasta) } : {}),
      };
    }

    const filas = await this.prisma.db.pago.findMany({ where, orderBy: { createdAt: 'desc' } });

    return (filas as unknown as FilaPago[]).map(aPagoPublico);
  }

  /**
   * Un pago no se borra: se anula. Es dinero, y borrar la fila reescribe la
   * caja que la Fase 6 va a leer.
   */
  async anular(actor: JwtPayload, id: string): Promise<PagoPublico> {
    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = await cliente.pago.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pago inexistente');
      if (existente.anuladoEn !== null) throw new ConflictException('Ese pago ya estaba anulado');

      await cliente.pago.update({
        where: { id },
        data: { anuladoEn: new Date(), anuladoPor: actor.sub },
      });

      await this.historial.registrar(
        { actor, entidad: 'Pago', entidadId: id, accion: 'ANULADO' },
        cliente,
      );
    });

    const fila = await this.prisma.db.pago.findFirst({ where: { id } });
    return aPagoPublico(fila as unknown as FilaPago);
  }

  /**
   * El override del admin: una cortesia.
   *
   * Todo pasa por la tabla de pagos, asi que hay una sola verdad y la Fase 6 ve
   * la cortesia explicitamente en vez de encontrarse un alumno al dia que no
   * pago nada y no poder explicar por que.
   */
  async fijarEstado(
    actor: JwtPayload,
    perfilId: string,
    dto: EstadoPagoDto,
    ahora: Date = new Date(),
  ): Promise<void> {
    const hoy = comienzoDeHoyUtc(ahora);

    await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const perfil = await cliente.perfil.findFirst({ where: { id: perfilId } });
      if (!perfil) throw new NotFoundException('Perfil inexistente');

      if (dto.alDia) {
        if (dto.cubreHasta === undefined) {
          throw new BadRequestException('Para ponerlo al dia hace falta cubreHasta');
        }

        await cliente.pago.create({
          data: {
            tenantId: actor.tenantId,
            perfilId,
            monto: '0.00',
            metodo: 'CORTESIA',
            esSena: false,
            cubreDesde: hoy,
            cubreHasta: desdeFechaISO(dto.cubreHasta),
            registradoPor: actor.sub,
            nota: dto.nota ?? null,
          },
        });
      } else {
        // SOLO las cortesias. Un pago real no se toca desde aqui: para eso esta
        // `anular`, que pide ADMIN_SALON.
        await cliente.pago.updateMany({
          where: { perfilId, metodo: 'CORTESIA', anuladoEn: null, cubreHasta: { gte: hoy } },
          data: { anuladoEn: new Date(), anuladoPor: actor.sub },
        });
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pago',
          entidadId: perfilId,
          accion: dto.alDia ? 'CREADA' : 'ANULADO',
          detalle: { cortesia: true, alDia: dto.alDia },
        },
        cliente,
      );
    });
  }

  /**
   * Cuales de estos perfiles estan al dia, en UNA sola consulta.
   *
   * El `where` es solo un prefiltro barato para no traerse el historico entero:
   * la decision la toma `estaAlDia`, que es la unica implementacion de la regla.
   * Repetirla aqui en SQL crearia dos copias que algun dia discrepan.
   */
  async perfilesAlDia(
    cliente: ClientePrismaTx,
    perfilIds: string[],
    ahora: Date = new Date(),
  ): Promise<Set<string>> {
    if (perfilIds.length === 0) return new Set();

    const hoy = comienzoDeHoyUtc(ahora);
    const filas = await cliente.pago.findMany({
      where: { perfilId: { in: perfilIds }, anuladoEn: null, cubreHasta: { gte: hoy } },
      select: COLUMNAS_DE_ESTADO,
    });

    const porPerfil = new Map<string, PagoParaEstado[]>();
    for (const fila of filas as unknown as (PagoParaEstado & { perfilId: string })[]) {
      const lista = porPerfil.get(fila.perfilId) ?? [];
      lista.push(fila);
      porPerfil.set(fila.perfilId, lista);
    }

    const alDia = new Set<string>();
    for (const [perfilId, pagos] of porPerfil) {
      if (estaAlDia(pagos, ahora)) alDia.add(perfilId);
    }

    return alDia;
  }

  /** Atajo para un solo perfil. */
  async perfilAlDia(
    cliente: ClientePrismaTx,
    perfilId: string,
    ahora: Date = new Date(),
  ): Promise<boolean> {
    return (await this.perfilesAlDia(cliente, [perfilId], ahora)).has(perfilId);
  }

  private async exigirComprobanteUtilizable(
    cliente: ClientePrismaTx,
    comprobanteId: string,
    perfilId: string,
  ): Promise<void> {
    const comprobante = await cliente.comprobante.findFirst({ where: { id: comprobanteId } });
    if (!comprobante) throw new NotFoundException('Comprobante inexistente');

    if (comprobante.perfilId !== perfilId) {
      throw new BadRequestException(
        'Ese comprobante es de otro alumno. Enlazarlo mezclaria la contabilidad de dos personas.',
      );
    }
    if (comprobante.estado !== 'APROBADO') {
      throw new ConflictException(
        `El comprobante esta ${comprobante.estado.toLowerCase()}: aprobalo antes de enlazar un pago.`,
      );
    }
  }
}

/**
 * El final del dia indicado, para que un filtro `hasta: 2026-09-30` incluya los
 * pagos de ese mismo dia y no solo los de su medianoche.
 */
function finDelDia(iso: string): Date {
  const dia = desdeFechaISO(iso);
  return new Date(dia.getTime() + 24 * 60 * 60 * 1000 - 1);
}
