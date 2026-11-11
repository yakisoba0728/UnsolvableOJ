import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import {
  DataSource,
  ILike,
  IsNull,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import { recordAudit } from '../../common/database.js';
import { findListPage } from '../../common/list-cursor.js';
import {
  JUDGE_QUEUE,
  JUDGE_WORKER_ONLINE_MS,
  JUDGE_WORKERS_KEY,
} from '../../common/queue.constants.js';
import { revokeRefreshTokens } from '../auth/auth.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PasswordHasher } from '../auth/password-hasher.service.js';
import { UserRole } from '../users/user-role.enum.js';
import { User } from '../users/user.entity.js';
import { AuditEvent } from './audit-event.entity.js';
import type {
  ListAdminUsersQuery,
  ListAuditQuery,
} from './dto/admin-list.query.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectQueue(JUDGE_QUEUE) private readonly queue: Queue,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(AuditEvent)
    private readonly auditRepository: Repository<AuditEvent>,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async users(query: ListAdminUsersQuery) {
    const where: FindOptionsWhere<User> = query.role
      ? { role: query.role, deletedAt: IsNull() }
      : { deletedAt: IsNull() };
    const text = query.q?.trim();
    // LIKE의 기본 이스케이프 문자(\)로 %·_를 글자 그대로 찾는다.
    const pattern = text && `%${text.replace(/[\\%_]/g, '\\$&')}%`;
    return findListPage(
      this.userRepository,
      this.db,
      'users',
      query,
      pattern
        ? [
            { ...where, username: ILike(pattern) },
            { ...where, email: ILike(pattern) },
          ]
        : where,
      {
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          level: true,
          xp: true,
          rating: true,
          suspendedAt: true,
          createdAt: true,
        },
      },
    );
  }

  async changeSuspension(
    id: string,
    suspended: boolean,
    actor: AuthenticatedUser,
  ) {
    if (suspended && id.toLowerCase() === actor.id.toLowerCase())
      throw new ConflictException('자신의 계정을 정지할 수 없습니다.');
    return this.db.transaction(async (manager) => {
      // 대상과 활성 관리자를 한 문장에서 같은 순서로 잠가, 관리자끼리 동시에 서로 정지해도 교착되거나 둘 다 정지되지 않는다.
      const rows: {
        id: string;
        role: UserRole;
        suspendedAt: Date | null;
        deletedAt: Date | null;
        tokenVersion: number;
      }[] = await manager.query(
        `SELECT id, role, suspended_at AS "suspendedAt", deleted_at AS "deletedAt", token_version AS "tokenVersion" FROM users
           WHERE id = $1 OR (role = 'ADMIN' AND suspended_at IS NULL AND deleted_at IS NULL)
           ORDER BY id FOR UPDATE`,
        [id],
      );
      const target = rows.find((row) => row.id === id.toLowerCase());
      if (!target || target.deletedAt)
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      // 수행자가 잠근 시점에도 활성 관리자여야 한다. 자신은 정지할 수 없으니 최소 한 명(수행자)의 관리자가 남는다.
      if (
        !rows.some(
          (row) =>
            row.id === actor.id.toLowerCase() &&
            row.role === UserRole.ADMIN &&
            !row.suspendedAt &&
            !row.deletedAt &&
            (actor.tokenVersion === undefined ||
              row.tokenVersion === actor.tokenVersion),
        )
      )
        throw new ForbiddenException(
          '관리자 권한이 바뀌었거나 정지되었습니다. 다시 로그인해 주세요.',
        );
      if (Boolean(target.suspendedAt) === suspended)
        return { id, suspendedAt: target.suspendedAt };
      // 정지하면 token_version을 올려 이미 발급된 토큰도 바로 막는다.
      // TypeORM은 UPDATE ... RETURNING 결과를 [행 목록, 바뀐 행 수]로 돌려준다.
      const [[updated]]: [{ suspendedAt: Date | null }[], number] =
        await manager.query(
          suspended
            ? 'UPDATE users SET suspended_at = now(), token_version = token_version + 1, updated_at = now() WHERE id = $1 RETURNING suspended_at AS "suspendedAt"'
            : 'UPDATE users SET suspended_at = NULL, updated_at = now() WHERE id = $1 RETURNING suspended_at AS "suspendedAt"',
          [id],
        );
      await recordAudit(
        manager,
        actor.id,
        suspended ? 'user.suspend' : 'user.unsuspend',
        'user',
        id,
        {},
      );
      return { id, suspendedAt: updated.suspendedAt };
    });
  }

  async changeRole(id: string, role: UserRole, actor: AuthenticatedUser) {
    if (id.toLowerCase() === actor.id.toLowerCase() && role !== UserRole.ADMIN)
      throw new ConflictException('자신의 관리자 권한을 해제할 수 없습니다.');
    return this.db.transaction(async (manager) => {
      const target = await this.lockAdminTarget(manager, id, actor);
      const rows = [target];
      if (rows[0].role !== role) {
        await manager.query(
          'UPDATE users SET role = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2',
          [role, id],
        );
        await recordAudit(manager, actor.id, 'user.role', 'user', id, {
          from: rows[0].role,
          to: role,
        });
      }
      return { id, role };
    });
  }

  /** 이메일 없이 비밀번호를 되찾게 임시 비밀번호를 만든다. 기존 JWT·refresh token은 모두 끊는다. */
  async issueTemporaryPassword(id: string, actor: AuthenticatedUser) {
    if (id.toLowerCase() === actor.id.toLowerCase())
      throw new ConflictException(
        '자신의 비밀번호는 계정 설정에서 바꿔 주세요.',
      );
    // 18바이트 = base64url 24자(144비트). 응답으로 한 번만 보여 주고 감사 기록에는 남기지 않는다.
    const temporaryPassword = randomBytes(18).toString('base64url');
    const passwordHash = await this.passwordHasher.hash(temporaryPassword);
    return this.db.transaction(async (manager) => {
      await this.lockAdminTarget(manager, id, actor);
      const [rows]: [{ id: string }[], number] = await manager.query(
        'UPDATE users SET password_hash = $1, token_version = token_version + 1, must_change_password = true, updated_at = now() WHERE id = $2 RETURNING id',
        [passwordHash, id],
      );
      if (!rows.length)
        throw new NotFoundException('사용자를 찾을 수 없습니다.');
      await revokeRefreshTokens(manager, id);
      await recordAudit(
        manager,
        actor.id,
        'user.temporary_password',
        'user',
        id,
        {},
      );
      return { temporaryPassword };
    });
  }

  private async lockAdminTarget(
    manager: EntityManager,
    id: string,
    actor: AuthenticatedUser,
  ) {
    const rows: {
      id: string;
      role: UserRole;
      deletedAt: Date | null;
      suspendedAt: Date | null;
      tokenVersion: number;
    }[] = await manager.query(
      'SELECT id,role,deleted_at AS "deletedAt",suspended_at AS "suspendedAt",token_version AS "tokenVersion" FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
      [[id, actor.id]],
    );
    const current = rows.find((row) => row.id === actor.id.toLowerCase());
    if (
      !current ||
      current.role !== UserRole.ADMIN ||
      current.deletedAt ||
      current.suspendedAt ||
      (actor.tokenVersion !== undefined &&
        current.tokenVersion !== actor.tokenVersion)
    )
      throw new ForbiddenException('관리자 권한을 다시 확인해 주세요.');
    const target = rows.find((row) => row.id === id.toLowerCase());
    if (!target || target.deletedAt)
      throw new NotFoundException('사용자를 찾을 수 없습니다.');
    return target;
  }

  async audit(query: ListAuditQuery) {
    const where: FindOptionsWhere<AuditEvent> = {};
    if (query.action) where.action = query.action;
    if (query.actorId) where.actorId = query.actorId;
    if (query.targetId) where.targetId = query.targetId;
    const page = await findListPage(
      this.auditRepository,
      this.db,
      'audit_events',
      query,
      where,
      {},
    );
    // 쪽마다 한 번만 사용자 이름을 모아 읽는다(수행자와 사용자 대상).
    const ids = [
      ...new Set(
        page.items.flatMap((event) => [
          event.actorId,
          event.targetType === 'user' ? event.targetId : null,
        ]),
      ),
    ].filter((value) => value !== null);
    const names = new Map(
      (ids.length
        ? await this.db.query<{ id: string; username: string }[]>(
            'SELECT id, username FROM users WHERE id = ANY($1::uuid[])',
            [ids],
          )
        : []
      ).map((row) => [row.id, row.username]),
    );
    return {
      ...page,
      items: page.items.map((event) =>
        Object.assign(event, {
          actorUsername: names.get(event.actorId ?? '') ?? null,
          targetUsername:
            event.targetType === 'user'
              ? (names.get(event.targetId) ?? null)
              : null,
        }),
      ),
    };
  }

  async ops() {
    const [queue, submissions, workerMap, failed] = await Promise.all([
      this.queue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      ),
      this.db.query(
        'SELECT status, count(*)::integer AS count FROM submissions GROUP BY status',
      ),
      this.queue
        .getBackend()
        .client.then((client) => client.hgetall(JUDGE_WORKERS_KEY)),
      this.queue.getJobs(['failed'], 0, 9),
    ]);
    const now = Date.now();
    return {
      queue,
      submissions,
      workers: Object.entries(workerMap)
        .filter(([, seen]) => now - Number(seen) < JUDGE_WORKER_ONLINE_MS)
        .map(([id, seen]) => ({
          id,
          lastSeenAt: new Date(Number(seen)).toISOString(),
        })),
      recentFailedJobs: failed.map((job) => ({
        id: job.id,
        failedReason: job.failedReason,
        attemptsMade: job.attemptsMade,
      })),
      timestamp: new Date().toISOString(),
    };
  }
}
