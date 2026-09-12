import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Secretos y expiraciones de prueba, compartidos entre el JwtService "real"
 * que usan los tests y el ConfigService falso que se los sirve al servicio
 * bajo prueba.
 */
const CONFIG_TEST: Record<string, string> = {
  JWT_SECRET: 'access-secret-test',
  JWT_EXPIRES_IN: '15m',
  JWT_REFRESH_SECRET: 'refresh-secret-test',
  JWT_REFRESH_EXPIRES_IN: '7d',
};

function crearConfigFake(): ConfigService {
  return {
    getOrThrow: (clave: string) => {
      const valor = CONFIG_TEST[clave];
      if (valor === undefined) throw new Error(`Falta config de test: ${clave}`);
      return valor;
    },
  } as unknown as ConfigService;
}

/**
 * Fake minimo de PrismaService: solo implementa los metodos de `db` que
 * AuthService realmente invoca. Los tests unitarios no pasan por la
 * extension real de aislamiento por tenant (tenantScopedExtension); eso ya
 * se prueba aparte en tenant-scoped.extension.spec.ts.
 */
function crearPrismaFake(overrides: {
  tenant?: Partial<Record<string, jest.Mock>>;
  usuario?: Partial<Record<string, jest.Mock>>;
  refreshToken?: Partial<Record<string, jest.Mock>>;
}): PrismaService {
  return {
    db: {
      tenant: {
        findUnique: jest.fn(),
        create: jest.fn(),
        ...overrides.tenant,
      },
      usuario: {
        findUnique: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findFirst: jest.fn(),
        ...overrides.usuario,
      },
      refreshToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        create: jest.fn().mockResolvedValue(undefined),
        ...overrides.refreshToken,
      },
    },
  } as unknown as PrismaService;
}

const jwtReal = new JwtService({});

async function firmarRefreshToken(sub: string, jti: string): Promise<string> {
  return jwtReal.signAsync(
    { sub, jti },
    { secret: CONFIG_TEST.JWT_REFRESH_SECRET, expiresIn: CONFIG_TEST.JWT_REFRESH_EXPIRES_IN },
  );
}

const USUARIO_ACTIVO = {
  id: 'usuario-1',
  tenantId: 'tenant-1',
  nombreCompleto: 'Ana Admin',
  email: 'ana@example.com',
  rol: 'ADMIN_SALON' as const,
  activo: true,
  passwordHash: 'no-se-usa-en-estos-tests',
};

