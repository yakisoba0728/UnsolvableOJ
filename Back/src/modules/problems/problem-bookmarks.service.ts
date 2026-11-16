import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Injectable()
export class ProblemBookmarksService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async get(problemId: string, user: AuthenticatedUser) {
    const [row] = await this.db.query<{ bookmarked: boolean }[]>(
      `SELECT EXISTS (SELECT 1 FROM problem_bookmarks b
         WHERE b.problem_id=p.id AND b.user_id=$2) AS bookmarked
       FROM problems p WHERE p.id=$1 AND p.status='PUBLISHED' AND NOT p.is_private`,
      [problemId, user.id],
    );
    if (!row) throw new NotFoundException('문제를 찾을 수 없습니다.');
    return row;
  }

  async save(problemId: string, user: AuthenticatedUser) {
    return this.db.transaction(async (manager) => {
      // Problem management locks problem before author (its draft quota). Match that
      // order; submission FK KEY SHARE checks remain compatible with this SHARE lock.
      const [problem] = await manager.query<{ id: string }[]>(
        `SELECT id FROM problems WHERE id=$1 AND status='PUBLISHED'
         AND NOT is_private FOR SHARE`,
        [problemId],
      );
      if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
      // Withdrawal must erase all bookmarks; an already authenticated request must
      // not recreate them after account deletion commits. Withdrawal locks only user.
      const [active] = await manager.query<{ id: string }[]>(
        `SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL
         AND suspended_at IS NULL AND NOT must_change_password
         AND ($2::integer IS NULL OR token_version=$2) FOR SHARE`,
        [user.id, user.tokenVersion ?? null],
      );
      if (!active) throw new UnauthorizedException('다시 로그인해야 합니다.');
      await manager.query(
        `INSERT INTO problem_bookmarks(user_id, problem_id) VALUES($1,$2)
         ON CONFLICT (user_id, problem_id) DO NOTHING`,
        [user.id, problemId],
      );
      return { bookmarked: true };
    });
  }

  async remove(problemId: string, user: AuthenticatedUser) {
    // Deleting an unavailable problem's bookmark is allowed; no existence details leak.
    await this.db.query('DELETE FROM problem_bookmarks WHERE user_id=$1 AND problem_id=$2', [
      user.id,
      problemId,
    ]);
    return { bookmarked: false };
  }
}
