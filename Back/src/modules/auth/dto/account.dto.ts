import { ApiProperty, PickType } from '@nestjs/swagger';
import { IsString, Length, MaxLength } from 'class-validator';
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
}

/** 가입과 같은 사용자 이름 규칙(영문·숫자·밑줄 3–30자)을 쓴다. */
export class ChangeUsernameDto extends PickType(RegisterDto, ['username']) {}
