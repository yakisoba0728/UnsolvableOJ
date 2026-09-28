import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JUDGE_QUEUE } from '../../common/queue.constants.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: JUDGE_QUEUE })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
