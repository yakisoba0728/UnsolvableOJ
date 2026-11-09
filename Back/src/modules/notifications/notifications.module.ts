import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [PassportModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
