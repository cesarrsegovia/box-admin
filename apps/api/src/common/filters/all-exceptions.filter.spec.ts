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

  return { host, status, json };
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
});
