import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { NotificationsService } from './notifications.service.js';

export class NotificationQuery {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get() list(
    @Query() query: NotificationQuery,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.list(user.id, query.page, query.limit);
  }
  @Get('unread-count') unread(@CurrentUser() user: AuthenticatedUser) {
    return this.service.unreadCount(user.id);
  }
  @Put('read-all') readAll(@CurrentUser() user: AuthenticatedUser) {
    return this.service.markAllRead(user.id);
  }
  @Put(':id/read') read(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.markRead(user.id, id);
  }
}
