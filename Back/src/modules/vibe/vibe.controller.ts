import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsInt,
  IsObject,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { IsPostgresText } from '../../common/postgres-text.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { VibeService } from './vibe.service.js';

export class RevisionDto {
  @IsInt() @Min(0) revision: number;
}
export class FilesDto extends RevisionDto {
  @IsObject() files: Record<string, string>;
}
export class PromptDto extends RevisionDto {
  @IsString() @Length(1, 4000) @IsPostgresText() prompt: string;
}
export class ApplyDto extends RevisionDto {
  @IsUUID() messageId: string;
}
export class SubmitDto extends RevisionDto {
  @IsString() @MaxLength(3000) @IsPostgresText() reflection: string;
}

@ApiTags('vibe')
@Controller('vibe')
export class VibeController {
  constructor(private readonly service: VibeService) {}
  @Get('challenges') catalog() {
    return this.service.catalog();
  }
  @Get('attempts')
  @UseGuards(JwtAuthGuard)
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.id);
  }
  @Post('challenges/:challengeId/attempts')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  start(
    @Param('challengeId') challengeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.start(challengeId, user.id);
  }
  @Get('attempts/:id')
  @UseGuards(JwtAuthGuard)
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.get(id, user.id);
  }
  @Patch('attempts/:id/files')
  @UseGuards(JwtAuthGuard)
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: FilesDto,
  ) {
    return this.service.edit(id, user.id, dto.revision, 'save', dto.files);
  }
  @Post('attempts/:id/undo')
  @UseGuards(JwtAuthGuard)
  undo(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RevisionDto,
  ) {
    return this.service.edit(id, user.id, dto.revision, 'undo');
  }
  @Post('attempts/:id/apply')
  @UseGuards(JwtAuthGuard)
  apply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyDto,
  ) {
    return this.service.edit(
      id,
      user.id,
      dto.revision,
      'apply',
      undefined,
      dto.messageId,
    );
  }
  @Post('attempts/:id/messages')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  chat(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PromptDto,
  ) {
    return this.service.chat(id, user.id, dto.revision, dto.prompt);
  }
  @Post('attempts/:id/runs')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  run(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RevisionDto,
  ) {
    return this.service.run(id, user.id, dto.revision);
  }
  @Post('attempts/:id/submit')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  submit(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubmitDto,
  ) {
    return this.service.run(id, user.id, dto.revision, true, dto.reflection);
  }
  @Post('attempts/:id/evaluation')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  evaluate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RevisionDto,
  ) {
    return this.service.evaluate(id, user.id, dto.revision);
  }
}
