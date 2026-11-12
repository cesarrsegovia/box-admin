import { NotFoundException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import type { ClientePrismaTx } from '../prisma/prisma.service';

/**
 * EL PERFIL DE QUIEN LLAMA, sacado del token y nunca de la peticion.
 *
 * Es la puerta de las rutas «mias» —mi calendario, mis clases, mi
 * liquidacion, mis comprobantes, mi lista de espera, mi push, mi check-in—:
 * todas operan sobre EL perfil de quien llama, nunca sobre un `perfilId` del
 * cuerpo o de la URL.
 *
 * `siNoTiene` es el texto del 404, y lo pone cada servicio: un admin sin
 * perfil que pide «mis clases» no tiene que leer lo mismo que uno que pide
 * «mi calendario».
 *
 * `cliente` es el de Prisma o el de una transaccion: dentro de un
 * `$transaction`, el perfil se lee con el mismo cliente que el resto.
 *
 * `MiPackService` no la usa: trae el perfil CON su pack, y una funcion que
 * aceptara un `include` dejaria de ser esta.
 */
export async function idDelPerfilDelActor(
  cliente: ClientePrismaTx,
  actor: JwtPayload,
  siNoTiene: string,
): Promise<string> {
  const perfil = await cliente.perfil.findFirst({
    where: { usuarioId: actor.sub },
    select: { id: true },
  });
  if (perfil === null) throw new NotFoundException(siNoTiene);

  return perfil.id;
}
