import { aFechaISO, type UsuarioDetalle, type UsuarioResumen } from '@boxadmin/shared';
import type { Pack, Perfil, Prisma, Sala, Usuario } from '@prisma/client';
import { aPackPublico } from '../packs/packs.service';
import { aSalaPublica } from '../salas/salas.service';

export interface UsuarioConPerfil {
  usuario: Usuario;
  perfil: Perfil;
  salas: Sala[];
  pack: Pack | null;
}

/** Proyeccion de listado. Nunca incluye fichaMedica. */
export function aUsuarioResumen({ usuario, perfil, salas }: UsuarioConPerfil): UsuarioResumen {
  return {
    id: usuario.id,
    tenantId: usuario.tenantId,
    nombreCompleto: usuario.nombreCompleto,
    email: usuario.email,
    rol: usuario.rol,
    activo: usuario.activo,
    perfilId: perfil.id,
    telefono: perfil.telefono,
    packId: perfil.packId,
    salaIds: salas.map((sala) => sala.id),
  };
}

/**
 * Proyeccion de detalle.
 *
 * `incluyeFichaMedica` no tiene default: obliga a quien llama a decidirlo
 * explicitamente en cada punto de uso. Un default a `false` seria mas comodo y
 * haria que un olvido pasara desapercibido; un default a `true` filtraria el
 * dato. Sin default, el compilador no deja olvidarlo.
 */
export function aUsuarioDetalle(
  datos: UsuarioConPerfil,
  incluyeFichaMedica: boolean,
): UsuarioDetalle {
  const { perfil, pack, salas } = datos;

  return {
    ...aUsuarioResumen(datos),
    ...(incluyeFichaMedica ? { fichaMedica: perfil.fichaMedica } : {}),
    clasesExtra: perfil.clasesExtra,
    cancelacionesUsadas: perfil.cancelacionesUsadas,
    pagoAlDia: perfil.pagoAlDia,
    vigenciaDesde: perfil.vigenciaDesde === null ? null : aFechaISO(perfil.vigenciaDesde),
    vigenciaHasta: perfil.vigenciaHasta === null ? null : aFechaISO(perfil.vigenciaHasta),
    pack: pack === null ? null : aPackPublico(pack),
    salas: salas.map(aSalaPublica),
  };
}

/** Forma que devuelve la consulta de listado y detalle. */
export type UsuarioConRelaciones = Prisma.UsuarioGetPayload<{
  include: { perfil: { include: { pack: true; salas: { include: { sala: true } } } } };
}>;

/**
 * Aplana la consulta anidada a la forma que consumen los mapeadores.
 *
 * Un Usuario sin Perfil no deberia existir —el alta crea los dos en la misma
 * transaccion— pero el tipo lo permite porque la relacion es opcional en el
 * schema. Devolver `null` y filtrarlo es preferible a un `!` que reventaria con
 * un TypeError opaco si alguna vez pasa.
 */
export function aplanar(fila: UsuarioConRelaciones): UsuarioConPerfil | null {
  if (!fila.perfil) return null;

  return {
    usuario: fila,
    perfil: fila.perfil,
    salas: fila.perfil.salas.map((union) => union.sala),
    pack: fila.perfil.pack,
  };
}
