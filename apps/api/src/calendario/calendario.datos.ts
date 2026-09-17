import { Injectable, NotFoundException } from '@nestjs/common';
import { primerDiaDelMesUtc, ultimoDiaDelMesUtc } from '@boxadmin/shared';
import { PrismaService, type ClientePrismaTx } from '../prisma/prisma.service';
import { topeDelPack, ventanaDeConteo } from '../reservas/ventana-pack';
import type {
  EntradaPlanificacion,
  PerfilParaPlan,
} from '../jobs/generacion-mes/generacion-mes.service';

/**
 * Traduce el estado de la base a la entrada del planificador.
 *
 * Vive aparte del planificador a proposito: alli no entra ni una query, y aqui
 * no entra ni una regla de negocio. Lo usan la previsualizacion (sincrona) y el
 * worker de publicacion, y tienen que ver exactamente los mismos datos o el plan
 * previsualizado no seria el que se aplica.
 */
@Injectable()
export class CalendarioDatos {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    salaId: string,
    anio: number,
    mes: number,
    cliente: ClientePrismaTx = this.prisma.db,
  ): Promise<EntradaPlanificacion> {
    const inicio = primerDiaDelMesUtc(anio, mes);
    const fin = ultimoDiaDelMesUtc(anio, mes);

    const sala = await cliente.sala.findFirst({ where: { id: salaId } });
    if (!sala) throw new NotFoundException('Sala inexistente');

    // Rutinas activas de esta sala cuya vigencia toca el mes.
    const rutinas = await cliente.rutinaFija.findMany({
      where: {
        salaId,
        activa: true,
        desde: { lte: fin },
        OR: [{ hasta: null }, { hasta: { gte: inicio } }],
      },
    });

    const perfilIds = [...new Set(rutinas.map((rutina) => rutina.perfilId))];

    // Cierres de esta sala y del salon entero que tocan el mes.
    const ausencias = await cliente.ausencia.findMany({
      where: {
        OR: [{ salaId }, { salaId: null }],
        desde: { lte: fin },
        hasta: { gte: inicio },
      },
    });

    const vacaciones =
      perfilIds.length === 0
        ? []
        : await cliente.vacacionAlumno.findMany({
            where: { perfilId: { in: perfilIds }, desde: { lte: fin }, hasta: { gte: inicio } },
          });

    const turnos = await cliente.turno.findMany({
      where: { salaId, fecha: { gte: inicio, lte: fin } },
      include: { _count: { select: { reservas: { where: { canceladaEn: null } } } } },
    });

    const turnoIds = turnos.map((turno) => turno.id);
    const reservas =
      turnoIds.length === 0
        ? []
        : await cliente.reserva.findMany({
            where: { turnoId: { in: turnoIds }, canceladaEn: null },
            select: { turnoId: true, perfilId: true },
          });

    const perfiles = await this.cargarPerfiles(cliente, perfilIds, inicio);

    return {
      sala: { id: sala.id, nombre: sala.nombre, cupoBase: sala.cupoBase },
      anio,
      mes,
      rutinas: rutinas.map((rutina) => ({
        id: rutina.id,
        perfilId: rutina.perfilId,
        salaId: rutina.salaId,
        nombre: rutina.nombre,
        diaSemana: rutina.diaSemana,
        horaInicio: rutina.horaInicio,
        horaFin: rutina.horaFin,
        desde: rutina.desde,
        hasta: rutina.hasta,
      })),
      ausencias: ausencias.map((a) => ({ salaId: a.salaId, desde: a.desde, hasta: a.hasta })),
      vacaciones: vacaciones.map((v) => ({ perfilId: v.perfilId, desde: v.desde, hasta: v.hasta })),
      turnosExistentes: turnos.map((turno) => ({
        id: turno.id,
        fecha: turno.fecha,
        horaInicio: turno.horaInicio,
        cupo: turno.cupo,
        reservasActivas: (turno as unknown as { _count: { reservas: number } })._count.reservas,
      })),
      reservasActivas: reservas.map((r) => ({ turnoId: r.turnoId, perfilId: r.perfilId })),
      perfiles,
    };
  }

  /**
   * Carga los perfiles con su pack y, sobre todo, cuantas clases llevan
   * consumidas en la ventana del pack.
   *
   * Ese numero se deriva de las reservas (decision D2 de la Fase 1: no hay
   * contador almacenado), asi que hay que contarlo aqui y pasarselo hecho al
   * planificador, que no toca la base.
   */
  private async cargarPerfiles(
    cliente: ClientePrismaTx,
    perfilIds: string[],
    inicioDelMes: Date,
  ): Promise<PerfilParaPlan[]> {
    if (perfilIds.length === 0) return [];

    const filas = await cliente.perfil.findMany({
      where: { id: { in: perfilIds } },
      include: { pack: true },
    });

    return await Promise.all(
      filas.map(async (perfil) => {
        const pack = perfil.pack
          ? {
              tipo: perfil.pack.tipo,
              clasesPorMes: perfil.pack.clasesPorMes,
              clasesTotales: perfil.pack.clasesTotales,
            }
          : null;

        const tope = topeDelPack(pack, perfil);

        // Si no hay tope no hace falta contar nada: una query menos por alumno.
        const clasesConsumidas =
          tope === null
            ? 0
            : await cliente.reserva.count({
                where: {
                  perfilId: perfil.id,
                  OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
                  turno: { fecha: ventanaDeConteo(pack, perfil, inicioDelMes) },
                },
              });

        return {
          id: perfil.id,
          vigenciaHasta: perfil.vigenciaHasta,
          clasesExtra: perfil.clasesExtra,
          pack,
          clasesConsumidas,
        };
      }),
    );
  }
}
