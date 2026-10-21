import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JUDGE_QUEUE } from '../../common/queue.constants.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    PassportModule.register({}),
    BullModule.registerQueue({ name: JUDGE_QUEUE }),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
