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
        (SELECT count(*)::integer FROM user_problem_solves s WHERE s.user_id = u.id) AS "solvedCount",
        -- 랭킹 API와 같은 정렬(xp 내림차순, 가입 순)로 센 1부터의 전체 순위. 상위 100명 밖이어도 알려 준다.
        (SELECT count(*)::integer + 1 FROM users o
          WHERE o.xp > u.xp OR (o.xp = u.xp AND o.created_at < u.created_at)) AS rank
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

  async publicProfile(username: string) {
    // 이메일·역할·rating은 공개하지 않는다. 순위는 me와 같은 정렬로 센다.
    const rows = await this.db.query(
      `
      SELECT u.id, u.username, u.level, u.xp, u.created_at AS "createdAt",
        (SELECT count(*)::integer FROM user_problem_solves s WHERE s.user_id = u.id) AS "solvedCount",
        (SELECT count(*)::integer + 1 FROM users o
          WHERE o.xp > u.xp OR (o.xp = u.xp AND o.created_at < u.created_at)) AS rank
      FROM users u WHERE lower(u.username) = lower($1)
    `,
      [username],
    );
    const user = rows[0];
    if (!user) throw new NotFoundException('사용자를 찾을 수 없습니다.');
    user.badges = await this.db.query(
      'SELECT badge, awarded_at AS "awardedAt" FROM user_badges WHERE user_id=$1 ORDER BY awarded_at,badge',
      [user.id],
    );
    // solvedCount는 랭킹과 같이 전부 세고, 목록에는 공개 문제만 보인다.
    user.solvedProblems = await this.db.query(
      `
      SELECT p.id, p.slug, p.title, p.difficulty, s.created_at AS "solvedAt"
      FROM user_problem_solves s JOIN problems p ON p.id = s.problem_id
      WHERE s.user_id = $1 AND p.status = 'PUBLISHED'
      ORDER BY s.created_at DESC, p.id
    `,
      [user.id],
    );
    return user;
  }

  rankings() {
    return this.rankingRows(100, 0);
  }

  async rankingPage(page: number, limit: number) {
    const [items, [{ total }]] = await Promise.all([
      this.rankingRows(limit, (page - 1) * limit),
      this.db.query('SELECT count(*)::integer AS total FROM users'),
    ]);
    return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  // rank()는 XP·가입 시각이 모두 같으면 같은 순위를 줘 me·publicProfile의 count+1과 일치한다.
  private rankingRows(limit: number, offset: number) {
    return this.db.query(
      `
      SELECT u.id, u.username, u.level, u.xp, u.rating,
        (SELECT count(*)::integer FROM user_problem_solves s WHERE s.user_id = u.id) AS "solvedCount",
        rank() OVER (ORDER BY u.xp DESC, u.created_at ASC)::integer AS rank
      FROM users u ORDER BY u.xp DESC, u.created_at ASC, u.id LIMIT $1 OFFSET $2
    `,
      [limit, offset],
    );
  }
}
