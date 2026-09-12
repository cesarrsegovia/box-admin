import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

export const HEALTH_CHECK_QUEUE = 'health-check-queue';

@Processor(HEALTH_CHECK_QUEUE)
export class HealthCheckProcessor extends WorkerHost {
  private readonly logger = new Logger(HealthCheckProcessor.name);

  async process(job: Job<{ pingAt: string }>): Promise<{ ok: true; pingAt: string }> {
    this.logger.log(`health-check procesado (job ${job.id})`);
    return { ok: true, pingAt: job.data.pingAt };
  }
}
