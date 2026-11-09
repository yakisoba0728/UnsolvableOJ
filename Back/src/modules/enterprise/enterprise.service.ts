import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import type {
  CreateEnterpriseTestDto,
  UpdateEnterpriseTestDto,
} from './dto/enterprise-test.dto.js';

interface TestRow {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  starts_at: Date;
  ends_at: Date;
  duration_min: number;
  problem_ids: string[];
  invite_code: string;
  created_at: Date;
  updated_at: Date;
  attempt_count?: number;
}

interface AttemptRow {
  id: string;
  test_id: string;
  user_id: string;
  started_at: Date;
  deadline_at: Date;
  finished_at: Date | null;
}

const NOT_FOUND = '테스트를 찾을 수 없습니다.';
const TEST_COLUMNS = `t.*, (SELECT count(*)::int FROM enterprise_attempts a WHERE a.test_id = t.id) AS attempt_count`;

const toTest = (row: TestRow) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  durationMin: row.duration_min,
  problemIds: row.problem_ids,
  inviteCode: row.invite_code,
  attemptCount: row.attempt_count ?? 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toAttempt = (row: AttemptRow) => ({
  id: row.id,
  startedAt: row.started_at,
  deadlineAt: row.deadline_at,
  finishedAt: row.finished_at,
});

/** 응시자에게 보여 줄 공개 정보. 문제 목록은 시작한 뒤에만 준다. */
const toPublicTest = (row: TestRow) => ({
  title: row.title,
  description: row.description,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  durationMin: row.duration_min,
  problemCount: row.problem_ids.length,
});

