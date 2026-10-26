import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(@InjectDataSource() private readonly db: DataSource) {}

  async me(id: string) {
    const rows = await this.db.query(
      `
      SELECT u.id, u.email, u.username, u.role, u.level, u.xp, u.rating,
        u.created_at AS "createdAt",
        (SELECT count(*)::integer FROM user_problem_solves s WHERE s.user_id = u.id) AS "solvedCount"
      FROM users u WHERE u.id = $1
    `,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    rows[0].badges = await this.db.query(
      'SELECT badge, awarded_at AS "awardedAt" FROM user_badges WHERE user_id=$1 ORDER BY awarded_at,badge',
      [id],
    );
    return rows[0];
  }

  rankings() {
    return this.db.query(`
      SELECT u.id, u.username, u.level, u.xp, u.rating,
        (SELECT count(*)::integer FROM user_problem_solves s WHERE s.user_id = u.id) AS "solvedCount"
      FROM users u ORDER BY u.xp DESC, u.created_at ASC LIMIT 100
    `);
  }
}
