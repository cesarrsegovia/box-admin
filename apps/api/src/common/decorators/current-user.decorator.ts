import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';

/**
 * Extrae `request.user`, ya poblado por JwtAuthGuard. Separada de la fabrica
 * del decorator para poder testearla directamente, sin levantar Nest.
 *
 * Lanza si `request.user` no existe: eso solo puede pasar si `@CurrentUser()`
 * se usa en un handler sin `JwtAuthGuard` (tipicamente por llevar `@Public()`),
 * y preferimos fallar aqui, con un mensaje claro, en vez de devolver
 * `undefined` y que reviente mas tarde con un TypeError opaco.
 */
export function extraerUsuarioActual(ctx: ExecutionContext): JwtPayload {
  const user = ctx.switchToHttp().getRequest().user;

  if (!user) {
    throw new InternalServerErrorException(
      '@CurrentUser() se uso en una ruta sin JwtAuthGuard (probablemente marcada ' +
        '@Public()), por lo que request.user no existe.',
    );
  }

  return user;
}

/** Inyecta el payload del JWT ya validado por JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => extraerUsuarioActual(ctx),
);