@Injectable()
export class EnterpriseService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(user: AuthenticatedUser) {
    const rows: TestRow[] = await this.dataSource.query(
      `SELECT ${TEST_COLUMNS} FROM enterprise_tests t WHERE t.owner_id = $1 ORDER BY t.created_at DESC LIMIT 200`,
      [user.id],
    );
    return rows.map(toTest);
  }

  async create(dto: CreateEnterpriseTestDto, user: AuthenticatedUser) {
    this.assertSchedule(dto.startsAt, dto.endsAt, dto.durationMin, true);
    return this.dataSource.transaction(async (manager) => {
      await this.assertProblems(manager, dto.problemIds, user);
      const [row]: TestRow[] = await manager.query(
        `INSERT INTO enterprise_tests (owner_id, title, description, starts_at, ends_at, duration_min, problem_ids, invite_code)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8) RETURNING *`,
        [
          user.id,
          dto.title.trim(),
          (dto.description ?? '').trim(),
          dto.startsAt,
          dto.endsAt,
          dto.durationMin,
          dto.problemIds,
          randomBytes(12).toString('base64url'),
        ],
      );
      return toTest(row);
    });
  }

  async findOwned(id: string, user: AuthenticatedUser) {
    return toTest(await this.owned(this.dataSource.manager, id, user));
  }

  async update(id: string, dto: UpdateEnterpriseTestDto, user: AuthenticatedUser) {
    if (!Object.keys(dto).length) throw new BadRequestException('변경할 필드가 없습니다.');
    return this.dataSource.transaction(async (manager) => {
      const current = await this.owned(manager, id, user, true);
      if (current.starts_at.getTime() <= Date.now())
        throw new ConflictException('시작된 테스트는 수정할 수 없어요.');
      const next = {
        title: dto.title?.trim() ?? current.title,
        description: dto.description?.trim() ?? current.description,
        startsAt: dto.startsAt ?? current.starts_at.toISOString(),
        endsAt: dto.endsAt ?? current.ends_at.toISOString(),
        durationMin: dto.durationMin ?? current.duration_min,
        problemIds: dto.problemIds ?? current.problem_ids,
      };
      this.assertSchedule(next.startsAt, next.endsAt, next.durationMin, true);
      if (dto.problemIds) await this.assertProblems(manager, dto.problemIds, user);
      // TypeORM은 UPDATE ... RETURNING 결과를 [행 목록, 바뀐 수]로 돌려준다.
      const [[row]]: [TestRow[], number] = await manager.query(
        `UPDATE enterprise_tests SET title = $2, description = $3, starts_at = $4, ends_at = $5,
           duration_min = $6, problem_ids = $7::uuid[], updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, next.title, next.description, next.startsAt, next.endsAt, next.durationMin, next.problemIds],
      );
      return toTest(row);
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      const test = await this.owned(manager, id, user, true);
      // 응시 기록이 있으면 지우지 않는다. 지우면 응시 제출이 시험과 끊겨 문제 작성자에게 보이게 된다.
      if (test.attempt_count)
        throw new ConflictException('응시 기록이 있는 테스트는 삭제할 수 없어요.');
      await manager.query('DELETE FROM enterprise_tests WHERE id = $1', [id]);
    });
    return { id };
  }

  /** 응시자별 문제 정답 여부와 점수. 점수는 맞힌 문제 비율(0~100)이다. */
  async results(id: string, user: AuthenticatedUser) {
    const test = await this.owned(this.dataSource.manager, id, user);
    const rows: (AttemptRow & {
      username: string;
      problems: { problemId: string; solved: boolean; submissions: number; submissionId: string }[];
    })[] = await this.dataSource.query(
      `SELECT a.*, u.username,
              coalesce(json_agg(json_build_object(
                'problemId', s.problem_id, 'solved', s.solved,
                'submissions', s.count, 'submissionId', s.submission_id
              )) FILTER (WHERE s.problem_id IS NOT NULL), '[]') AS problems
         FROM enterprise_attempts a
         JOIN users u ON u.id = a.user_id
         LEFT JOIN LATERAL (
           SELECT problem_id, bool_or(status = 'ACCEPTED') AS solved, count(*)::int AS count,
                  (array_agg(id ORDER BY (status = 'ACCEPTED') DESC, created_at DESC))[1] AS submission_id
             FROM submissions WHERE attempt_id = a.id GROUP BY problem_id
         ) s ON true
        WHERE a.test_id = $1
        GROUP BY a.id, u.username
        ORDER BY a.started_at`,
      [id],
    );
    const total = test.problem_ids.length;
    const candidates = rows.map((row) => {
      const solved = row.problems.filter((problem) => problem.solved).length;
      return {
        ...toAttempt(row),
        user: { id: row.user_id, username: row.username },
        problems: row.problems,
        solved,
        score: Math.round((solved / total) * 100),
      };
    });
    return {
      test: toTest(test),
      summary: {
        candidates: candidates.length,
        averageScore: candidates.length
          ? Math.round(candidates.reduce((sum, item) => sum + item.score, 0) / candidates.length)
          : null,
        // 모든 문제를 맞힌 응시자 수.
        perfect: candidates.filter((item) => item.solved === total).length,
      },
      candidates,
    };
  }

  async joinInfo(code: string, user: AuthenticatedUser) {
    const test = await this.byCode(this.dataSource.manager, code);
    const [attempt]: AttemptRow[] = await this.dataSource.query(
      'SELECT * FROM enterprise_attempts WHERE test_id = $1 AND user_id = $2',
      [test.id, user.id],
    );
    return {
      test: toPublicTest(test),
      isOwner: test.owner_id === user.id,
      attempt: attempt ? toAttempt(attempt) : null,
    };
  }

  /** 응시를 시작한다. 이미 시작했으면 그 응시를 그대로 돌려준다. */
  async start(code: string, user: AuthenticatedUser) {
    return this.dataSource.transaction(async (manager) => {
      const test = await this.byCode(manager, code);
      const [existing]: AttemptRow[] = await manager.query(
        'SELECT * FROM enterprise_attempts WHERE test_id = $1 AND user_id = $2',
        [test.id, user.id],
      );
      if (existing) return toAttempt(existing);
      if (test.owner_id === user.id)
        throw new ForbiddenException('테스트를 만든 계정으로는 응시할 수 없어요.');
      const [inserted]: AttemptRow[] = await manager.query(
        `INSERT INTO enterprise_attempts (test_id, user_id, deadline_at)
         SELECT t.id, $2, LEAST(now() + make_interval(mins => t.duration_min), t.ends_at)
           FROM enterprise_tests t
          WHERE t.id = $1 AND t.starts_at <= now() AND now() < t.ends_at
         ON CONFLICT (test_id, user_id) DO NOTHING
         RETURNING *`,
        [test.id, user.id],
      );
      if (inserted) return toAttempt(inserted);
      const [raced]: AttemptRow[] = await manager.query(
        'SELECT * FROM enterprise_attempts WHERE test_id = $1 AND user_id = $2',
        [test.id, user.id],
      );
      if (raced) return toAttempt(raced);
      throw new ConflictException(
        test.starts_at.getTime() > Date.now() ? '아직 응시 기간이 아니에요.' : '응시 기간이 끝났어요.',
      );
    });
  }

  /** 응시 화면: 문제 본문·예제(해설·태그·숨은 테스트 제외)와 문제별 내 제출 상태. */
  async attempt(id: string, user: AuthenticatedUser) {
    const attempt = await this.ownAttempt(id, user);
    const [test]: TestRow[] = await this.dataSource.query(
      'SELECT * FROM enterprise_tests WHERE id = $1',
      [attempt.test_id],
    );
    const problems: {
      id: string;
      title: string;
      difficulty: string;
      statementMarkdown: string;
      inputDescriptionMarkdown: string;
      outputDescriptionMarkdown: string;
      timeLimitMs: number;
      memoryLimitMb: number;
      samples: { input: string; expectedOutput: string }[];
    }[] = await this.dataSource.query(
      `SELECT p.id, p.title, p.difficulty, p.statement_md AS "statementMarkdown",
              p.input_description_md AS "inputDescriptionMarkdown",
              p.output_description_md AS "outputDescriptionMarkdown",
              p.time_limit_ms AS "timeLimitMs", p.memory_limit_mb AS "memoryLimitMb",
              coalesce((SELECT json_agg(json_build_object('input', c.input, 'expectedOutput', c.expected_output) ORDER BY c."order")
                          FROM test_cases c WHERE c.problem_id = p.id AND c.is_sample), '[]') AS samples
         FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, position)
         JOIN problems p ON p.id = o.id
        ORDER BY o.position`,
      [test.problem_ids],
    );
    const statuses: {
      problemId: string;
      solved: boolean;
      lastSubmissionId: string;
      lastStatus: string;
    }[] = await this.dataSource.query(
      `SELECT problem_id AS "problemId", bool_or(status = 'ACCEPTED') AS solved,
              (array_agg(id ORDER BY created_at DESC))[1] AS "lastSubmissionId",
              (array_agg(status ORDER BY created_at DESC))[1] AS "lastStatus"
         FROM submissions WHERE attempt_id = $1 GROUP BY problem_id`,
      [id],
    );
    const byProblem = new Map(statuses.map((status) => [status.problemId, status]));
    return {
      ...toAttempt(attempt),
      test: toPublicTest(test),
      problems: problems.map((problem) => ({
        ...problem,
        solved: byProblem.get(problem.id)?.solved ?? false,
        lastSubmissionId: byProblem.get(problem.id)?.lastSubmissionId ?? null,
        lastStatus: byProblem.get(problem.id)?.lastStatus ?? null,
      })),
    };
  }

  async finish(id: string, user: AuthenticatedUser) {
    await this.ownAttempt(id, user);
    const [[row]]: [AttemptRow[], number] = await this.dataSource.query(
      'UPDATE enterprise_attempts SET finished_at = coalesce(finished_at, now()) WHERE id = $1 RETURNING *',
      [id],
    );
    return toAttempt(row);
  }

  private async ownAttempt(id: string, user: AuthenticatedUser) {
    const [attempt]: AttemptRow[] = await this.dataSource.query(
      'SELECT * FROM enterprise_attempts WHERE id = $1 AND user_id = $2',
      [id, user.id],
    );
    if (!attempt) throw new NotFoundException('응시 기록을 찾을 수 없습니다.');
    return attempt;
  }

  private async owned(manager: EntityManager, id: string, user: AuthenticatedUser, lock = false) {
    const [row]: TestRow[] = await manager.query(
      `SELECT ${TEST_COLUMNS} FROM enterprise_tests t WHERE t.id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    // 남의 테스트는 존재 여부를 드러내지 않는다.
    if (!row || (row.owner_id !== user.id && user.role !== UserRole.ADMIN))
      throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async byCode(manager: EntityManager, code: string) {
    const [row]: TestRow[] = await manager.query(
      'SELECT * FROM enterprise_tests WHERE invite_code = $1',
      [code.slice(0, 32)],
    );
    if (!row) throw new NotFoundException('응시 링크가 올바르지 않거나 삭제된 테스트예요.');
    return row;
  }

  private assertSchedule(startsAt: string, endsAt: string, durationMin: number, future: boolean) {
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (!(end > start)) throw new BadRequestException('종료 일시는 시작 일시보다 늦어야 해요.');
    if (future && end <= Date.now())
      throw new BadRequestException('종료 일시는 지금보다 이후여야 해요.');
    if (durationMin * 60_000 > end - start)
      throw new BadRequestException('제한 시간은 응시 기간보다 길 수 없어요.');
  }

  /** 출제 화면에서 고를 수 있는 문제만 허용: 공개 문제, 내가 만든 문제(기업 전용 포함), 관리자는 전부. */
  private async assertProblems(manager: EntityManager, ids: string[], user: AuthenticatedUser) {
    const [{ count }]: { count: number }[] = await manager.query(
      `SELECT count(*)::int AS count FROM problems
        WHERE id = ANY($1::uuid[]) AND (status = 'PUBLISHED' OR author_id = $2 OR $3)`,
      [ids, user.id, user.role === UserRole.ADMIN],
    );
    if (count !== ids.length)
      throw new BadRequestException('출제할 수 없는 문제가 포함되어 있어요. 문제 목록을 다시 확인해 주세요.');
  }
}
