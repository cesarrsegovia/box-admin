import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

/**
 * Protege los endpoints de arranque (crear tenant, registrar el primer admin)
 * con una clave del .env, resolviendo el huevo y la gallina: al inicio no
 * existe ningun usuario con el que autenticarse.
 */
@Injectable()
export class BootstrapKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const esperada = this.config.getOrThrow<string>('BOOTSTRAP_KEY');
    const recibida = context.switchToHttp().getRequest().headers['x-bootstrap-key'];

    if (typeof recibida !== 'string' || !this.coincide(recibida, esperada)) {
      throw new UnauthorizedException('Clave de bootstrap invalida');
    }

    return true;
  }

  private coincide(a: string, b: string): boolean {
    // Una clave configurada vacia nunca es valida, sin importar el header
    // recibido: si se dejara caer hasta timingSafeEqual, dos buffers de
    // longitud 0 se consideran iguales y cualquiera con header vacio pasaria.
    if (b.length === 0) return false;

    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }
}
