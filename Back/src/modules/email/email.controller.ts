import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString, Matches } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { EmailService } from './email.service.js';

class PreferencesDto {
  @IsBoolean() answer: boolean;
  @IsBoolean() accepted: boolean;
}
class TokenDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token: string;
}
@Controller('email')
export class EmailController {
  constructor(private readonly email: EmailService) {}
  @Get('preferences')
  @UseGuards(JwtAuthGuard)
  preferences(@CurrentUser() user: AuthenticatedUser) {
    return this.email.preferences(user);
  }
  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: AuthenticatedUser, @Body() dto: PreferencesDto) {
    return this.email.updatePreferences(user, dto);
  }
  @Post('verification/request')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 2 } })
  request(@CurrentUser() user: AuthenticatedUser) {
    return this.email.requestVerification(user);
  }
  @Post('verification/confirm')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  confirm(@CurrentUser() user: AuthenticatedUser, @Body() dto: TokenDto) {
    return this.email.confirm(user, dto.token);
  }
  @Post('unsubscribe')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  unsubscribe(@Body() dto: TokenDto) {
    return this.email.unsubscribe(dto.token);
  }
}
