import { ArgumentsHost, BadRequestException, Logger, UnauthorizedException } from '@nestjs/common';
import {
  CreacionNoPermitidaError,
  MissingTenantContextError,
  ModeloNoClasificadoError,
  OperacionNoSoportadaError,
  RawQueryEnTenantError,
  ReasignacionDeTenantError,
  UnsafeUniqueOperationError,
} from '../tenant/tenant-scoped.extension';
import { TenantIdInvalidoError } from '../tenant/tenant-context';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Fabrica un ArgumentsHost falso con un res encadenable (status().json()) y un req minimo. */
function crearHostFalso(url = '/ruta/de/prueba', method = 'GET') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { status };
  const req = { url, method };

  const host = {
    switchToHttp: () => ({
      getResponse: () => res,
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;

  return { host, res, status, json };
}

/**
 * Entorno completo de un caso: el filtro mas el doble de `ArgumentsHost`.
 * Se apoya en `crearHostFalso` para no duplicar el doble que ya usan los
 * tests de arriba.
 */
function crearEntorno(url = '/ruta/de/prueba', method = 'GET') {
  return { filtro: new AllExceptionsFilter(), ...crearHostFalso(url, method) };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('conserva el codigo y el mensaje de una HttpException (UnauthorizedException)', () => {
    const { host, status, json } = crearHostFalso('/auth/me', 'GET');

    filter.catch(new UnauthorizedException('No autorizado'), host);

    expect(status).toHaveBeenCalledWith(401);
    const cuerpo = json.mock.calls[0][0];
    expect(cuerpo.statusCode).toBe(401);
    expect(cuerpo.path).toBe('/auth/me');
    expect(typeof cuerpo.timestamp).toBe('string');
    expect(cuerpo.message).toBe('No autorizado');
  });

  it('conserva el cuerpo objeto de una BadRequestException (como las de ValidationPipe)', () => {
    const { host, status, json } = crearHostFalso('/auth/login', 'POST');
    const excepcion = new BadRequestException({
      statusCode: 400,
      message: ['email debe ser un email valido', 'sobra no debe existir'],
      error: 'Bad Request',
    });

    filter.catch(excepcion, host);

    expect(status).toHaveBeenCalledWith(400);
    const cuerpo = json.mock.calls[0][0];
    expect(cuerpo.statusCode).toBe(400);
    expect(cuerpo.path).toBe('/auth/login');
    expect(typeof cuerpo.timestamp).toBe('string');
    expect(cuerpo.message).toEqual(['email debe ser un email valido', 'sobra no debe existir']);
    expect(cuerpo.error).toBe('Bad Request');
  });

  describe('errores de aislamiento de tenant: 500 opaco, sin filtrar detalle', () => {
    const casos: Array<[string, () => Error]> = [
      ['MissingTenantContextError', () => new MissingTenantContextError('Usuario', 'findMany')],
      ['UnsafeUniqueOperationError', () => new UnsafeUniqueOperationError('Usuario', 'findUnique')],
      ['ReasignacionDeTenantError', () => new ReasignacionDeTenantError('Usuario', 'update')],
      ['CreacionNoPermitidaError', () => new CreacionNoPermitidaError('RefreshToken', 'create')],
      ['OperacionNoSoportadaError', () => new OperacionNoSoportadaError('Usuario', 'aggregateRaw')],
      ['ModeloNoClasificadoError', () => new ModeloNoClasificadoError('ModeloFantasma')],
      ['RawQueryEnTenantError', () => new RawQueryEnTenantError('$queryRaw')],
      ['TenantIdInvalidoError', () => new TenantIdInvalidoError('')],
    ];

    it.each(casos)('%s devuelve 500 opaco sin filtrar el mensaje original', (_nombre, crear) => {
      const { host, status, json } = crearHostFalso('/cualquier/ruta', 'POST');
      const excepcion = crear();

      filter.catch(excepcion, host);

      expect(status).toHaveBeenCalledWith(500);
      const cuerpo = json.mock.calls[0][0];
      expect(cuerpo.message).toBe('Error interno');
      expect(cuerpo.statusCode).toBe(500);
      expect(cuerpo.path).toBe('/cualquier/ruta');
      expect(typeof cuerpo.timestamp).toBe('string');

      // No solo el campo message: ningun fragmento del mensaje original debe
      // aparecer en ningun sitio del JSON serializado al cliente.
      const serializado = JSON.stringify(cuerpo);
      expect(serializado).not.toContain(excepcion.message);
      // Palabras propias del vocabulario interno de aislamiento que nunca
      // deberian llegar al cliente.
      for (const fragmento of ['tenant', 'aislamiento', 'gimnasio']) {
        expect(serializado.toLowerCase()).not.toContain(fragmento);
      }

      expect(errorSpy).toHaveBeenCalled();
    });
  });

  it('un Error generico tambien devuelve el 500 opaco', () => {
    const { host, status, json } = crearHostFalso('/otra/ruta', 'DELETE');
    const excepcion = new Error('boom inesperado');

    filter.catch(excepcion, host);

    expect(status).toHaveBeenCalledWith(500);
    const cuerpo = json.mock.calls[0][0];
    expect(cuerpo).toEqual({
      statusCode: 500,
      path: '/otra/ruta',
      timestamp: expect.any(String),
      message: 'Error interno',
    });
    expect(JSON.stringify(cuerpo)).not.toContain('boom inesperado');
    expect(errorSpy).toHaveBeenCalled();
  });

  describe('errores de Prisma traducidos a HTTP', () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      // El filtro registra estos casos con `warn`, no con `error`: son culpa
      // del cliente, no un fallo nuestro.
      warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it('P2002 (unicidad violada) es 409, no 500', () => {
      const { filtro, host, res } = crearEntorno();
      const error = Object.assign(new Error('Unique constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['tenantId', 'turnoId', 'perfilId'] },
      });

      filtro.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('P2003 (clave foranea) es 400', () => {
      const { filtro, host, res } = crearEntorno();
      const error = Object.assign(new Error('Foreign key constraint failed'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2003',
      });

      filtro.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('P2025 (fila inexistente) es 404', () => {
      const { filtro, host, res } = crearEntorno();
      const error = Object.assign(new Error('Record to update not found'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2025',
      });

      filtro.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('reconoce tambien la forma del driver adapter, que no trae code', () => {
      // Leccion de la Fase 1: con el adapter `pg` de Prisma 7, algunos errores
      // llegan como DriverAdapterError con `cause.kind` y SIN `code`. Comprobar
      // solo `code` dejo el reintento de serializacion como codigo muerto durante
      // toda una fase.
      const { filtro, host, res } = crearEntorno();
      const error = Object.assign(new Error('UniqueConstraintViolation'), {
        name: 'DriverAdapterError',
        cause: { kind: 'UniqueConstraintViolation', fields: ['turnoId'] },
      });

      filtro.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(409);
    });

    it('un codigo de Prisma no contemplado sigue siendo 500 opaco', () => {
      const { filtro, host, res } = crearEntorno();
      const error = Object.assign(new Error('algo raro'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P1001',
      });

      filtro.catch(error, host);

      expect(res.status).toHaveBeenCalledWith(500);
    });

    it('la respuesta de un P2002 no filtra el mensaje interno de Prisma', () => {
      const { filtro, host, json } = crearEntorno();
      const error = Object.assign(
        new Error('Unique constraint failed on the fields: (`tokenHash`)'),
        {
          name: 'PrismaClientKnownRequestError',
          code: 'P2002',
        },
      );

      filtro.catch(error, host);

      // El cliente merece saber que choco con algo existente, no como se llaman
      // nuestras columnas.
      expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('tokenHash');
    });
  });
});
