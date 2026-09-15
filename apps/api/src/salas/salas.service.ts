import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { comienzoDeHoyUtc, rolAlcanza, type JwtPayload, type SalaPublica } from '@boxadmin/shared';
import type { Prisma, Sala } from '@prisma/client';
import { HistorialService } from '../common/historial/historial.service';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import type { ActualizarSalaDto } from './dto/actualizar-sala.dto';
import type { CrearSalaDto } from './dto/crear-sala.dto';

/** Proyeccion al contrato publico. Deja fuera createdAt y updatedAt a proposito. */
export function aSalaPublica(sala: Sala): SalaPublica {
  return {
    id: sala.id,
    tenantId: sala.tenantId,
    nombre: sala.nombre,
    activa: sala.activa,
    visibleAlumnos: sala.visibleAlumnos,
    soloCuposLiberados: sala.soloCuposLiberados,
    exclusiva: sala.exclusiva,
    cupoBase: sala.cupoBase,
    minMinutosCancelar: sala.minMinutosCancelar,
    minMinutosAnotarse: sala.minMinutosAnotarse,
    listaEsperaHabilitada: sala.listaEsperaHabilitada,
  };
}

/** ¿El actor gestiona el salon, o solo lo usa? */
function esPersonal(actor: JwtPayload): boolean {
  return rolAlcanza(actor.rol, 'ADMIN_OPERATIVO');
}

/**
 * Filtro de visibilidad, en tres niveles:
 *
 * - personal del salon (ADMIN_OPERATIVO o mas): lo ve todo, incluidas las bajas;
 * - PROFESOR: ve las activas aunque no sean visibles para alumnos, porque el
 *   flag se llama "visible alumnos" y un profesor necesita ver la sala donde da
 *   clase;
 * - ALUMNO: solo las activas y visibles.
 */
function whereVisible(actor: JwtPayload): Prisma.SalaWhereInput {
  if (esPersonal(actor)) return {};
  if (rolAlcanza(actor.rol, 'PROFESOR')) return { activa: true };
  return { activa: true, visibleAlumnos: true };
}

/** La contraparte de whereVisible para una sala ya cargada. Deben coincidir. */
function puedeVer(actor: JwtPayload, sala: Sala): boolean {
  if (esPersonal(actor)) return true;
  if (!sala.activa) return false;
  return rolAlcanza(actor.rol, 'PROFESOR') || sala.visibleAlumnos;
}

@Injectable()
export class SalasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly historial: HistorialService,
  ) {}

  async crear(actor: JwtPayload, dto: CrearSalaDto): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const creada = await (tx as ClientePrismaTx).sala.create({
        data: {
          tenantId: actor.tenantId,
          nombre: dto.nombre,
          visibleAlumnos: dto.visibleAlumnos ?? true,
          soloCuposLiberados: dto.soloCuposLiberados ?? false,
          exclusiva: dto.exclusiva ?? false,
          cupoBase: dto.cupoBase ?? null,
          minMinutosCancelar: dto.minMinutosCancelar ?? null,
          minMinutosAnotarse: dto.minMinutosAnotarse ?? null,
          listaEsperaHabilitada: dto.listaEsperaHabilitada ?? null,
        },
      });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Sala',
          entidadId: creada.id,
          accion: 'CREADA',
          detalle: { nombre: creada.nombre },
        },
        tx as ClientePrismaTx,
      );

      return creada;
    });

    return aSalaPublica(sala);
  }

  async listar(actor: JwtPayload): Promise<SalaPublica[]> {
    // El filtro va en el where, no en un .filter() posterior: asi la base nunca
    // llega a devolver filas que el actor no puede ver.
    const salas = await this.prisma.db.sala.findMany({
      where: whereVisible(actor),
      orderBy: { nombre: 'asc' },
    });

    return salas.map(aSalaPublica);
  }

  async obtener(actor: JwtPayload, id: string): Promise<SalaPublica> {
    const sala = await this.buscar(id);

    // Mismo 404 para "no existe" y "no puedes verla": confirmar la existencia
    // de una sala oculta ya seria filtrar informacion.
    if (!puedeVer(actor, sala)) throw new NotFoundException('Sala inexistente');

    return aSalaPublica(sala);
  }

  async actualizar(actor: JwtPayload, id: string, dto: ActualizarSalaDto): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.sala.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Sala inexistente');

      // Un PATCH con activa:false da de baja la sala igual que el DELETE, asi que
      // pasa por la misma proteccion y se audita igual. Sin esto, el PATCH era la
      // puerta de al lado: dejaba turnos colgando y el historial mentia.
      // Si la sala ya estaba de baja no hay baja nueva que proteger ni que auditar.
      const daDeBaja = dto.activa === false && existente.activa;
      if (daDeBaja) await this.exigirSinTurnosFuturos(cliente, id);

      const actualizada = await cliente.sala.update({ where: { id }, data: { ...dto } });

      await this.historial.registrar(
        {
          actor,
          entidad: 'Sala',
          entidadId: id,
          accion: daDeBaja ? 'DADA_DE_BAJA' : 'ACTUALIZADA',
          detalle: { ...dto },
        },
        cliente,
      );

      return actualizada;
    });

    return aSalaPublica(sala);
  }

  async darDeBaja(actor: JwtPayload, id: string): Promise<SalaPublica> {
    const sala = await this.prisma.db.$transaction(async (tx) => {
      const cliente = tx as ClientePrismaTx;
      const existente = await cliente.sala.findFirst({ where: { id } });
      if (!existente) throw new NotFoundException('Sala inexistente');

      // Idempotente: repetir el DELETE sobre una sala ya de baja no escribe en el
      // historial una baja que no ocurrio.
      if (!existente.activa) return existente;

      // Baja logica, nunca DELETE fisico.
      await this.exigirSinTurnosFuturos(cliente, id);

      const baja = await cliente.sala.update({ where: { id }, data: { activa: false } });

      await this.historial.registrar(
        { actor, entidad: 'Sala', entidadId: id, accion: 'DADA_DE_BAJA' },
        cliente,
      );

      return baja;
    });

    return aSalaPublica(sala);
  }

  /**
   * Rechaza con 409 si la sala tiene turnos de hoy en adelante: dejarlos colgando
   * de una sala de baja produce un calendario con clases que nadie puede usar y
   * que nadie sabe por que estan ahi.
   */
  private async exigirSinTurnosFuturos(cliente: ClientePrismaTx, salaId: string): Promise<void> {
    const turnosFuturos = await cliente.turno.count({
      where: { salaId, fecha: { gte: comienzoDeHoyUtc() } },
    });
    if (turnosFuturos > 0) {
      throw new ConflictException(
        `La sala tiene ${turnosFuturos} turno(s) de hoy en adelante. ` +
          'Borralos o reasignalos antes de darla de baja.',
      );
    }
  }

  /** Busca una sala del gimnasio actual o lanza 404. Reutilizable por otros modulos. */
  async buscar(id: string, cliente: ClientePrismaTx = this.prisma.db): Promise<Sala> {
    const sala = await cliente.sala.findFirst({ where: { id } });
    if (!sala) throw new NotFoundException('Sala inexistente');
    return sala;
  }
}
