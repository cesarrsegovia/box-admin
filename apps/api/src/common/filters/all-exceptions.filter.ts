import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
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

/**
 * Errores de aislamiento de tenant: siempre son un bug nuestro, nunca del
 * cliente. Se agrupan aqui para no repetir un `if` de siete (en realidad
 * ocho) ramas en `catch()`.
 *
 * NOTA: el enunciado de la tarea hablaba de seis clases en
 * tenant-scoped.extension.ts + una en tenant-context.ts (siete en total).
 * Leyendo el codigo, tenant-scoped.extension.ts exporta en realidad SIETE
 * clases -- se omitia `RawQueryEnTenantError` -- asi que el total real es
 * OCHO. Se incluyen las ocho.
 */
const ERRORES_DE_AISLAMIENTO = [
  MissingTenantContextError,
  UnsafeUniqueOperationError,
  ReasignacionDeTenantError,
  CreacionNoPermitidaError,
  OperacionNoSoportadaError,
  ModeloNoClasificadoError,
  RawQueryEnTenantError,
  TenantIdInvalidoError,
] as const;

function esErrorDeAislamiento(exception: unknown): exception is Error {
  return ERRORES_DE_AISLAMIENTO.some((Clase) => exception instanceof Clase);
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const cuerpo = exception.getResponse();

      res.status(status).json({
        statusCode: status,
        path: req.url,
        timestamp: new Date().toISOString(),
        ...(typeof cuerpo === 'string' ? { message: cuerpo } : cuerpo),
      });
      return;
    }

    if (esErrorDeAislamiento(exception)) {
      this.logger.error(
        `FALLO DE AISLAMIENTO en ${req.method} ${req.url}: ${exception.message}`,
        exception.stack,
      );
    } else {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        `Error no controlado en ${req.method} ${req.url}: ${error.message}`,
        error.stack,
      );
    }

    // Respuesta opaca en ambos casos: el cliente nunca debe enterarse de que
    // paso un fallo de aislamiento (ni de ningun otro detalle interno).
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      path: req.url,
      timestamp: new Date().toISOString(),
      message: 'Error interno',
    });
  }
}
