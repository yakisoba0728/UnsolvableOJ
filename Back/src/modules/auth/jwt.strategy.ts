import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Repository } from 'typeorm';
import { User } from '../users/user.entity.js';
import { suspendedMessage } from './auth.service.js';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const current = await this.users.findOneBy({ id: payload.sub });
    if (!current || current.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException('다시 로그인해야 합니다.');
    }
    // 정지할 때 token_version도 올리지만, 정지 중에는 어떤 토큰도 받지 않는다.
    if (current.suspendedAt) throw new UnauthorizedException(suspendedMessage);
    return { id: current.id, role: current.role };
  }
}
