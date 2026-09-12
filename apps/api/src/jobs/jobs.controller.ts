import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Post } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Roles } from '../common/decorators/roles.decorator';
import { HEALTH_CHECK_QUEUE } from './health-check.processor';

@Controller('jobs')
export class JobsController {
  constructor(@InjectQueue(HEALTH_CHECK_QUEUE) private readonly cola: Queue) {}

  /** Encola un job de prueba para comprobar que Redis y BullMQ responden. */
  @Roles('ADMIN_SALON')
  @Post('health-check')
  async encolar(): Promise<{ jobId: string | undefined }> {
    const job = await this.cola.add('ping', { pingAt: new Date().toISOString() });
    return { jobId: job.id };
  }
}
