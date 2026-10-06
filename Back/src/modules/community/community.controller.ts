import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import {
  CommunityCommentDto,
  CommunityPostDto,
  CommunityQuery,
} from './community.dto.js';
import { CommunityService } from './community.service.js';

@ApiTags('community')
@Controller('community/posts')
export class CommunityController {
  constructor(private readonly service: CommunityService) {}
  @Get() list(@Query() query: CommunityQuery) {
    return this.service.list(query);
  }
  @Get(':id') detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.detail(id);
  }
  @Post(':id/view') view(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.view(id);
  }
  @Get(':id/author-stats') stats(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.authorStats(id);
  }
  @Get(':id/interaction')
  @UseGuards(JwtAuthGuard)
  interaction(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.interaction(id, user);
  }
  @Put(':id/saved')
  @UseGuards(JwtAuthGuard)
  save(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.relationship(id, user, 'saved', true);
  }
  @Delete(':id/saved')
  @UseGuards(JwtAuthGuard)
  unsave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.relationship(id, user, 'saved', false);
  }
  @Put(':id/follow')
  @UseGuards(JwtAuthGuard)
  follow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.relationship(id, user, 'follow', true);
  }
  @Delete(':id/follow')
  @UseGuards(JwtAuthGuard)
  unfollow(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.relationship(id, user, 'follow', false);
  }
  @Put(':id/comments/:commentId/vote')
  @UseGuards(JwtAuthGuard)
  commentVote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.commentVote(id, commentId, user, true);
  }
  @Delete(':id/comments/:commentId/vote')
  @UseGuards(JwtAuthGuard)
  uncommentVote(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.commentVote(id, commentId, user, false);
  }
  @Get(':id/comments') comments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommunityQuery,
  ) {
    return this.service.comments(id, query);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(
    @Body() dto: CommunityPostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }
  @Put(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommunityPostDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, dto, user);
  }
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.remove(id, user);
  }

  @Post(':id/comments')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  comment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommunityCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.addComment(id, dto.body, user);
  }
  @Put(':id/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  editComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CommunityCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeComment(id, commentId, dto.body, user);
  }
  @Delete(':id/comments/:commentId')
  @UseGuards(JwtAuthGuard)
  deleteComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.changeComment(id, commentId, null, user);
  }

  @Put(':id/accepted-answer/:commentId')
  @UseGuards(JwtAuthGuard)
  accept(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.accept(id, commentId, user);
  }
  @Delete(':id/accepted-answer')
  @UseGuards(JwtAuthGuard)
  unaccept(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.accept(id, null, user);
  }

  @Get(':id/vote')
  @UseGuards(JwtAuthGuard)
  voteState(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.voteState(id, user);
  }
  @Put(':id/vote')
  @UseGuards(JwtAuthGuard)
  vote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.vote(id, user, true);
  }
  @Delete(':id/vote')
  @UseGuards(JwtAuthGuard)
  unvote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.vote(id, user, false);
  }
}
