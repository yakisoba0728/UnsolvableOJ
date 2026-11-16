import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UsersService } from './users.service.js';
import { LearningService } from './learning.service.js';
import { LearningQuery } from './dto/learning.query.js';
import { LearningGoalsService } from './learning-goals.service.js';
import { SetLearningGoalDto } from './dto/learning-goal.dto.js';

// 기본값이 없어야 "생략"과 page=1을 구분한다. 둘 다 생략하면 예전처럼 상위 100명 배열을 준다.
class RankingsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly learning: LearningService,
    private readonly goals: LearningGoalsService,
  ) {}

  @Get('users/me')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.me(user.id);
  }

  @Get('users/me/learning')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  learningDashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: LearningQuery,
  ) {
    return this.learning.dashboard(user.id, query.days);
  }

  @Get('users/me/learning-goal')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  learningGoal(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.get(user);
  }

  @Put('users/me/learning-goal')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  setLearningGoal(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetLearningGoalDto,
  ) {
    return this.goals.set(user, dto);
  }

  @Post('users/me/learning-goal/reset')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  resetLearningGoal(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.reset(user);
  }

  @Delete('users/me/learning-goal')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  removeLearningGoal(@CurrentUser() user: AuthenticatedUser) {
    return this.goals.remove(user);
  }

  // users/me보다 뒤에 둔다. 사용자 이름은 3자 이상이라 'me'와 겹치지 않는다.
  @Get('users/:username')
  publicProfile(@Param('username') username: string) {
    return this.users.publicProfile(username);
  }

  @Get('rankings')
  rankings(@Query() query: RankingsQuery) {
    if (query.page === undefined && query.limit === undefined)
      return this.users.rankings();
    return this.users.rankingPage(query.page ?? 1, query.limit ?? 20);
  }
}
