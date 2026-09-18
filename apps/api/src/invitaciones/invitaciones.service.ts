import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { ClaveInvitacionPublica, JwtPayload } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarInvitacionDto } from './dto/actualizar-invitacion.dto';
import type { CrearInvitacionDto } from './dto/crear-invitacion.dto';

/** Fila con sus salas, tal como la devuelven las consultas de este servicio. */
interface FilaConSalas {
  id: string;
  tenantId: string;
  codigo: string;
  nombre: string;
  activa: boolean;
  usosMax: number | null;
  usosActuales: number;
  expiraEn: Date | null;
  packId: string | null;
  salas: { salaId: string }[];
}

export function aClavePublica(fila: FilaConSalas): ClaveInvitacionPublica {
  return {
    id: fila.id,
    tenantId: fila.tenantId,
    codigo: fila.codigo,
    nombre: fila.nombre,
    activa: fila.activa,
    usosMax: fila.usosMax,
    usosActuales: fila.usosActuales,
    expiraEn: fila.expiraEn === null ? null : fila.expiraEn.toISOString(),
    packId: fila.packId,
    salaIds: fila.salas.map((union) => union.salaId),
  };
}

/**
 * 16 bytes = 32 caracteres hexadecimales, de `randomBytes` (CSPRNG). Es el unico
 * dato que el alumno necesita para darse de alta, asi que tiene que ser
 * impredecible: `Math.random()` no sirve aqui ni de lejos.
 */
function generarCodigo(): string {
  return randomBytes(16).toString('hex');
}

@Injectable()
export class InvitacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearInvitacionDto): Promise<ClaveInvitacionPublica> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      await this.exigirSalasValidas(cliente, dto.salaIds);
      await this.exigirPackValido(cliente, dto.packId);

      const creada = await cliente.claveInvitacion.create({
        data: {
          tenantId: actor.tenantId,
          codigo: generarCodigo(),
          nombre: dto.nombre,
          packId: dto.packId ?? null,
          usosMax: dto.usosMax ?? null,
          expiraEn: dto.expiraEn ? new Date(dto.expiraEn) : null,
        },
      });

      await cliente.claveInvitacionSala.createMany({
        data: dto.salaIds.map((salaId) => ({
          tenantId: actor.tenantId,
          claveId: creada.id,
          salaId,
        })),
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'ClaveInvitacion',
          entidadId: creada.id,
          accion: 'CREADA',
          // El codigo NO va al detalle: es una credencial, y el historial lo
          // lee mas gente de la que deberia poder darse de alta.
          detalle: { nombre: dto.nombre, salaIds: dto.salaIds, usosMax: dto.usosMax ?? null },
        },
        cliente,
      );

      return { ...creada, salas: dto.salaIds.map((salaId) => ({ salaId })) };
    });

    return aClavePublica(fila as FilaConSalas);
  }

  async listar(_actor: JwtPayload): Promise<ClaveInvitacionPublica[]> {
    const filas = await this.prisma.db.claveInvitacion.findMany({
      include: { salas: { select: { salaId: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return (filas as unknown as FilaConSalas[]).map(aClavePublica);
  }

  async actualizar(
    actor: JwtPayload,
    id: string,
    dto: ActualizarInvitacionDto,
  ): Promise<ClaveInvitacionPublica> {
    const fila = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      const existente = (await cliente.claveInvitacion.findFirst({
        where: { id },
        include: { salas: { select: { salaId: true } } },
      })) as unknown as FilaConSalas | null;
      if (!existente) throw new NotFoundException('Clave de invitacion inexistente');

      if (dto.salaIds !== undefined) {
        await this.exigirSalasValidas(cliente, dto.salaIds);
      }
      if (dto.packId !== undefined) {
        await this.exigirPackValido(cliente, dto.packId);
      }

      const actualizada = await cliente.claveInvitacion.update({
        where: { id },
        data: {
          nombre: dto.nombre,
          activa: dto.activa,
          packId: dto.packId,
          usosMax: dto.usosMax,
          expiraEn: dto.expiraEn ? new Date(dto.expiraEn) : undefined,
        },
      });

      let salas = existente.salas;

      if (dto.salaIds !== undefined) {
        // Borrar y volver a crear, no diferencia incremental: es lo mismo que
        // hace PATCH /usuarios/:id/salas desde la Fase 1 y evita
        // reconciliaciones sutiles que nadie prueba.
        await cliente.claveInvitacionSala.deleteMany({ where: { claveId: id } });
        await cliente.claveInvitacionSala.createMany({
          data: dto.salaIds.map((salaId) => ({
            tenantId: actor.tenantId,
            claveId: id,
            salaId,
          })),
        });
        salas = dto.salaIds.map((salaId) => ({ salaId }));
      }

      await this.historial.registrar(
        {
          actor,
          entidad: 'ClaveInvitacion',
          entidadId: id,
          accion: 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );

      return { ...actualizada, salas };
    });

    return aClavePublica(fila as FilaConSalas);
  }

  /**
   * Las salas tienen que existir EN ESTE GIMNASIO. La extension de aislamiento
   * ya restringe el findMany al tenant del contexto, asi que basta comparar
   * cuantas se encontraron.
   */
  private async exigirSalasValidas(cliente: ClientePrismaTx, salaIds: string[]): Promise<void> {
    if (salaIds.length === 0) {
      throw new BadRequestException(
        'Una clave de invitacion necesita al menos una sala: sin salas, el alumno ' +
          'que se registre con ella no podria ver ni reservar ningun turno.',
      );
    }

    const unicas = [...new Set(salaIds)];
    const encontradas = await cliente.sala.findMany({
      where: { id: { in: unicas } },
      select: { id: true },
    });

    if (encontradas.length !== unicas.length) {
      const existentes = new Set(encontradas.map((s) => s.id));
      const faltan = unicas.filter((id) => !existentes.has(id));
      throw new BadRequestException(`Salas inexistentes en este gimnasio: ${faltan.join(', ')}`);
    }
  }

  private async exigirPackValido(
    cliente: ClientePrismaTx,
    packId: string | null | undefined,
  ): Promise<void> {
    if (!packId) return;

    const pack = await cliente.pack.findFirst({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    if (!pack.activo) {
      throw new BadRequestException('No se puede invitar con un pack dado de baja');
    }
  }
}
