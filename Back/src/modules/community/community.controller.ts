import {
  Body,
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import {
  CommunityCommentDto,
  CommunityPostDto,
  CommunityQuery,
  CommunityReportDto,
  CommunityReportQuery,
} from './community.dto.js';
import { CommunityService } from './community.service.js';

@ApiTags('community')
@Controller('community/posts')
export class CommunityController {
  constructor(private readonly service: CommunityService) {}
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  list(
    @Query() query: CommunityQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.service.list(query, user);
  }
  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.mine(user);
  }
  @Get(':id')
  @UseGuards(OptionalJwtAuthGuard)
  detail(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.service.detail(id, user);
  }
  @Post(':id/view')
  @UseGuards(OptionalJwtAuthGuard)
  view(
    @Param('id', ParseUUIDPipe) id: string,
    @Ip() ip: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.service.view(id, user ? `user:${user.id}` : `ip:${ip}`, user);
  }
  @Get(':id/author-stats')
  @UseGuards(OptionalJwtAuthGuard)
  stats(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.service.authorStats(id, user);
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
  @Get(':id/comments')
  @UseGuards(OptionalJwtAuthGuard)
  comments(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommunityQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.service.comments(id, query, user);
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

  @Post(':id/report')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  report(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CommunityReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.report(id, null, dto.reason, user);
  }
  @Post(':id/comments/:commentId/report')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reportComment(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CommunityReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.report(id, commentId, dto.reason, user);
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

/** 신고 처리와 글·답변 숨김(관리자 전용) */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin/community')
export class CommunityAdminController {
  constructor(private readonly service: CommunityService) {}
  @Get('reports') reports(@Query() query: CommunityReportQuery) {
    return this.service.reports(query);
  }
  @Put('reports/:id/resolved') resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.resolveReport(id, user);
  }
  @Put('posts/:id/hidden') hidePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHidden('post', id, true, user);
  }
  @Delete('posts/:id/hidden') unhidePost(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHidden('post', id, false, user);
  }
  @Put('comments/:id/hidden') hideComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHidden('comment', id, true, user);
  }
  @Delete('comments/:id/hidden') unhideComment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.setHidden('comment', id, false, user);
  }
}
