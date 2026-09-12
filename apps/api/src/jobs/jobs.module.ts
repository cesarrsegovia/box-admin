import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { HEALTH_CHECK_QUEUE, HealthCheckProcessor } from './health-check.processor';
import { JobsController } from './jobs.controller';

@Module({
  imports: [BullModule.registerQueue({ name: HEALTH_CHECK_QUEUE })],
  controllers: [JobsController],
  providers: [HealthCheckProcessor],
})
export class JobsModule {}
