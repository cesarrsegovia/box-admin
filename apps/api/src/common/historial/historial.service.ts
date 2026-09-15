import { Injectable } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../../prisma/prisma.service';

/** Entidades de las que se guarda rastro. */
export type EntidadAuditable = 'Sala' | 'Pack' | 'Usuario' | 'Turno' | 'Reserva';

export type AccionAuditable =
  | 'CREADA'
  | 'ACTUALIZADA'
  | 'DADA_DE_BAJA'
  | 'ELIMINADA'
  | 'SALAS_ACTUALIZADAS'
  | 'PASSWORD_RESETEADA'
  | 'CANCELADA'
  | 'REASIGNADA';

export interface EntradaHistorial {
  /** Quien ejecuta. De el salen tanto el tenantId como el usuarioId. */
  actor: JwtPayload;
  entidad: EntidadAuditable;
  entidadId: string;
  accion: AccionAuditable;
  detalle?: Record<string, unknown>;
}

@Injectable()
export class HistorialService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra una accion.
   *
   * `cliente` permite escribir dentro de la misma transaccion que provoco el
   * cambio, que es como debe usarse siempre que exista una: la auditoria tiene
   * que revertirse con el cambio que la origino. Sin transaccion, se usa el
   * cliente normal.
   */
  async registrar(
    entrada: EntradaHistorial,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<void> {
    await cliente.historialAccion.create({
      data: {
        // tenantId es redundante en tiempo de ejecucion (la extension lo
        // sobrescribe con el mismo valor del contexto), pero el tipo generado
        // por Prisma lo exige bajo strict.
        tenantId: entrada.actor.tenantId,
        usuarioId: entrada.actor.sub,
        entidad: entrada.entidad,
        entidadId: entrada.entidadId,
        accion: entrada.accion,
        // Se omite la clave entera si no hay detalle: una columna Json nullable
        // distingue entre `undefined` (no tocar) y `null` (guardar JSON null), y
        // mandar undefined explicito es pedir una sorpresa.
        ...(entrada.detalle === undefined ? {} : { detalle: entrada.detalle }),
      },
    });
  }
}
