import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { MissionsService } from './missions.service.js';
import {
  AnalysisQuestionsController,
  MissionsController,
} from './missions.controller.js';
@Module({
  imports: [PassportModule.register({})],
  controllers: [MissionsController, AnalysisQuestionsController],
  providers: [MissionsService],
})
export class MissionsModule {}
