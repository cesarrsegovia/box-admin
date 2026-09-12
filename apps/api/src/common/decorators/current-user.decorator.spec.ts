import { ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import type { JwtPayload } from '@boxadmin/shared';
import { extraerUsuarioActual } from './current-user.decorator';

function contextoConUser(user: JwtPayload | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('extraerUsuarioActual', () => {
  it('devuelve el usuario cuando request.user existe', () => {
    const user: JwtPayload = {
      sub: 'user-1',
      tenantId: 'tenant-1',
      rol: 'ADMIN_SALON',
    } as JwtPayload;

    expect(extraerUsuarioActual(contextoConUser(user))).toBe(user);
  });

  it('lanza InternalServerErrorException cuando request.user no existe (ruta sin JwtAuthGuard)', () => {
    expect(() => extraerUsuarioActual(contextoConUser(undefined))).toThrow(
      InternalServerErrorException,
    );
  });
});
