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
    // 로그아웃·기기 로그아웃으로 끊긴 로그인의 access token은 만료 전이라도 받지 않는다.
    if (payload.sid) {
      const live: unknown[] = await this.users.query(
        `SELECT 1 FROM refresh_tokens
         WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now() LIMIT 1`,
        [payload.sid, current.id],
      );
      if (!live.length)
        throw new UnauthorizedException('다시 로그인해야 합니다.');
    }
    return {
      id: current.id,
      role: current.role,
      mustChangePassword: current.mustChangePassword,
      sessionId: payload.sid,
    };
  }
}