describe('AuthService.refresh — fallo 1: carrera en la rotacion', () => {
  const JTI = 'jti-1';

  it('cuando el CAS de revocacion devuelve count 0, lanza y revoca todas las sesiones', async () => {
    const refreshToken = await firmarRefreshToken(USUARIO_ACTIVO.id, JTI);
    const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    const fila = {
      id: JTI,
      usuarioId: USUARIO_ACTIVO.id,
      tokenHash,
      revokedAt: null as Date | null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const updateManyRefreshToken = jest
      .fn()
      // Primera llamada: el CAS de la rotacion. Otra peticion nos gano la carrera.
      .mockResolvedValueOnce({ count: 0 })
      // Segunda llamada: revocarTodasLasSesionesUnscoped.
      .mockResolvedValueOnce({ count: 3 });

    const prisma = crearPrismaFake({
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(fila),
        updateMany: updateManyRefreshToken,
        create: jest.fn(),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(USUARIO_ACTIVO),
      },
    });

    const service = new AuthService(prisma, jwtReal, crearConfigFake());

    await expect(service.refresh(refreshToken)).rejects.toThrow(
      'Refresh token reutilizado; sesiones revocadas',
    );

    // Una unica invocacion de refresh(): el CAS se intento una vez y, al
    // devolver count 0, se disparo la revocacion masiva de sesiones.
    expect(updateManyRefreshToken).toHaveBeenCalledTimes(2);
    expect(updateManyRefreshToken).toHaveBeenCalledWith({
      where: { id: JTI, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(updateManyRefreshToken).toHaveBeenCalledWith({
      where: { usuarioId: USUARIO_ACTIVO.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('cuando el CAS devuelve count 1, emite un par de tokens nuevo con normalidad', async () => {
    const refreshToken = await firmarRefreshToken(USUARIO_ACTIVO.id, JTI);
    const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    const fila = {
      id: JTI,
      usuarioId: USUARIO_ACTIVO.id,
      tokenHash,
      revokedAt: null as Date | null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    const updateManyRefreshToken = jest.fn().mockResolvedValue({ count: 1 });
    const createRefreshToken = jest.fn().mockResolvedValue(undefined);

    const prisma = crearPrismaFake({
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(fila),
        updateMany: updateManyRefreshToken,
        create: createRefreshToken,
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(USUARIO_ACTIVO),
      },
    });

    const service = new AuthService(prisma, jwtReal, crearConfigFake());

    const tokens = await service.refresh(refreshToken);

    expect(typeof tokens.accessToken).toBe('string');
    expect(typeof tokens.refreshToken).toBe('string');
    expect(tokens.refreshToken).not.toBe(refreshToken);

    // Solo la llamada del CAS: no hubo reuso, asi que nunca se llega a
    // revocarTodasLasSesionesUnscoped.
    expect(updateManyRefreshToken).toHaveBeenCalledTimes(1);
    expect(updateManyRefreshToken).toHaveBeenCalledWith({
      where: { id: JTI, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(createRefreshToken).toHaveBeenCalledTimes(1);
  });

  it('cuando la fila ya viene revocada, lanza y revoca todas las sesiones sin llegar al CAS', async () => {
    const refreshToken = await firmarRefreshToken(USUARIO_ACTIVO.id, JTI);
    const tokenHash = await argon2.hash(refreshToken, { type: argon2.argon2id });

    const fila = {
      id: JTI,
      usuarioId: USUARIO_ACTIVO.id,
      tokenHash,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    };

    const updateManyRefreshToken = jest.fn().mockResolvedValue({ count: 1 });

    const prisma = crearPrismaFake({
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue(fila),
        updateMany: updateManyRefreshToken,
      },
    });

    const service = new AuthService(prisma, jwtReal, crearConfigFake());

    await expect(service.refresh(refreshToken)).rejects.toThrow(
      'Refresh token reutilizado; sesiones revocadas',
    );

    // El atajo `if (fila.revokedAt)` corta antes de intentar el CAS.
    expect(updateManyRefreshToken).toHaveBeenCalledTimes(1);
    expect(updateManyRefreshToken).toHaveBeenCalledWith({
      where: { usuarioId: USUARIO_ACTIVO.id, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});

describe('AuthService.login — fallo 2: fuga de tiempos', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('con un email inexistente, igualmente llama a argon2.verify contra el señuelo antes de lanzar', async () => {
    const verifySpy = jest.spyOn(argon2, 'verify');

    const prisma = crearPrismaFake({
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', activo: true }),
      },
      usuario: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });

    const service = new AuthService(prisma, jwtReal, crearConfigFake());

    await expect(
      service.login({ tenantSlug: 'gimnasio-a', email: 'nadie@example.com', password: 'cualquiera' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(verifySpy).toHaveBeenCalledTimes(1);
  });

  it('el mensaje de error es identico al de password incorrecta', async () => {
    // Rama 1: email inexistente.
    const prismaSinUsuario = crearPrismaFake({
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', activo: true }) },
      usuario: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const serviceSinUsuario = new AuthService(prismaSinUsuario, jwtReal, crearConfigFake());

    let mensajeSinUsuario = '';
    try {
      await serviceSinUsuario.login({
        tenantSlug: 'gimnasio-a',
        email: 'nadie@example.com',
        password: 'cualquiera',
      });
    } catch (error) {
      mensajeSinUsuario = (error as UnauthorizedException).message;
    }

    // Rama 2: password incorrecta con usuario real.
    const passwordHashReal = await argon2.hash('la-correcta', { type: argon2.argon2id });
    const prismaConUsuario = crearPrismaFake({
      tenant: { findUnique: jest.fn().mockResolvedValue({ id: 'tenant-1', activo: true }) },
      usuario: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ ...USUARIO_ACTIVO, passwordHash: passwordHashReal }),
      },
    });
    const serviceConUsuario = new AuthService(prismaConUsuario, jwtReal, crearConfigFake());

    let mensajeConUsuario = '';
    try {
      await serviceConUsuario.login({
        tenantSlug: 'gimnasio-a',
        email: USUARIO_ACTIVO.email,
        password: 'la-incorrecta',
      });
    } catch (error) {
      mensajeConUsuario = (error as UnauthorizedException).message;
    }

    expect(mensajeSinUsuario).toBe(mensajeConUsuario);
    expect(mensajeSinUsuario).toBe('Credenciales invalidas');
  });
});
