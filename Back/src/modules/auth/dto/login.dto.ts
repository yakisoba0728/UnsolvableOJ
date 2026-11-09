import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ writeOnly: true })
  @IsString()
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({
    description: '로그인 유지: true면 refresh token이 30일, 아니면 12시간 유효',
  })
  @IsOptional()
  @IsBoolean()
  remember?: boolean;
}

export class RefreshTokenDto {
  @ApiProperty({ writeOnly: true })
  @IsString()
  @MaxLength(128)
  refreshToken: string;
}
