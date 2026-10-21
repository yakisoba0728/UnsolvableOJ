import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  JUDGE_QUEUE,
  JUDGE_WORKER_ONLINE_MS,
  JUDGE_WORKERS_KEY,
} from '../../common/queue.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';

@Injectable()
export class AdminService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    @InjectQueue(JUDGE_QUEUE) private readonly queue: Queue,
  ) {}

  async users() {
    return this.db.query(
      'SELECT id, email, username, role, level, xp, rating, created_at AS "createdAt" FROM users ORDER BY created_at DESC LIMIT 100',
    );
  }

  async changeRole(id: string, role: UserRole, actor: AuthenticatedUser) {
    if (id.toLowerCase() === actor.id.toLowerCase() && role !== UserRole.ADMIN)
      throw new ConflictException('자신의 관리자 권한을 해제할 수 없습니다.');
    return this.db.transaction(async (manager) => {
      const rows: { role: UserRole }[] = await manager.query(
        'SELECT role FROM users WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!rows[0]) throw new NotFoundException('사용자를 찾을 수 없습니다.');
      if (rows[0].role !== role) {
        await manager.query(
          'UPDATE users SET role = $1, token_version = token_version + 1, updated_at = now() WHERE id = $2',
          [role, id],
        );
        await manager.query(
          'INSERT INTO audit_events (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [
            actor.id,
            'user.role',
            'user',
            id,
            JSON.stringify({ from: rows[0].role, to: role }),
          ],
        );
      }
      return { id, role };
    });
  }

  async audit() {
    return this.db.query(
      'SELECT id, actor_id AS "actorId", action, target_type AS "targetType", target_id AS "targetId", details, created_at AS "createdAt" FROM audit_events ORDER BY created_at DESC LIMIT 100',
    );
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
