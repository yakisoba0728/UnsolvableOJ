import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { UserRole } from '../users/user-role.enum.js';
import { CreateSubmissionDto } from './dto/create-submission.dto.js';
import { ListSubmissionsQuery } from './dto/list-submissions.query.js';
import { SubmissionsService } from './submissions.service.js';

@ApiTags('submissions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SubmissionsController {
  constructor(private readonly submissionsService: SubmissionsService) {}

  @Post('problems/:problemId/submissions')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Param('problemId', ParseUUIDPipe) problemId: string,
    @Body() dto: CreateSubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.submissionsService.create(problemId, dto, user);
  }

  @Get('submissions')
  findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSubmissionsQuery,
  ) {
    return this.submissionsService.findMine(user, query);
  }

  @Get('submissions/:id')
  findMineById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.submissionsService.findMineById(id, user);
  }

  @Post('submissions/:id/rejudge')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  rejudge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.submissionsService.rejudge(id, user);
  }
}
