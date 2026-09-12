import { Reflector } from '@nestjs/core';
import type { Queue } from 'bullmq';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { JobsController } from './jobs.controller';

describe('JobsController', () => {
  const colaFalsa = {
    add: jest.fn(),
  } as unknown as Queue;

  let controller: JobsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new JobsController(colaFalsa);
  });

  it('encola un job "ping" en la cola de health-check con un pingAt ISO valido', async () => {
    (colaFalsa.add as jest.Mock).mockResolvedValue({ id: '42' });

    const resultado = await controller.encolar();

    expect(colaFalsa.add).toHaveBeenCalledTimes(1);
    const [nombreJob, datos] = (colaFalsa.add as jest.Mock).mock.calls[0] as [
      string,
      { pingAt: string },
    ];
    expect(nombreJob).toBe('ping');
    expect(typeof datos.pingAt).toBe('string');
    expect(new Date(datos.pingAt).toISOString()).toBe(datos.pingAt);

    expect(resultado).toEqual({ jobId: '42' });
  });

  it('exige el rol ADMIN_SALON para encolar', () => {
    const roles = new Reflector().get<string[] | undefined>(
      ROLES_KEY,
      JobsController.prototype.encolar,
    );

    expect(roles).toContain('ADMIN_SALON');
  });
});
