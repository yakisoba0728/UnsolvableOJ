import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import {
  CreateEnterpriseTestDto,
  UpdateEnterpriseTestDto,
} from './dto/enterprise-test.dto.js';
import { EnterpriseService } from './enterprise.service.js';

@ApiTags('enterprise')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise')
export class EnterpriseController {
  constructor(private readonly enterprise: EnterpriseService) {}

  @Get('tests')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.list(user);
  }

  @Post('tests')
  create(@Body() dto: CreateEnterpriseTestDto, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.create(dto, user);
  }

  @Get('tests/:id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.findOwned(id, user);
  }

  @Patch('tests/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnterpriseTestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.enterprise.update(id, dto, user);
  }

  // 웹 api()는 빈 응답을 오류로 보므로 204 대신 지운 id를 돌려준다.
  @Delete('tests/:id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.remove(id, user);
  }

  @Get('tests/:id/results')
  results(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.results(id, user);
  }

  // 응시 링크 코드는 추측해 볼 수 있으므로 조회·시작을 제한한다.
  @Get('join/:code')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  join(@Param('code') code: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.joinInfo(code, user);
  }

  @Post('join/:code/start')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  start(@Param('code') code: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.start(code, user);
  }

  @Get('attempts/:id')
  attempt(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.attempt(id, user);
  }

  @Post('attempts/:id/finish')
  @HttpCode(HttpStatus.OK)
  finish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.enterprise.finish(id, user);
  }
}
