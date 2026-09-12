import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { getTenantContext } from './tenant-context';
import { TenantContextMiddleware } from './tenant.middleware';

const SECRET = 'secreto-de-prueba';

// Doble mínimo de ConfigService: solo necesitamos getOrThrow('JWT_SECRET').
const configStub = {
  getOrThrow: <T>(_key: string): T => SECRET as unknown as T,
};

function buildRequest(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

describe('TenantContextMiddleware', () => {
  let jwt: JwtService;
  let middleware: TenantContextMiddleware;

  beforeEach(() => {
    jwt = new JwtService({});
    middleware = new TenantContextMiddleware(jwt, configStub as never);
  });

  it('sin header Authorization: llama a next() sin abrir contexto', () => {
    const req = buildRequest(undefined);
    let contextoDentroDeNext: unknown = 'sin-llamar';

    middleware.use(req, {} as Response, () => {
      contextoDentroDeNext = getTenantContext();
    });

    expect(contextoDentroDeNext).toBeUndefined();
  });

  it('con header que no empieza por "Bearer ": llama a next() sin abrir contexto', () => {
    const req = buildRequest('Token abc123');
    let contextoDentroDeNext: unknown = 'sin-llamar';

    middleware.use(req, {} as Response, () => {
      contextoDentroDeNext = getTenantContext();
    });

    expect(contextoDentroDeNext).toBeUndefined();
  });

  it('con un token válido: dentro de next() el contexto tiene el tenantId del token', () => {
    const token = jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-xyz', rol: 'ADMIN' },
      { secret: SECRET },
    );
    const req = buildRequest(`Bearer ${token}`);
    let contextoDentroDeNext: unknown = 'sin-llamar';

    middleware.use(req, {} as Response, () => {
      contextoDentroDeNext = getTenantContext();
    });

    expect(contextoDentroDeNext).toEqual({ kind: 'tenant', tenantId: 'tenant-xyz' });
  });

  it('con un token firmado con otro secreto: llama a next() sin abrir contexto y sin lanzar', () => {
    const token = jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-xyz', rol: 'ADMIN' },
      { secret: 'otro-secreto' },
    );
    const req = buildRequest(`Bearer ${token}`);
    let contextoDentroDeNext: unknown = 'sin-llamar';

    expect(() => {
      middleware.use(req, {} as Response, () => {
        contextoDentroDeNext = getTenantContext();
      });
    }).not.toThrow();

    expect(contextoDentroDeNext).toBeUndefined();
  });

  it('con un token expirado: llama a next() sin abrir contexto y sin lanzar', () => {
    const token = jwt.sign(
      { sub: 'user-1', tenantId: 'tenant-xyz', rol: 'ADMIN' },
      { secret: SECRET, expiresIn: '-1s' },
    );
    const req = buildRequest(`Bearer ${token}`);
    let contextoDentroDeNext: unknown = 'sin-llamar';

    expect(() => {
      middleware.use(req, {} as Response, () => {
        contextoDentroDeNext = getTenantContext();
      });
    }).not.toThrow();

    expect(contextoDentroDeNext).toBeUndefined();
  });

  it('con un token sintácticamente basura: llama a next() sin abrir contexto y sin lanzar', () => {
    const req = buildRequest('Bearer no-es-un-jwt');
    let contextoDentroDeNext: unknown = 'sin-llamar';

    expect(() => {
      middleware.use(req, {} as Response, () => {
        contextoDentroDeNext = getTenantContext();
      });
    }).not.toThrow();

    expect(contextoDentroDeNext).toBeUndefined();
  });

  // Fallo de auditoria: jwt.verify<JwtPayload>(...) es solo una aserción de
  // tipo. Un token firmado con el secreto correcto puede traer un payload sin
  // tenantId (o con uno inservible) y en tiempo de ejecucion nada lo impide.
  // Estos tokens SI pasan jwt.verify (firma valida): lo que se prueba es que
  // el middleware, ante un payload defectuoso, se comporta igual que ante un
  // token invalido: next() sin abrir contexto, sin lanzar. La autorizacion
  // (rechazar la request) es asunto de JwtAuthGuard, no de este middleware.
  describe('con un token bien firmado pero con payload defectuoso', () => {
    it('sin tenantId en el payload: next() sin abrir contexto y sin lanzar', () => {
      const token = jwt.sign({ sub: 'user-1', rol: 'ADMIN' }, { secret: SECRET });
      const req = buildRequest(`Bearer ${token}`);
      let contextoDentroDeNext: unknown = 'sin-llamar';

      expect(() => {
        middleware.use(req, {} as Response, () => {
          contextoDentroDeNext = getTenantContext();
        });
      }).not.toThrow();

      expect(contextoDentroDeNext).toBeUndefined();
    });

    it('con tenantId vacio: next() sin abrir contexto y sin lanzar', () => {
      const token = jwt.sign(
        { sub: 'user-1', tenantId: '', rol: 'ADMIN' },
        { secret: SECRET },
      );
      const req = buildRequest(`Bearer ${token}`);
      let contextoDentroDeNext: unknown = 'sin-llamar';

      expect(() => {
        middleware.use(req, {} as Response, () => {
          contextoDentroDeNext = getTenantContext();
        });
      }).not.toThrow();

      expect(contextoDentroDeNext).toBeUndefined();
    });

    it('con tenantId numerico: next() sin abrir contexto y sin lanzar', () => {
      const token = jwt.sign(
        { sub: 'user-1', tenantId: 123, rol: 'ADMIN' },
        { secret: SECRET },
      );
      const req = buildRequest(`Bearer ${token}`);
      let contextoDentroDeNext: unknown = 'sin-llamar';

      expect(() => {
        middleware.use(req, {} as Response, () => {
          contextoDentroDeNext = getTenantContext();
        });
      }).not.toThrow();

      expect(contextoDentroDeNext).toBeUndefined();
    });

    it('con tenantId null: next() sin abrir contexto y sin lanzar', () => {
      const token = jwt.sign(
        { sub: 'user-1', tenantId: null, rol: 'ADMIN' },
        { secret: SECRET },
      );
      const req = buildRequest(`Bearer ${token}`);
      let contextoDentroDeNext: unknown = 'sin-llamar';

      expect(() => {
        middleware.use(req, {} as Response, () => {
          contextoDentroDeNext = getTenantContext();
        });
      }).not.toThrow();

      expect(contextoDentroDeNext).toBeUndefined();
    });
  });
});
