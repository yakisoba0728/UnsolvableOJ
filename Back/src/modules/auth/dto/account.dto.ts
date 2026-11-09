import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { RegisterDto } from './register.dto.js';

export class ChangePasswordDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty({ minLength: 10, maxLength: 128, writeOnly: true })
  @IsString()
  @Length(10, 128)
  newPassword: string;

  @ApiPropertyOptional({
    description: '새로 받을 refresh token의 로그인 유지 여부(기존 토큰은 모두 폐기)',
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

/** 가입과 같은 사용자 이름 규칙(영문·숫자·밑줄 3–30자)을 쓴다. */
export class ChangeUsernameDto extends PickType(RegisterDto, ['username']) {}
