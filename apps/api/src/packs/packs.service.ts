import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Pack } from '@prisma/client';
import { rolAlcanza, type JwtPayload, type PackPublico } from '@boxadmin/shared';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarPackDto } from './dto/actualizar-pack.dto';
import type { CrearPackDto } from './dto/crear-pack.dto';

export interface FiltroPacks {
  salaId?: string;
  activo?: boolean;
}

export function aPackPublico(pack: Pack): PackPublico {
  return {
    id: pack.id,
    tenantId: pack.tenantId,
    nombre: pack.nombre,
    salaId: pack.salaId,
    tipo: pack.tipo,
    // toFixed(2) sobre el Decimal, no Number(...): convertir a number aqui
    // reintroduciria el error de coma flotante que el Decimal existe para evitar.
    precio: pack.precio === null ? null : pack.precio.toFixed(2),
    clasesPorMes: pack.clasesPorMes,
    clasesTotales: pack.clasesTotales,
    cancelacionesPermitidas: pack.cancelacionesPermitidas,
    activo: pack.activo,
  };
}

/** ¿El actor gestiona el catalogo, o solo lo consume? */
function esPersonal(actor: JwtPayload): boolean {
  return rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
}

@Injectable()
export class PacksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearPackDto): Promise<PackPublico> {
    this.validarCoherencia(dto.tipo, dto.clasesPorMes, dto.clasesTotales);

    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;

      // Dentro de la transaccion, como en actualizar(): comprobarla fuera dejaba
      // una ventana en la que la sala podia desaparecer antes del create y la
      // clave foranea disparaba un P2003 que nadie traduce (500 opaco).
      if (dto.salaId) await this.exigirSala(dto.salaId, cliente);

      const creado = await cliente.pack.create({
        data: {
          tenantId: actor.tenantId,
          nombre: dto.nombre,
          salaId: dto.salaId ?? null,
          tipo: dto.tipo,
          precio: dto.precio === undefined ? null : new Prisma.Decimal(dto.precio),
          clasesPorMes: dto.clasesPorMes ?? null,
          clasesTotales: dto.clasesTotales ?? null,
          cancelacionesPermitidas: dto.cancelacionesPermitidas ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Pack',
          entidadId: creado.id,
          accion: 'CREADA',
          detalle: { nombre: creado.nombre, tipo: creado.tipo },
        },
        cliente,
      );

      return creado;
    });

    return aPackPublico(pack);
  }

  async listar(actor: JwtPayload, filtro: FiltroPacks): Promise<PackPublico[]> {
    const where: Prisma.PackWhereInput = {};

    if (!esPersonal(actor)) {
      where.activo = true;
    } else if (filtro.activo !== undefined) {
      where.activo = filtro.activo;
    }

    // Un pack sin sala vale para todas, asi que al filtrar por una sala concreta
    // hay que incluirlo. Omitirlo escondia medio catalogo.
    if (filtro.salaId) {
      where.OR = [{ salaId: filtro.salaId }, { salaId: null }];
    }

    const packs = await this.prisma.db.pack.findMany({ where, orderBy: { nombre: 'asc' } });
    return packs.map(aPackPublico);
  }

  async obtener(actor: JwtPayload, id: string): Promise<PackPublico> {
    const pack = await this.buscar(id);

    // Mismo criterio que el listado, y mismo 404 para "no existe" y "no puedes
    // verlo": si el catalogo le esconde los packs de baja, resolverlos por id
    // seria la puerta de al lado.
    if (!esPersonal(actor) && !pack.activo) throw new NotFoundException('Pack inexistente');

    return aPackPublico(pack);
  }

  async actualizar(actor: JwtPayload, id: string, dto: ActualizarPackDto): Promise<PackPublico> {
    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.pack.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pack inexistente');

      // Al cambiar de tipo, el contador del tipo viejo no se hereda: heredarlo hacia
      // que MENSUAL -> TOTAL fallara siempre con el 400 de coherencia, y como el DTO
      // no admite null no habia ninguna secuencia de PATCH capaz de hacer el cambio.
      const cambiaTipo = dto.tipo !== undefined && dto.tipo !== existente.tipo;
      const tipo = dto.tipo ?? existente.tipo;
      const porMes = cambiaTipo
        ? dto.clasesPorMes
        : (dto.clasesPorMes ?? existente.clasesPorMes ?? undefined);
      const totales = cambiaTipo
        ? dto.clasesTotales
        : (dto.clasesTotales ?? existente.clasesTotales ?? undefined);
      this.validarCoherencia(tipo, porMes, totales);

      // Solo se valida la sala al cambiarla: un pack que ya colgaba de una sala
      // que se dio de baja despues tiene que poder seguir editandose.
      if (dto.salaId !== undefined && dto.salaId !== existente.salaId) {
        await this.exigirSala(dto.salaId, cliente);
      }

      const actualizado = await cliente.pack.update({
        where: { id },
        data: {
          ...dto,
          precio: dto.precio === undefined ? undefined : new Prisma.Decimal(dto.precio),
          // El contador del tipo viejo se anula explicitamente: si no, la fila
          // quedaria con los dos contadores puestos y el tipo mandando sobre uno.
          ...(cambiaTipo
            ? tipo === 'TOTAL'
              ? { clasesPorMes: null }
              : { clasesTotales: null }
            : {}),
        },
      });

      await this.historial.registrar(
        { actor, entidad: 'Pack', entidadId: id, accion: 'ACTUALIZADA', detalle: { ...dto } },
        cliente,
      );

      return actualizado;
    });

    return aPackPublico(pack);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<PackPublico> {
    const pack = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.pack.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Pack inexistente');

      // Idempotente: repetir el DELETE sobre un pack ya de baja no escribe en el
      // historial una baja que no ocurrio.
      if (!existente.activo) return existente;

      // Siempre baja logica, tenga o no perfiles asignados. Borrar fisicamente
      // un pack que alguien contrato dejaria perfiles apuntando al vacio y
      // haria imposible calcular sus clases pasadas.
      const baja = await cliente.pack.update({ where: { id }, data: { activo: false } });

      await this.historial.registrar(
        { actor, entidad: 'Pack', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aPackPublico(pack);
  }

  /** Busca un pack del gimnasio actual o lanza 404. La usa el alta de alumno. */
  async buscar(id: string, cliente: ClientePrismaTx = this.prisma.db): Promise<Pack> {
    const pack = await cliente.pack.findFirst({ where: { id } });
    if (!pack) throw new NotFoundException('Pack inexistente');
    return pack;
  }

  private validarCoherencia(
    tipo: 'MENSUAL' | 'TOTAL',
    clasesPorMes: number | undefined,
    clasesTotales: number | undefined,
  ): void {
    if (tipo === 'MENSUAL' && clasesTotales !== undefined && clasesTotales !== null) {
      throw new BadRequestException(
        'Un pack MENSUAL se mide en clasesPorMes; clasesTotales no aplica.',
      );
    }
    if (tipo === 'TOTAL' && clasesPorMes !== undefined && clasesPorMes !== null) {
      throw new BadRequestException(
        'Un pack TOTAL se mide en clasesTotales; clasesPorMes no aplica.',
      );
    }
  }

  /**
   * Exige que la sala exista en este gimnasio y siga activa. Colgar un pack de
   * una sala de baja produce un pack que nadie puede usar, igual que hara el
   * modulo de turnos.
   */
  private async exigirSala(
    salaId: string,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<void> {
    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    if (!sala.activa) {
      throw new BadRequestException('La sala esta dada de baja; no admite packs nuevos.');
    }
  }
}
