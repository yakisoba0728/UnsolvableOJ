import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { isUniqueViolation } from '../../common/database.js';
import { User } from '../users/user.entity.js';
import type { AccessTokenPayload, AuthenticatedUser } from './auth.types.js';
import type {
  ChangePasswordDto,
  ChangeUsernameDto,
} from './dto/account.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import { PasswordHasher } from './password-hasher.service.js';

export interface SessionDevice {
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  remember: boolean;
  current: boolean;
}

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
  /** 없는 이메일에도 같은 scrypt 비용을 치르게 하는 비교용 해시(응답 시간으로 가입 여부를 떠보지 못하게). */
  private dummyHash?: Promise<string>;

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
      username.toLowerCase() === 'boj_import' ||
      email.endsWith('@deleted.invalid')
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

    return this.issueSession(
      user,
      await this.createRefreshToken(this.users.manager, user, false),
    );
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOneBy({
      email: dto.email.trim().toLowerCase(),
    });
    this.dummyHash ??= this.passwordHasher.hash(
      randomBytes(16).toString('hex'),
    );
    const valid = await this.passwordHasher.verify(
      dto.password,
      user?.passwordHash ?? (await this.dummyHash),
    );
    if (!user || user.deletedAt || !valid) {
      throw new UnauthorizedException(
        '이메일 또는 비밀번호가 올바르지 않습니다.',
      );
    }
    // 비밀번호를 확인한 뒤에만 알려, 정지 여부로 계정 존재를 떠볼 수 없게 한다.
    if (user.suspendedAt) throw new ForbiddenException(suspendedMessage);

    return this.users.manager.transaction(async (manager) => {
      const current = await this.lockActiveUser(
        manager,
        user.id,
        user.tokenVersion,
      );
      if (current.passwordHash !== user.passwordHash)
        throw new UnauthorizedException('다시 로그인해 주세요.');
      return this.issueSession(
        current,
        await this.createRefreshToken(manager, current, dto.remember ?? false),
      );
    });
  }

  /** refresh token을 회전한다: 쓴 토큰은 폐기하고 같은 계열의 새 토큰을 준다. */
  async refresh(token: string) {
    const issued = await this.users.manager.transaction(async (manager) => {
      // Determine the owner without a row lock, then lock user before any refresh row.
      // Withdrawal/password changes use the same order, avoiding user/token deadlocks.
      const [owner]: { user_id: string }[] = await manager.query(
        'SELECT user_id FROM refresh_tokens WHERE token_hash=$1',
        [hashRefreshToken(token)],
      );
      if (!owner) return null;
      const user = await manager.findOne(User, {
        where: { id: owner.user_id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) return null;
      if (user.deletedAt || user.suspendedAt) {
        await revokeRefreshTokens(manager, user.id);
        return null;
      }
      const [row]: {
        id: string;
        userId: string;
        familyId: string;
        familyCreatedAt: Date;
        tokenVersion: number;
        remember: boolean;
        revoked: boolean;
        justRevoked: boolean;
        expired: boolean;
      }[] = await manager.query(
        `SELECT id, user_id AS "userId", family_id AS "familyId", family_created_at AS "familyCreatedAt", token_version AS "tokenVersion", remember,
                revoked_at IS NOT NULL AS revoked, revoked_at > now() - interval '10 seconds' AS "justRevoked", expires_at <= now() AS expired
         FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [hashRefreshToken(token)],
      );
      if (!row || row.expired) return null;
      if (user.tokenVersion !== row.tokenVersion) {
        await manager.query(
          'UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND revoked_at IS NULL',
          [row.familyId],
        );
        return null;
      }
      // 여러 탭이 거의 동시에 갱신하면 앞 탭이 저장한 새 토큰이 늦게 보여(Firefox의 localStorage) 방금 회전한 토큰이 다시 온다.
      // 짧은 유예 안이고 계열에 다음 토큰이 살아 있으면 계열을 끊지 않고 새 토큰도 주지 않는다(409).
      // 따로 묻는 이유: 위 SELECT가 행 잠금을 기다렸다면 그 스냅샷에는 앞 요청이 만든 다음 토큰이 보이지 않는다.
      if (row.justRevoked) {
        const [live] = await manager.query(
          'SELECT 1 FROM refresh_tokens WHERE family_id = $1 AND revoked_at IS NULL AND expires_at > now() LIMIT 1',
          [row.familyId],
        );
        if (live) return 'rotated' as const;
      }
      // 이미 쓴(폐기된) 토큰이 다시 오면 탈취로 보고 그 계열을 모두 끊는다.
      // 역할 변경·정지·비밀번호 변경(token_version 증가)과 정지 중인 계정도 계열을 끝낸다.
      if (
        row.revoked ||
        user.deletedAt ||
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
        await this.createRefreshToken(manager, user, row.remember, {
          id: row.familyId,
          createdAt: row.familyCreatedAt,
        }),
      );
    });
    // 계열 폐기가 커밋된 뒤에 거절한다(트랜잭션 안에서 던지면 폐기도 되돌려진다).
    if (issued === 'rotated')
      throw new ConflictException('다른 탭에서 방금 로그인을 갱신했습니다.');
    if (!issued) throw new UnauthorizedException('다시 로그인해야 합니다.');
    return issued;
  }

  /** 이 토큰이 속한 로그인(계열)을 끝낸다. 모르는 토큰이어도 같은 응답이다. */
  async logout(token: string) {
    const [owner]: { user_id: string; family_id: string }[] =
      await this.users.query(
        'SELECT user_id,family_id FROM refresh_tokens WHERE token_hash=$1',
        [hashRefreshToken(token)],
      );
    if (!owner) return;
    await this.withSessionOwnerLock(owner.user_id, async (manager) => {
      await manager.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE family_id=$1 AND user_id=$2 AND revoked_at IS NULL',
        [owner.family_id, owner.user_id],
      );
    });
  }

  /** Refresh rotation and revocation share a user-first lock order.
   * Taking the lock before UPDATE obtains a fresh statement snapshot, so a
   * successor inserted by an earlier rotation cannot escape revocation.
   */
  private async withSessionOwnerLock(
    userId: string,
    run: (manager: EntityManager) => Promise<void>,
  ) {
    await this.users.manager.transaction(async (manager) => {
      await manager.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [
        userId,
      ]);
      await run(manager);
    });
  }

  private async lockActiveUser(
    manager: EntityManager,
    id: string,
    expectedVersion?: number,
  ) {
    const user = await manager.findOne(User, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (
      !user ||
      user.deletedAt ||
      user.suspendedAt ||
      (expectedVersion !== undefined && user.tokenVersion !== expectedVersion)
    )
      throw new UnauthorizedException('다시 로그인해야 합니다.');
    return user;
  }

  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    expectedVersion?: number,
  ) {
    const hash = await this.passwordHasher.hash(dto.newPassword);
    return this.users.manager.transaction(async (manager) => {
      const user = await this.lockActiveUser(manager, userId, expectedVersion);
      if (
        !(await this.passwordHasher.verify(
          dto.currentPassword,
          user.passwordHash,
        ))
      )
        throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
      await manager.query(
        'UPDATE users SET password_hash=$1, token_version=token_version+1, must_change_password=false, updated_at=clock_timestamp() WHERE id=$2',
        [hash, userId],
      );
      await revokeRefreshTokens(manager, userId);
      const updated = await manager.findOneByOrFail(User, { id: userId });
      return this.issueSession(
        updated,
        await this.createRefreshToken(manager, updated, dto.remember ?? false),
      );
    });
  }

  async changeUsername(
    userId: string,
    dto: ChangeUsernameDto,
    sessionId?: string,
    expectedVersion?: number,
  ) {
    const username = dto.username.trim();
    if (username.toLowerCase() === 'boj_import')
      throw new ConflictException('이미 사용 중인 사용자 이름입니다.');
    try {
      return await this.users.manager.transaction(async (manager) => {
        const user = await this.lockActiveUser(
          manager,
          userId,
          expectedVersion,
        );
        await manager.update(User, { id: userId }, { username });
        return this.issueSession(
          Object.assign(user, { username }),
          undefined,
          sessionId,
        );
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error))
        throw new ConflictException('이미 사용 중인 사용자 이름입니다.');
      throw error;
    }
  }

  async withdraw(actor: AuthenticatedUser, password: string) {
    const discardedHash = await this.passwordHasher.hash(
      randomBytes(32).toString('base64url'),
    );
    await this.users.manager.transaction(async (manager) => {
      const user = await this.lockActiveUser(
        manager,
        actor.id,
        actor.tokenVersion,
      );
      if (user.role === 'ADMIN')
        throw new ConflictException(
          '관리자는 다른 관리자에게 권한 해제를 요청한 뒤 탈퇴해 주세요.',
        );
      if (user.mustChangePassword)
        throw new ForbiddenException(
          '임시 비밀번호를 먼저 변경한 뒤 탈퇴해 주세요.',
        );
      if (!(await this.passwordHasher.verify(password, user.passwordHash)))
        throw new BadRequestException('현재 비밀번호가 올바르지 않습니다.');
      // Preserve user UUID and authored content, but remove recoverable login identity.
      await manager.query(
        `UPDATE users SET deleted_at=clock_timestamp(),
        email=$3, username=$4,
        password_hash=$2, role='USER', suspended_at=NULL, must_change_password=false,
        token_version=token_version+1, email_verified_at=NULL, updated_at=clock_timestamp() WHERE id=$1`,
        [
          user.id,
          discardedHash,
          `${user.id}.${randomUUID()}@deleted.invalid`,
          '탈퇴한사용자_' +
            Buffer.from(user.id.replaceAll('-', ''), 'hex').toString(
              'base64url',
            ),
        ],
      );
      await revokeRefreshTokens(manager, user.id);
      // An email must not transfer existing invitations to a new account registering it.
      await manager.query(
        `UPDATE enterprise_tests SET invite_emails=array_remove(invite_emails,$1),
        invite_user_ids=array_remove(invite_user_ids,$2::uuid) WHERE $1=ANY(invite_emails) OR $2::uuid=ANY(invite_user_ids)`,
        [user.email, user.id],
      );
      await manager.query('DELETE FROM community_saved WHERE user_id=$1', [
        user.id,
      ]);
      await manager.query(
        'DELETE FROM community_follows WHERE user_id=$1 OR author_id=$1',
        [user.id],
      );
      await manager.query('DELETE FROM notifications WHERE user_id=$1', [
        user.id,
      ]);
    });
  }

  /** 살아 있는 로그인(계열)마다 지금 refresh token 한 행만 있다. 토큰 값·해시는 내보내지 않는다. */
  async sessions(userId: string, currentId?: string): Promise<SessionDevice[]> {
    const rows: Omit<SessionDevice, 'current'>[] = await this.users.query(
      `SELECT family_id AS id, family_created_at AS "createdAt", created_at AS "lastUsedAt",
              expires_at AS "expiresAt", remember
       FROM refresh_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((row) => ({ ...row, current: row.id === currentId }));
  }

  /** 내 로그인 하나를 끝낸다. 남의 계열 id여도 같은 응답이다(user_id 조건으로 막는다). */
  async revokeSession(userId: string, id: string) {
    await this.withSessionOwnerLock(userId, async (manager) => {
      await manager.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND family_id=$2 AND revoked_at IS NULL',
        [userId, id],
      );
    });
  }

  /** 지금 기기를 뺀 내 로그인을 모두 끝낸다. */
  async revokeOtherSessions(userId: string, currentId?: string) {
    await this.withSessionOwnerLock(userId, async (manager) => {
      await manager.query(
        'UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND family_id IS DISTINCT FROM $2::uuid AND revoked_at IS NULL',
        [userId, currentId ?? null],
      );
    });
  }

  private async createRefreshToken(
    manager: EntityManager,
    user: User,
    remember: boolean,
    family?: { id: string; createdAt: Date },
  ) {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + refreshLifetimeMs(remember));
    // 만료된 토큰은 재사용 검사에도 쓸모가 없으니 발급할 때 함께 지운다.
    await manager.query(
      'DELETE FROM refresh_tokens WHERE user_id = $1 AND expires_at <= now()',
      [user.id],
    );
    const familyId = family?.id ?? randomUUID();
    await manager.query(
      `INSERT INTO refresh_tokens (user_id, family_id, family_created_at, token_hash, token_version, remember, expires_at)
       VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $5, $6, $7)`,
      [
        user.id,
        familyId,
        family?.createdAt ?? null,
        hashRefreshToken(refreshToken),
        user.tokenVersion,
        remember,
        expiresAt,
      ],
    );
    return {
      familyId,
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      remember,
    };
  }

  private async issueSession(
    user: User,
    refresh?: Awaited<ReturnType<AuthService['createRefreshToken']>>,
    sessionId?: string,
  ) {
    const { familyId, ...refreshFields } = refresh ?? {};
    const sid = familyId ?? sessionId;
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
      ...(sid ? { sid } : {}),
    };
    const expiresIn = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    ) as JwtSignOptions['expiresIn'] | undefined;

    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn }),
      tokenType: 'Bearer',
      expiresIn,
      ...refreshFields,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        level: user.level,
        xp: user.xp,
        rating: user.rating,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }
}
