import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsInt, Max, Min } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { MissionsService } from './missions.service.js';
class AnalysisAnswerDto {
  @IsInt() @Min(0) @Max(3) selected: number;
}
@ApiTags('missions')
@Controller('missions')
@UseGuards(JwtAuthGuard)
export class MissionsController {
  constructor(private readonly service: MissionsService) {}
  @Get() list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }
  @Post(':id/claim')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  claim(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.claim(user.id, id);
  }
  @Get('analysis/attempts') attempts(@CurrentUser() user: AuthenticatedUser) {
    return this.service.attempts(user.id);
  }
  @Post('analysis/:id/attempts')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  answer(
    @Param('id') id: string,
    @Body() dto: AnalysisAnswerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.answer(user.id, id, dto.selected);
  }
}
