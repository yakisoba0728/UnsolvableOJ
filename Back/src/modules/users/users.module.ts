import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';
import { LearningService } from './learning.service.js';

@Module({
  imports: [PassportModule.register({})],
  controllers: [UsersController],
  providers: [UsersService, LearningService],
})
export class UsersModule {}
