import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { LearningService } from './learning.service.js';
import { LearningGoalsService } from './learning-goals.service.js';

@Module({
  imports: [PassportModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, LearningService, LearningGoalsService],
})
export class UsersModule {}
