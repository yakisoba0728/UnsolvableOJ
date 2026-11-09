import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ListQuery } from '../../../common/list-query.js';
import { IsPostgresText } from '../../../common/postgres-text.js';
import { UserRole } from '../../users/user-role.enum.js';

export class ListAdminUsersQuery extends ListQuery {
  /** 사용자 이름이나 이메일에 들어 있는 글자(대소문자 무시) */
  @IsOptional()
  @IsString()
  @IsPostgresText()
  @MaxLength(320)
  q?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class ListAuditQuery extends ListQuery {
  @IsOptional()
  @IsString()
  @IsPostgresText()
  @MaxLength(80)
  action?: string;

  @IsOptional()
  @IsUUID()
  actorId?: string;

  @IsOptional()
  @IsUUID()
  targetId?: string;
}

export class ChangeSuspensionDto {
  @IsBoolean()
  suspended: boolean;
}
