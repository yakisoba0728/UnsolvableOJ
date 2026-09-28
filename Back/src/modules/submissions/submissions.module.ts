import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JUDGE_QUEUE } from '../../common/queue.constants.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Problem } from '../problems/problem.entity.js';
import { JudgeInternalController } from './judge-internal.controller.js';
import { JudgeTokenGuard } from './judge-token.guard.js';
import { Submission } from './submission.entity.js';
import { SubmissionsController } from './submissions.controller.js';
import { SubmissionsService } from './submissions.service.js';

@Module({
  imports: [
    PassportModule.register({}),
    TypeOrmModule.forFeature([Submission, Problem]),
    BullModule.registerQueue({ name: JUDGE_QUEUE }),
  ],
  controllers: [SubmissionsController, JudgeInternalController],
  providers: [SubmissionsService, JwtAuthGuard, JudgeTokenGuard],
})
export class SubmissionsModule {}
