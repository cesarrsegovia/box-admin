import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BootstrapKeyGuard } from './bootstrap-key.guard';

const CLAVE_VALIDA = 'clave-secreta-de-bootstrap';

function configConClave(clave: string): ConfigService {
  return { getOrThrow: () => clave } as unknown as ConfigService;
}

function contextoConHeader(valor: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { 'x-bootstrap-key': valor } }),
    }),
  } as unknown as ExecutionContext;
}

describe('BootstrapKeyGuard', () => {
  it('deja pasar cuando el header trae la clave correcta', () => {
    const guard = new BootstrapKeyGuard(configConClave(CLAVE_VALIDA));
    expect(guard.canActivate(contextoConHeader(CLAVE_VALIDA))).toBe(true);
  });

  it('bloquea cuando el header no viene', () => {
    const guard = new BootstrapKeyGuard(configConClave(CLAVE_VALIDA));
    expect(() => guard.canActivate(contextoConHeader(undefined))).toThrow(
      UnauthorizedException,
    );
  });

  it('bloquea con una clave incorrecta de la misma longitud', () => {
    const incorrectaMismaLongitud = 'x'.repeat(CLAVE_VALIDA.length);
    const guard = new BootstrapKeyGuard(configConClave(CLAVE_VALIDA));
    expect(() => guard.canActivate(contextoConHeader(incorrectaMismaLongitud))).toThrow(
      UnauthorizedException,
    );
  });

  it('bloquea con una clave de longitud distinta sin que timingSafeEqual reviente', () => {
    const guard = new BootstrapKeyGuard(configConClave(CLAVE_VALIDA));
    expect(() => guard.canActivate(contextoConHeader('corta'))).toThrow(
      UnauthorizedException,
    );
  });

  it('bloquea cuando el header llega repetido como array de strings', () => {
    const guard = new BootstrapKeyGuard(configConClave(CLAVE_VALIDA));
    expect(() =>
      guard.canActivate(contextoConHeader([CLAVE_VALIDA, CLAVE_VALIDA])),
    ).toThrow(UnauthorizedException);
  });

  it('bloquea con BOOTSTRAP_KEY vacia y header vacio, sin llegar a timingSafeEqual', () => {
    const guard = new BootstrapKeyGuard(configConClave(''));
    expect(() => guard.canActivate(contextoConHeader(''))).toThrow(
      UnauthorizedException,
    );
  });

  it('bloquea con BOOTSTRAP_KEY vacia sin importar el header', () => {
    const guard = new BootstrapKeyGuard(configConClave(''));
    expect(() => guard.canActivate(contextoConHeader(CLAVE_VALIDA))).toThrow(
      UnauthorizedException,
    );
    expect(() => guard.canActivate(contextoConHeader(undefined))).toThrow(
      UnauthorizedException,
    );
  });
});
