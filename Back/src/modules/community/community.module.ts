import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CommunityController } from './community.controller.js';
import { CommunityService } from './community.service.js';

@Module({
  imports: [PassportModule.register({})],
  controllers: [CommunityController],
  providers: [CommunityService, JwtAuthGuard],
})
export class CommunityModule {}
