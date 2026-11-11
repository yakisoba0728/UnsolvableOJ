import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EmailController } from './email.controller.js';
import { EmailService } from './email.service.js';
@Module({
  imports: [PassportModule.register({})],
  controllers: [EmailController],
  providers: [EmailService],
})
export class EmailModule {}
