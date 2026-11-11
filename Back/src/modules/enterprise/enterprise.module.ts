import { Module } from '@nestjs/common';
import { VibeModule } from '../vibe/vibe.module.js';
import { PassportModule } from '@nestjs/passport';
import { EnterpriseController } from './enterprise.controller.js';
import { EnterpriseService } from './enterprise.service.js';

@Module({
  imports: [PassportModule.register({}), VibeModule],
  controllers: [EnterpriseController],
  providers: [EnterpriseService],
})
export class EnterpriseModule {}
