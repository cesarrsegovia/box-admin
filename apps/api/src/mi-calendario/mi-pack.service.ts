import { Injectable, NotFoundException } from '@nestjs/common';
import type { Pack } from '@prisma/client';
import { aFechaISO, type JwtPayload, type MiPackPublico } from '@boxadmin/shared';
import { aPackPublico } from '../packs/packs.service';
import { PrismaService } from '../prisma/prisma.service';
import { topeDelPack, ventanaDeConteo } from '../reservas/ventana-pack';

@Injectable()
export class MiPackService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * El estado del pack del alumno.
   *
   * Reutiliza `topeDelPack` y `ventanaDeConteo` de la Fase 1 en vez de repetir
   * el calculo: si las reglas del pack cambian, cambian en un solo sitio. Y
   * serializa el pack con el mismo `aPackPublico` que usa PacksService, para
   * que el precio no acabe formateado de dos maneras distintas.
   *
   * `ventanaDeConteo` pide la fecha de un turno porque en una reserva el periodo
   * que importa es el del turno que se reserva. Aqui no hay turno: el alumno
   * pregunta por su pack AHORA, asi que se le pasa el momento actual y para un
   * pack MENSUAL sale el mes en curso.
   */
  async deActor(actor: JwtPayload, ahora: Date = new Date()): Promise<MiPackPublico> {
    const perfil = await this.prisma.db.perfil.findFirst({
      where: { usuarioId: actor.sub },
      include: { pack: true },
    });
    if (!perfil) {
      throw new NotFoundException('Este usuario no tiene perfil de alumno');
    }

    const tope = topeDelPack(perfil.pack, perfil);
    const ventana = ventanaDeConteo(perfil.pack, perfil, ahora);

    // Misma regla que advertenciasDePack desde la Fase 1: consumen clase las
    // reservas activas y las canceladas como DEFINITIVA. Las RECUPERABLE no —
    // ahi es exactamente donde "la clase vuelve al perfil".
    const consumidas = await this.prisma.db.reserva.count({
      where: {
        perfilId: perfil.id,
        OR: [{ canceladaEn: null }, { cancelacionTipo: 'DEFINITIVA' }],
        turno: { fecha: ventana },
      },
    });

    return {
      pack: perfil.pack === null ? null : aPackPublico(perfil.pack as Pack),
      tope,
      consumidas,
      // Pasarse del pack esta permitido desde la Fase 1 (avisa, no bloquea), asi
      // que "consumidas > tope" es un estado real. Un numero negativo de
      // restantes no le dice nada util a nadie.
      restantes: tope === null ? null : Math.max(0, tope - consumidas),
      ventanaDesde: ventana.gte === undefined ? null : aFechaISO(ventana.gte),
      ventanaHasta: ventana.lte === undefined ? null : aFechaISO(ventana.lte),
      clasesExtra: perfil.clasesExtra,
      cancelacionesUsadas: perfil.cancelacionesUsadas,
      cancelacionesPermitidas: perfil.pack?.cancelacionesPermitidas ?? null,
      pagoAlDia: perfil.pagoAlDia,
      vigenciaDesde: perfil.vigenciaDesde === null ? null : aFechaISO(perfil.vigenciaDesde),
      vigenciaHasta: perfil.vigenciaHasta === null ? null : aFechaISO(perfil.vigenciaHasta),
    };
  }
}
