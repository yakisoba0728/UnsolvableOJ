import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { SetLearningGoalDto } from './dto/learning-goal.dto.js';

export interface LearningGoalView {
  timeZone: 'Asia/Seoul';
  generatedAt: string;
  goal: null | {
    targetProblems: number;
    days: 7 | 30 | 90;
    startDate: string;
    endDate: string;
    startsAt: string;
    endsAt: string;
    solvedProblems: number;
    status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED';
    updatedAt: string;
  };
}

/** A fixed goal period is independent of the dashboard's rolling window. */
const goalSql = `
WITH bounds AS (SELECT statement_timestamp() AS now)
SELECT jsonb_build_object(
  'timeZone', 'Asia/Seoul', 'generatedAt', b.now,
  'goal', CASE WHEN g.user_id IS NULL THEN NULL ELSE jsonb_build_object(
    'targetProblems', g.target_problems, 'days', g.days,
    'startDate', to_char(g.start_date, 'YYYY-MM-DD'),
    'endDate', to_char(g.start_date + g.days - 1, 'YYYY-MM-DD'),
    'startsAt', g.start_date::timestamp AT TIME ZONE 'Asia/Seoul',
    'endsAt', (g.start_date + g.days)::timestamp AT TIME ZONE 'Asia/Seoul',
    'solvedProblems', progress.solved,
    'status', CASE WHEN progress.solved >= g.target_problems THEN 'COMPLETED'
      WHEN b.now >= ((g.start_date + g.days)::timestamp AT TIME ZONE 'Asia/Seoul') THEN 'EXPIRED'
      ELSE 'ACTIVE' END,
    'updatedAt', g.updated_at
  ) END
) AS result
FROM users u CROSS JOIN bounds b
LEFT JOIN learning_goals g ON g.user_id = u.id
LEFT JOIN LATERAL (
  SELECT count(DISTINCT s.problem_id)::integer AS solved
  FROM submissions s JOIN problems p ON p.id = s.problem_id
  WHERE s.user_id = g.user_id AND s.status = 'ACCEPTED'
    AND NOT s.is_test AND s.attempt_id IS NULL
    AND p.status = 'PUBLISHED' AND NOT p.is_private
    AND s.created_at >= (g.start_date::timestamp AT TIME ZONE 'Asia/Seoul')
    AND s.created_at < ((g.start_date + g.days)::timestamp AT TIME ZONE 'Asia/Seoul')
    AND s.created_at <= b.now
) progress ON true
WHERE u.id = $1 AND u.deleted_at IS NULL AND u.suspended_at IS NULL
  AND NOT u.must_change_password AND ($2::integer IS NULL OR u.token_version = $2)
`;

@Injectable()
export class LearningGoalsService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  private async view(
    manager: Pick<EntityManager, 'query'>,
    user: AuthenticatedUser,
  ) {
    const [row] = await manager.query<{ result: LearningGoalView }[]>(goalSql, [
      user.id,
      user.tokenVersion ?? null,
    ]);
    if (!row) throw new UnauthorizedException('다시 로그인해야 합니다.');
    return row.result;
  }

  get(user: AuthenticatedUser) {
    return this.view(this.db, user);
  }

  private async lockOwner(manager: EntityManager, user: AuthenticatedUser) {
    // Match withdrawal: user first, then the private child row. Serialize writes
    // even when no goal exists, and re-check an actor authenticated before a wait.
    const [active] = await manager.query<{ id: string }[]>(
      `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL
       AND suspended_at IS NULL AND NOT must_change_password
       AND ($2::integer IS NULL OR token_version = $2) FOR UPDATE`,
      [user.id, user.tokenVersion ?? null],
    );
    if (!active) throw new UnauthorizedException('다시 로그인해야 합니다.');
  }

  set(user: AuthenticatedUser, dto: SetLearningGoalDto) {
    return this.db.transaction(async (manager) => {
      await this.lockOwner(manager, user);
      await manager.query(
        `INSERT INTO learning_goals(user_id, target_problems, days, start_date)
         VALUES($1, $2, $3, (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date)
         ON CONFLICT (user_id) DO UPDATE SET target_problems = EXCLUDED.target_problems,
           days = EXCLUDED.days, start_date = EXCLUDED.start_date,
           updated_at = statement_timestamp()
         WHERE learning_goals.target_problems IS DISTINCT FROM EXCLUDED.target_problems
            OR learning_goals.days IS DISTINCT FROM EXCLUDED.days`,
        [user.id, dto.targetProblems, dto.days],
      );
      // An identical PUT does not move a goal's dates or extend its deadline.
      return this.view(manager, user);
    });
  }

  reset(user: AuthenticatedUser) {
    return this.db.transaction(async (manager) => {
      await this.lockOwner(manager, user);
      const [goal] = await manager.query<{ user_id: string }[]>(
        'SELECT user_id FROM learning_goals WHERE user_id = $1',
        [user.id],
      );
      if (!goal)
        throw new NotFoundException('다시 시작할 학습 목표가 없습니다.');
      // Calendar goals restart from today's midnight, including today's solves.
      // Repeating reset on the same day is idempotent.
      await manager.query(
        `UPDATE learning_goals SET start_date = (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date,
           updated_at = statement_timestamp()
         WHERE user_id = $1 AND start_date <> (statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date`,
        [user.id],
      );
      return this.view(manager, user);
    });
  }

  remove(user: AuthenticatedUser) {
    return this.db.transaction(async (manager) => {
      await this.lockOwner(manager, user);
      await manager.query('DELETE FROM learning_goals WHERE user_id = $1', [
        user.id,
      ]);
      return this.view(manager, user);
    });
  }
}
