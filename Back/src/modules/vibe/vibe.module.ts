import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { VibeController } from './vibe.controller.js';
import { VibeService } from './vibe.service.js';
import { VibeAi } from './vibe.ai.js';
import { VibeRunner } from './vibe.runner.js';

@Module({
  imports: [PassportModule.register({})],
  controllers: [VibeController],
  providers: [VibeService, VibeAi, VibeRunner],
})
export class VibeModule {}
