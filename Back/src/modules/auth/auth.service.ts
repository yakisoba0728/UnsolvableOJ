import {
  BadRequestException,
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
import type {
  ChangePasswordDto,
  ChangeUsernameDto,
} from './dto/account.dto.js';
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
    // 이름 고유성은 lower(username) 인덱스로 대소문자 없이 판단하므로 예약 이름도 같은 기준으로 막습니다.
    if (
      email === 'boj-import@unsolvable.local' ||
      username.toLowerCase() === 'boj_import'
    ) {
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

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findOneByOrFail({ id: userId });
    // 401이면 웹이 로그아웃시키므로, 틀린 현재 비밀번호는 입력 오류(400)로 돌려준다.
    if (
      !(await this.passwordHasher.verify(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
    }
    // 다른 기기의 JWT를 모두 무효화하고, 요청한 쪽에는 새 토큰을 준다.
    await this.users.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2',
      [await this.passwordHasher.hash(dto.newPassword), userId],
    );
    return this.issueSession(await this.users.findOneByOrFail({ id: userId }));
  }

  async changeUsername(userId: string, dto: ChangeUsernameDto) {
    const username = dto.username.trim();
    if (username.toLowerCase() === 'boj_import') {
      throw new ConflictException('이미 사용 중인 사용자 이름입니다.');
    }
    try {
      await this.users.update({ id: userId }, { username });
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('이미 사용 중인 사용자 이름입니다.');
      }
      throw error;
    }
    // JWT의 username을 새 이름으로 맞춘 토큰을 준다(기존 토큰은 그대로 유효).
    return this.issueSession(await this.users.findOneByOrFail({ id: userId }));
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
