import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
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

export const suspendedMessage = '정지된 계정입니다. 관리자에게 문의해 주세요.';

const HOUR_MS = 3_600_000;
/** 로그인 유지: 30일, 아니면 12시간. 회전할 때마다 이 기간으로 다시 늘어난다. */
const refreshLifetimeMs = (remember: boolean) =>
  remember ? 30 * 24 * HOUR_MS : 12 * HOUR_MS;
const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** 사용자의 refresh token을 모두 폐기한다(비밀번호 변경·임시 비밀번호 발급). */
export function revokeRefreshTokens(
  runner: Pick<EntityManager, 'query'>,
  userId: string,
) {
  return runner.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
}

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

    return this.issueSession(user, await this.createRefreshToken(this.users.manager, user, false));
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
    // 비밀번호를 확인한 뒤에만 알려, 정지 여부로 계정 존재를 떠볼 수 없게 한다.
    if (user.suspendedAt) throw new ForbiddenException(suspendedMessage);

    return this.issueSession(
      user,
      await this.createRefreshToken(this.users.manager, user, dto.remember ?? false),
    );
  }

  /** refresh token을 회전한다: 쓴 토큰은 폐기하고 같은 계열의 새 토큰을 준다. */
  async refresh(token: string) {
    const issued = await this.users.manager.transaction(async (manager) => {
      const [row]: {
        id: string;
        userId: string;
        familyId: string;
        tokenVersion: number;
        remember: boolean;
        revoked: boolean;
        expired: boolean;
      }[] = await manager.query(
        `SELECT id, user_id AS "userId", family_id AS "familyId", token_version AS "tokenVersion", remember,
                revoked_at IS NOT NULL AS revoked, expires_at <= now() AS expired
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hashRefreshToken(token)],
      );
      if (!row || row.expired) return null;
      const user = await manager.findOneBy(User, { id: row.userId });
      // 이미 쓴(폐기된) 토큰이 다시 오면 탈취로 보고 그 계열을 모두 끊는다.
      // 역할 변경·정지·비밀번호 변경(token_version 증가)과 정지 중인 계정도 계열을 끝낸다.
      if (
        row.revoked ||
        !user ||
        user.suspendedAt ||
        user.tokenVersion !== row.tokenVersion
      ) {
        await manager.query(
          'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
          [row.familyId],
        );
        return null;
      }
      await manager.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1',
        [row.id],
      );
      return this.issueSession(
        user,
        await this.createRefreshToken(manager, user, row.remember, row.familyId),
      );
    });
    // 계열 폐기가 커밋된 뒤에 거절한다(트랜잭션 안에서 던지면 폐기도 되돌려진다).
    if (!issued) throw new UnauthorizedException('다시 로그인해야 합니다.');
    return issued;
  }

  /** 이 토큰이 속한 로그인(계열)을 끝낸다. 모르는 토큰이어도 같은 응답이다. */
  async logout(token: string) {
    await this.users.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE family_id = (SELECT family_id FROM refresh_tokens WHERE token_hash = $1) AND revoked_at IS NULL`,
      [hashRefreshToken(token)],
    );
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.users.findOneByOrFail({ id: userId });
    // 401이면 웹이 로그아웃시키므로, 틀린 현재 비밀번호는 입력 오류(400)로 돌려준다.
    if (
      !(await this.passwordHasher.verify(dto.currentPassword, user.passwordHash))
    ) {
      throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
    }
    // 다른 기기의 JWT·refresh token을 모두 무효화하고, 요청한 쪽에는 새 토큰을 준다.
    await this.users.query(
      'UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2',
      [await this.passwordHasher.hash(dto.newPassword), userId],
    );
    await revokeRefreshTokens(this.users.manager, userId);
    const updated = await this.users.findOneByOrFail({ id: userId });
    return this.issueSession(
      updated,
      await this.createRefreshToken(this.users.manager, updated, dto.remember ?? false),
    );
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
    // JWT의 username을 새 이름으로 맞춘 토큰을 준다(기존 토큰과 refresh token은 그대로 유효해 새 refresh token은 주지 않는다).
    return this.issueSession(await this.users.findOneByOrFail({ id: userId }));
  }

  private async createRefreshToken(
    manager: EntityManager,
    user: User,
    remember: boolean,
    familyId?: string,
  ) {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + refreshLifetimeMs(remember));
    // 만료된 토큰은 재사용 검사에도 쓸모가 없으니 발급할 때 함께 지운다.
    await manager.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at <= now()',
      [user.id],
    );
    await manager.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, token_version, remember, expires_at)
       VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5, $6)`,
      [user.id, familyId ?? null, hashRefreshToken(refreshToken), user.tokenVersion, remember, expiresAt],
    );
    return {
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      remember,
    };
  }

  private async issueSession(
    user: User,
    refresh?: Awaited<ReturnType<AuthService['createRefreshToken']>>,
  ) {
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
      ...refresh,
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
