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
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UserRole } from '../users/user-role.enum.js';
import { AdminService } from './admin.service.js';
import {
  ChangeSuspensionDto,
  ListAdminUsersQuery,
  ListAuditQuery,
} from './dto/admin-list.query.js';
import { ChangeUserRoleDto } from './dto/change-user-role.dto.js';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users(@Query() query: ListAdminUsersQuery) {
    return this.admin.users(query);
  }

  @Patch('users/:id/suspension')
  changeSuspension(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeSuspensionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.admin.changeSuspension(id, dto.suspended, actor);
  }

  @Patch('users/:id/role')
  changeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.admin.changeRole(id, dto.role, actor);
  }

  @Post('users/:id/temporary-password')
  issueTemporaryPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.admin.issueTemporaryPassword(id, actor);
  }

  @Get('audit')
  audit(@Query() query: ListAuditQuery) {
    return this.admin.audit(query);
  }

  @Get('ops')
  ops() {
    return this.admin.ops();
  }
}
