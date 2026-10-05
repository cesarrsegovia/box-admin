import { Module } from '@nestjs/common';
import { CheckinController, ConfigCheckInController } from './checkin.controller';
import { CheckinService } from './checkin.service';
import { ConfigCheckInService } from './config-checkin.service';

@Module({
  controllers: [CheckinController, ConfigCheckInController],
  providers: [CheckinService, ConfigCheckInService],
  exports: [CheckinService, ConfigCheckInService],
})
export class CheckinModule {}
