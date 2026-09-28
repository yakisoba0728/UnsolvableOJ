import { IsEnum } from 'class-validator';
import { UserRole } from '../../users/user-role.enum.js';

export class ChangeUserRoleDto {
  @IsEnum(UserRole)
  role: UserRole;
}
