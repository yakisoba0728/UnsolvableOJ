import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { RolesGuard } from '../../common/guards/roles.guard.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import { CreateProblemDto } from './dto/create-problem.dto.js';
import { UpdateProblemDto } from './dto/update-problem.dto.js';
import { ChangeProblemStatusDto } from './dto/change-problem-status.dto.js';
import { ListProblemsQuery } from './dto/list-problems.query.js';
import { ProblemsService } from './problems.service.js';

@ApiTags('problems')
@Controller('problems')
export class ProblemsController {
  constructor(private readonly problemsService: ProblemsService) {}

  @Get()
  findAll(@Query() query: ListProblemsQuery) {
    return this.problemsService.findAll(query);
  }

  @Get('mine')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.problemsService.findMine(user);
  }

  @Get(':id/manage')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  manage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.problemsService.findForManagement(id, user);
  }

  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.problemsService.findPublishedBySlug(slug);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  create(
    @Body() dto: CreateProblemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.problemsService.create(dto, user);
  }

  @Patch(':id')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProblemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.problemsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.AUTHOR, UserRole.ADMIN)
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeProblemStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.problemsService.changeStatus(id, dto.status, user);
  }
}
