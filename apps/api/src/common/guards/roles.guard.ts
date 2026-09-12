import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rolAlcanza, type JwtPayload, type RolAsignable } from '@boxadmin/shared';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requeridos = this.reflector.getAllAndOverride<RolAsignable[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requeridos || requeridos.length === 0) return true;

    const user: JwtPayload | undefined = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Sin permisos para esta operacion');

    const autorizado = requeridos.some((minimo) => rolAlcanza(user.rol, minimo));
    if (!autorizado) throw new ForbiddenException('Sin permisos para esta operacion');

    return true;
  }
}
