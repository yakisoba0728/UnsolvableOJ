import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../../common/database.js';
import { User } from '../users/user.entity.js';
import type { AccessTokenPayload } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordHasher } from './password-hasher.service.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly passwordHasher: PasswordHasher,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();
    if (email === 'boj-import@unsolvable.local' || username === 'boj_import') {
      throw new ConflictException(
        '이미 사용 중인 이메일 또는 사용자 이름입니다.',
      );
    }
    const user = this.users.create({
      email,
      username,
      passwordHash: await this.passwordHasher.hash(dto.password),
    });

    try {
      await this.users.save(user);
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          '이미 사용 중인 이메일 또는 사용자 이름입니다.',
        );
      }
      throw error;
    }

    return this.issueSession(user);
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOneBy({
      email: dto.email.trim().toLowerCase(),
    });
    if (
      !user ||
      !(await this.passwordHasher.verify(dto.password, user.passwordHash))
    ) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }

    return this.issueSession(user);
  }

  private async issueSession(user: User) {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const expiresIn = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    ) as JwtSignOptions['expiresIn'] | undefined;

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn }),
      tokenType: 'Bearer',
      expiresIn,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        level: user.level,
        xp: user.xp,
        rating: user.rating,
      },
    };
  }
}
