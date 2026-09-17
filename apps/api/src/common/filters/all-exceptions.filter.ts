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

/**
 * Codigos de Prisma que son culpa del cliente, no nuestra, y que por tanto
 * merecen una respuesta util en vez de un 500 opaco.
 *
 * Deuda declarada en la Fase 1 y pagada aqui porque la Fase 2 anade dos indices
 * unicos: un P2002 pasa a ser un desenlace normal.
 */
const ESTADO_POR_CODIGO_PRISMA: Readonly<Record<string, { status: HttpStatus; mensaje: string }>> =
  {
    P2002: {
      status: HttpStatus.CONFLICT,
      mensaje: 'Ya existe un registro con esos datos',
    },
    P2003: {
      status: HttpStatus.BAD_REQUEST,
      mensaje: 'La operacion referencia un registro que no existe',
    },
    P2025: {
      status: HttpStatus.NOT_FOUND,
      mensaje: 'El registro no existe',
    },
  };

/**
 * La misma condicion vista desde el driver adapter.
 *
 * Con el adapter `pg` de Prisma 7 algunos errores no llegan con `code`: el
 * adapter los traduce a `{ kind: ... }` y los envuelve en un DriverAdapterError.
 * En la Fase 1 comprobar solo `code` dejo el reintento de serializacion sin
 * dispararse ni una vez.
 */
const ESTADO_POR_KIND_DEL_ADAPTER: Readonly<
  Record<string, { status: HttpStatus; mensaje: string }>
> = {
  UniqueConstraintViolation: ESTADO_POR_CODIGO_PRISMA.P2002,
  ForeignKeyConstraintViolation: ESTADO_POR_CODIGO_PRISMA.P2003,
};

function traducirErrorDePrisma(
  exception: unknown,
): { status: HttpStatus; mensaje: string } | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;

  const { code, name, cause } = exception as { code?: unknown; name?: unknown; cause?: unknown };

  if (typeof code === 'string' && code in ESTADO_POR_CODIGO_PRISMA) {
    return ESTADO_POR_CODIGO_PRISMA[code];
  }

  if (name === 'DriverAdapterError' && typeof cause === 'object' && cause !== null) {
    const kind = (cause as { kind?: unknown }).kind;
    if (typeof kind === 'string' && kind in ESTADO_POR_KIND_DEL_ADAPTER) {
      return ESTADO_POR_KIND_DEL_ADAPTER[kind];
    }
  }

  return undefined;
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

    const traducido = traducirErrorDePrisma(exception);
    if (traducido) {
      // Se registra el error completo, pero al cliente solo le llega el mensaje
      // generico: los nombres de nuestras columnas no son asunto suyo.
      this.logger.warn(
        `Error de base traducido a ${traducido.status} en ${req.method} ${req.url}: ` +
          `${exception instanceof Error ? exception.message : String(exception)}`,
      );

      res.status(traducido.status).json({
        statusCode: traducido.status,
        path: req.url,
        timestamp: new Date().toISOString(),
        message: traducido.mensaje,
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
