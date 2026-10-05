import type { Request, Response } from 'express';
import { CheckinController, ConfigCheckInController } from './checkin.controller';

const ACTOR = { sub: 'u-1', tenantId: 't1', rol: 'ALUMNO' } as never;

/**
 * El controller es la UNICA capa que conoce `Request`. Lo que estos dos casos
 * fijan es justo esa frontera: que la IP y el User-Agent se saquen del request
 * y bajen como argumentos. Sin ellos, borrar el segundo parametro del service
 * dejaria `ip` y `dispositivo` en null en cada fila de Asistencia y ningun test
 * del service se enteraria, porque el service los recibe ya extraidos.
 */
describe('CheckinController', () => {
  function crear() {
    const checkin = { marcarPresente: jest.fn().mockResolvedValue({ reservaId: 'r-1' }) };
    return { controller: new CheckinController(checkin as never), checkin };
  }

  function request(ip: string | undefined, userAgent: string | undefined): Request {
    return {
      ip,
      get: (cabecera: string) => (cabecera === 'user-agent' ? userAgent : undefined),
    } as never;
  }

  it('la IP y el User-Agent del request llegan al service', async () => {
    const { controller, checkin } = crear();

    await controller.marcar(ACTOR, { firma: 'f' }, request('203.0.113.9', 'Mozilla/5.0'));

    expect(checkin.marcarPresente).toHaveBeenCalledWith(ACTOR, 'f', {
      ip: '203.0.113.9',
      dispositivo: 'Mozilla/5.0',
    });
  });

  it('sin IP ni User-Agent se marca igual, con nulls', async () => {
    // Las dos columnas son opcionales: un cliente sin User-Agent no puede
    // quedarse sin marcar presente por eso.
    const { controller, checkin } = crear();

    await controller.marcar(ACTOR, { firma: 'f' }, request(undefined, undefined));

    expect(checkin.marcarPresente).toHaveBeenCalledWith(ACTOR, 'f', {
      ip: null,
      dispositivo: null,
    });
  });
});

describe('ConfigCheckInController.imagen', () => {
  it('sale como image/png y sin cachear', async () => {
    // El PNG lleva la firma del gimnasio dentro: lo que no se cachea no se
    // queda en el disco de un proxy compartido.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const configCheckIn = { imagenQr: jest.fn().mockResolvedValue(png) };
    const res = { set: jest.fn().mockReturnThis(), send: jest.fn() };

    await new ConfigCheckInController(configCheckIn as never).imagen(
      ACTOR,
      res as unknown as Response,
    );

    expect(res.set).toHaveBeenCalledWith({
      'Content-Type': 'image/png',
      'Cache-Control': 'no-store',
    });
    expect(res.send).toHaveBeenCalledWith(png);
  });
});
