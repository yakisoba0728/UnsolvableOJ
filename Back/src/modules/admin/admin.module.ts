import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JUDGE_QUEUE } from '../../common/queue.constants.js';
import { User } from '../users/user.entity.js';
import { AuditEvent } from './audit-event.entity.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';

@Module({
  imports: [
    PassportModule.register({}),
    BullModule.registerQueue({ name: JUDGE_QUEUE }),
    TypeOrmModule.forFeature([User, AuditEvent]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
