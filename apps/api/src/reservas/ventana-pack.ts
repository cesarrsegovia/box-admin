import type { TipoPack } from '@boxadmin/shared';

/** Lo que hace falta de un pack para calcular su tope. */
export interface PackParaConteo {
  tipo: TipoPack;
  clasesPorMes: number | null;
  clasesTotales: number | null;
}

/** Lo que hace falta de un perfil. */
export interface PerfilParaConteo {
  clasesExtra: number;
  vigenciaDesde: Date | null;
  vigenciaHasta: Date | null;
}

/** Filtro de fecha para Prisma. Un objeto vacio significa "sin limites". */
export interface VentanaDeConteo {
  gte?: Date;
  lte?: Date;
}

function primerDiaDelMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), 1));
}

/** Dia 0 del mes siguiente = ultimo dia de este. Acierta febrero y los bisiestos. */
function ultimoDiaDelMes(fecha: Date): Date {
  return new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth() + 1, 0));
}

/**
 * Periodo sobre el que se cuentan las clases de un perfil.
 *
 * - `MENSUAL`: el mes calendario del turno que se esta reservando. Se usa la
 *   fecha del turno y no la de hoy porque reservar en octubre una clase de
 *   noviembre consume el cupo de noviembre.
 * - `TOTAL`: la vigencia del perfil. Sin vigencia, todo su historial.
 */
export function ventanaDeConteo(
  pack: PackParaConteo | null,
  perfil: PerfilParaConteo,
  fechaDelTurno: Date,
): VentanaDeConteo {
  if (pack === null) return {};

  if (pack.tipo === 'MENSUAL') {
    return { gte: primerDiaDelMes(fechaDelTurno), lte: ultimoDiaDelMes(fechaDelTurno) };
  }

  return {
    ...(perfil.vigenciaDesde ? { gte: perfil.vigenciaDesde } : {}),
    ...(perfil.vigenciaHasta ? { lte: perfil.vigenciaHasta } : {}),
  };
}

/** Numero maximo de clases, o `null` si no hay tope. */
export function topeDelPack(pack: PackParaConteo | null, perfil: PerfilParaConteo): number | null {
  if (pack === null) return null;

  const base = pack.tipo === 'MENSUAL' ? pack.clasesPorMes : pack.clasesTotales;
  if (base === null) return null;

  return base + perfil.clasesExtra;
}
