import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '@boxadmin/shared';
import type { NextFunction, Request, Response } from 'express';
import { runWithTenant } from './tenant-context';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      // Ruta publica, o token ausente: sin contexto. Si la ruta esta protegida,
      // JwtAuthGuard la rechazara despues.
      next();
      return;
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(header.slice('Bearer '.length), {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      // Token invalido o expirado: no se abre contexto. La autorizacion no es
      // asunto de este middleware.
      next();
      return;
    }

    // jwt.verify<JwtPayload>(...) es solo una aserción de tipo: en tiempo de
    // ejecución un token bien firmado puede traer un payload incompleto (sin
    // tenantId, o con uno vacío/no-string). Este middleware nunca autoriza ni
    // lanza: si el tenantId no es usable, se comporta igual que ante un token
    // inválido -> next() sin abrir contexto. Abrir aquí un contexto envenenado
    // dejaría a la extensión de Prisma sin filtro real (fuga entre gimnasios).
    // La autorización posterior (rechazar la request) es asunto de JwtAuthGuard.
    if (typeof payload.tenantId !== 'string' || payload.tenantId.length === 0) {
      next();
      return;
    }

    runWithTenant(payload.tenantId, () => next());
  }
}
