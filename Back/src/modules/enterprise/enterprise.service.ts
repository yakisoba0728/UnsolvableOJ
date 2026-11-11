import { randomBytes } from 'node:crypto';
import { VibeService } from '../vibe/vibe.service.js';
import { challenge } from '../vibe/vibe.catalog.js';
import type { VibeReport } from '../vibe/vibe.types.js';
import { canJoinEnterprise as canJoin } from './enterprise-access.js';
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
  vibe_challenge_ids: string[];
  invite_code: string;
  invite_only: boolean;
  invite_user_ids: string[];
  invite_emails: string[];
  show_score_to_candidates: boolean;
  created_at: Date;
  updated_at: Date;
  attempt_count?: number;
  invite_usernames?: string[];
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
const TEST_COLUMNS = `t.*, (SELECT count(*)::int FROM enterprise_attempts a WHERE a.test_id = t.id) AS attempt_count,
  ARRAY(SELECT u.username FROM users u WHERE u.id = ANY(t.invite_user_ids) ORDER BY lower(u.username)) AS invite_usernames`;

const toTest = (row: TestRow) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  durationMin: row.duration_min,
  problemIds: row.problem_ids,
  vibeChallengeIds: row.vibe_challenge_ids,
  inviteCode: row.invite_code,
  inviteOnly: row.invite_only,
  invitees: [...(row.invite_usernames ?? []), ...row.invite_emails],
  showScoreToCandidates: row.show_score_to_candidates,
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
  problemCount: row.problem_ids.length + row.vibe_challenge_ids.length,
});

@Injectable()
export class EnterpriseService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly vibe: VibeService,
  ) {}

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
      this.assertTasks(dto.problemIds, dto.vibeChallengeIds ?? []);
      await this.assertProblems(manager, dto.problemIds, user);
      const invite = await this.resolveInvitees(
        manager,
        dto.inviteOnly ?? false,
        dto.invitees ?? [],
      );
      const [row]: TestRow[] = await manager.query(
        `INSERT INTO enterprise_tests (owner_id, title, description, starts_at, ends_at, duration_min, problem_ids, invite_code,
           invite_only, invite_user_ids, invite_emails, show_score_to_candidates, vibe_challenge_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10::uuid[], $11::text[], $12, $13::text[]) RETURNING id`,
        [
          user.id,
          dto.title.trim(),
          (dto.description ?? '').trim(),
          dto.startsAt,
          dto.endsAt,
          dto.durationMin,
          dto.problemIds,
          randomBytes(12).toString('base64url'),
          dto.inviteOnly ?? false,
          invite.userIds,
          invite.emails,
          dto.showScoreToCandidates ?? false,
          dto.vibeChallengeIds ?? [],
        ],
      );
      return toTest(await this.owned(manager, row.id, user));
    });
  }

  async findOwned(id: string, user: AuthenticatedUser) {
    return toTest(await this.owned(this.dataSource.manager, id, user));
  }

  async update(
    id: string,
    dto: UpdateEnterpriseTestDto,
    user: AuthenticatedUser,
  ) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('변경할 필드가 없습니다.');
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
        vibeChallengeIds: dto.vibeChallengeIds ?? current.vibe_challenge_ids,
      };
      this.assertSchedule(next.startsAt, next.endsAt, next.durationMin, true);
      this.assertTasks(next.problemIds, next.vibeChallengeIds);
      if (dto.problemIds)
        await this.assertProblems(manager, dto.problemIds, user);
      const inviteOnly = dto.inviteOnly ?? current.invite_only;
      const invite =
        dto.invitees || dto.inviteOnly !== undefined
          ? await this.resolveInvitees(
              manager,
              inviteOnly,
              dto.invitees ?? toTest(current).invitees,
            )
          : { userIds: current.invite_user_ids, emails: current.invite_emails };
      await manager.query(
        `UPDATE enterprise_tests SET title = $2, description = $3, starts_at = $4, ends_at = $5,
           duration_min = $6, problem_ids = $7::uuid[], invite_only = $8, invite_user_ids = $9::uuid[],
           invite_emails = $10::text[], show_score_to_candidates = $11, vibe_challenge_ids=$12::text[], updated_at = now()
         WHERE id = $1`,
        [
          id,
          next.title,
          next.description,
          next.startsAt,
          next.endsAt,
          next.durationMin,
          next.problemIds,
          inviteOnly,
          invite.userIds,
          invite.emails,
          dto.showScoreToCandidates ?? current.show_score_to_candidates,
          next.vibeChallengeIds,
        ],
      );
      return toTest(await this.owned(manager, id, user));
    });
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.dataSource.transaction(async (manager) => {
      await this.owned(manager, id, user, true);
      // 응시 기록이 있으면 지우지 않는다. 지우면 응시 제출이 시험과 끊겨 문제 작성자에게 보이게 된다.
      // 잠금 문장 안의 집계는 잠금을 기다리기 전 스냅샷이라 그사이 시작된 응시를 놓치므로, 잠근 뒤 다시 센다.
      const [{ count }]: { count: number }[] = await manager.query(
        'SELECT count(*)::int AS count FROM enterprise_attempts WHERE test_id = $1',
        [id],
      );
      if (count)
        throw new ConflictException(
          '응시 기록이 있는 테스트는 삭제할 수 없어요.',
        );
      await manager.query('DELETE FROM enterprise_tests WHERE id = $1', [id]);
    });
    return { id };
  }

  /** 일반 문제와 바이브코딩 과제를 동일 비중으로 합산한다. */
  async results(id: string, user: AuthenticatedUser) {
    const test = await this.owned(this.dataSource.manager, id, user);
    const rows: (AttemptRow & {
      username: string;
      problems: {
        problemId: string;
        solved: boolean;
        submissions: number;
        submissionId: string;
      }[];
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
    const scores = await this.vibeScores(
      test,
      rows.map((row) => row.id),
    );
    const candidates = rows.map((row) => {
      const solved = row.problems.filter((problem) => problem.solved).length;
      return {
        ...toAttempt(row),
        user: { id: row.user_id, username: row.username },
        problems: row.problems,
        solved,
        vibeTasks: scores.get(row.id) ?? [],
        score: assessmentScore(
          solved,
          test.problem_ids.length,
          (scores.get(row.id) ?? []).map((task) => task.score),
        ),
      };
    });
    const complete = candidates.filter((item) => item.score !== null);
    return {
      test: toTest(test),
      summary: {
        candidates: candidates.length,
        pending: candidates.length - complete.length,
        averageScore: complete.length
          ? Math.round(
              complete.reduce((sum, item) => sum + item.score!, 0) /
                complete.length,
            )
          : null,
        // 모든 문제를 맞힌 응시자 수.
        perfect: candidates.filter((item) => item.score === 100).length,
      },
      candidates,
    };
  }

  async joinInfo(code: string, user: AuthenticatedUser) {
    const test = await this.byCode(this.dataSource.manager, code, user);
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
      const test = await this.byCode(manager, code, user);
      const [existing]: AttemptRow[] = await manager.query(
        'SELECT * FROM enterprise_attempts WHERE test_id = $1 AND user_id = $2',
        [test.id, user.id],
      );
      if (existing) return toAttempt(existing);
      if (test.owner_id === user.id)
        throw new ForbiddenException(
          '테스트를 만든 계정으로는 응시할 수 없어요.',
        );
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
        test.starts_at.getTime() > Date.now()
          ? '아직 응시 기간이 아니에요.'
          : '응시 기간이 끝났어요.',
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
    const byProblem = new Map(
      statuses.map((status) => [status.problemId, status]),
    );
    const vibeTasks = (await this.vibeScores(test, [id])).get(id) ?? [];
    const total = test.problem_ids.length + test.vibe_challenge_ids.length;
    const solved = statuses.filter((status) => status.solved).length;
    return {
      ...toAttempt(attempt),
      test: toPublicTest(test),
      vibeTasks: vibeTasks.map((task) => ({
        ...task,
        score:
          attempt.closed && test.show_score_to_candidates ? task.score : null,
      })),
      // 담당자가 공개를 켠 테스트만, 응시가 끝난 뒤에 점수를 준다. 점수 계산은 results()와 같다.
      result:
        attempt.closed && test.show_score_to_candidates
          ? {
              solved,
              total,
              score: assessmentScore(
                solved,
                test.problem_ids.length,
                vibeTasks.map((task) => task.score),
              ),
            }
          : null,
      problems: problems.map((problem) => ({
        ...problem,
        solved: byProblem.get(problem.id)?.solved ?? false,
        lastSubmissionId: byProblem.get(problem.id)?.lastSubmissionId ?? null,
        lastStatus: byProblem.get(problem.id)?.lastStatus ?? null,
      })),
    };
  }

  async startVibe(id: string, challengeId: string, user: AuthenticatedUser) {
    return this.vibe.startEnterprise(id, challengeId, user.id);
  }
  async finish(id: string, user: AuthenticatedUser) {
    const row = await this.dataSource.transaction(async (manager) => {
      await this.ownAttempt(id, user, manager, true);
      const [[saved]]: [AttemptRow[], number] = await manager.query(
        'UPDATE enterprise_attempts SET finished_at=coalesce(finished_at,now()) WHERE id=$1 RETURNING *',
        [id],
      );
      return saved;
    });
    await this.vibe.finalizeExam(id, user.id);
    return toAttempt(row);
  }
  private async ownAttempt(
    id: string,
    user: AuthenticatedUser,
    manager = this.dataSource.manager,
    lock = false,
  ) {
    const [attempt]: (AttemptRow & { closed: boolean })[] = await manager.query(
      `SELECT a.*, LEAST(a.deadline_at,t.ends_at) AS deadline_at, (a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now()) AS closed
       FROM enterprise_attempts a JOIN enterprise_tests t ON t.id=a.test_id WHERE a.id=$1 AND a.user_id=$2 AND ${canJoin('$2')}${lock ? ' FOR UPDATE OF a' : ''}`,
      [id, user.id],
    );
    if (!attempt) throw new NotFoundException('응시 기록을 찾을 수 없습니다.');
    return attempt;
  }
  private async reviewContext(
    testId: string,
    attemptId: string,
    vibeId: string,
    user: AuthenticatedUser,
  ) {
    await this.owned(this.dataSource.manager, testId, user);
    const [row]: { user_id: string; username: string; closed: boolean }[] =
      await this.dataSource.query(
        `SELECT a.user_id,u.username,(a.finished_at IS NOT NULL OR LEAST(a.deadline_at,t.ends_at)<=now()) AS closed
       FROM enterprise_attempts a JOIN enterprise_tests t ON t.id=a.test_id JOIN users u ON u.id=a.user_id
       JOIN vibe_attempts v ON v.enterprise_attempt_id=a.id WHERE a.id=$1 AND a.test_id=$2 AND v.id=$3`,
        [attemptId, testId, vibeId],
      );
    if (!row) throw new NotFoundException('응시 과제를 찾을 수 없습니다.');
    return row;
  }
  async reviewVibe(
    testId: string,
    attemptId: string,
    vibeId: string,
    user: AuthenticatedUser,
  ) {
    const row = await this.reviewContext(testId, attemptId, vibeId, user);
    return {
      ...(await this.vibe.review(vibeId, row.user_id)),
      candidate: { id: row.user_id, username: row.username },
      canGrade: row.closed,
    };
  }
  async reviewRevision(
    testId: string,
    attemptId: string,
    vibeId: string,
    revision: number,
    user: AuthenticatedUser,
  ) {
    const row = await this.reviewContext(testId, attemptId, vibeId, user);
    return this.vibe.revision(vibeId, row.user_id, revision);
  }
  async gradeVibe(
    testId: string,
    attemptId: string,
    vibeId: string,
    user: AuthenticatedUser,
  ) {
    const row = await this.reviewContext(testId, attemptId, vibeId, user);
    if (!row.closed)
      throw new ConflictException(
        '응시가 끝난 뒤 저장본을 채점할 수 있습니다.',
      );
    await this.vibe.finalize(vibeId, row.user_id);
    return this.reviewVibe(testId, attemptId, vibeId, user);
  }
  private assertTasks(problems: string[], vibeIds: string[]) {
    if (
      problems.length + vibeIds.length < 1 ||
      problems.length + vibeIds.length > 20 ||
      vibeIds.some((id) => id !== challenge.id)
    )
      throw new BadRequestException(
        '일반 문제와 바이브코딩 과제를 합해 1~20개 선택해 주세요.',
      );
  }
  private async vibeScores(test: TestRow, attemptIds: string[]) {
    const rows: {
      id: string;
      enterprise_attempt_id: string;
      challenge_id: string;
      submitted_at: Date | null;
      report: VibeReport | null;
    }[] =
      attemptIds.length && test.vibe_challenge_ids.length
        ? await this.dataSource.query(
            "SELECT id,enterprise_attempt_id,challenge_id,submitted_at,state->'report' AS report FROM vibe_attempts WHERE enterprise_attempt_id=ANY($1::uuid[])",
            [attemptIds],
          )
        : [];
    return new Map(
      attemptIds.map((id) => [
        id,
        test.vibe_challenge_ids.map((challengeId) => {
          const row = rows.find(
            (row) =>
              row.enterprise_attempt_id === id &&
              row.challenge_id === challengeId,
          );
          const report = row?.report;
          const score = !row
            ? 0
            : report?.evaluationStatus === 'complete'
              ? report.outcome + report.prompt!.score + report.process!.score
              : null;
          return {
            challengeId,
            title: challenge.title,
            id: row?.id ?? null,
            submittedAt: row?.submitted_at ?? null,
            score,
            status: !row
              ? 'not_started'
              : !row.submitted_at
                ? 'working'
                : score === null
                  ? 'pending'
                  : 'complete',
          };
        }),
      ]),
    );
  }

  private async owned(
    manager: EntityManager,
    id: string,
    user: AuthenticatedUser,
    lock = false,
  ) {
    const [row]: TestRow[] = await manager.query(
      `SELECT ${TEST_COLUMNS} FROM enterprise_tests t WHERE t.id = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    // 남의 테스트는 존재 여부를 드러내지 않는다.
    if (!row || (row.owner_id !== user.id && user.role !== UserRole.ADMIN))
      throw new NotFoundException(NOT_FOUND);
    return row;
  }

  private async byCode(
    manager: EntityManager,
    code: string,
    user: AuthenticatedUser,
  ) {
    const [row]: (TestRow & { allowed: boolean })[] = await manager.query(
      `SELECT t.*, ${canJoin('$2')} AS allowed FROM enterprise_tests t WHERE t.invite_code = $1`,
      [code.slice(0, 32), user.id],
    );
    // 초대받지 않은 사람에게는 테스트가 있다는 것도 알리지 않는다.
    if (!row?.allowed)
      throw new NotFoundException(
        '응시 링크가 올바르지 않거나 삭제된 테스트예요.',
      );
    return row;
  }

  /** 초대 목록을 저장 형태로: 사용자 이름은 id로 바꾸고(없는 이름은 400), 이메일은 소문자로 둔다. */
  private async resolveInvitees(
    manager: EntityManager,
    inviteOnly: boolean,
    invitees: string[],
  ) {
    if (!inviteOnly) return { userIds: [] as string[], emails: [] as string[] };
    const names = new Map<string, string>();
    const emails = new Set<string>();
    for (const raw of invitees) {
      const value = raw.trim();
      if (value.includes('@')) emails.add(value.toLowerCase());
      else if (value) names.set(value.toLowerCase(), value);
    }
    if (!names.size && !emails.size)
      throw new BadRequestException('초대할 사람을 한 명 이상 적어 주세요.');
    const users: { id: string; name: string }[] = names.size
      ? await manager.query(
          'SELECT id, lower(username) AS name FROM users WHERE lower(username) = ANY($1::text[])',
          [[...names.keys()]],
        )
      : [];
    const found = new Set(users.map((item) => item.name));
    const missing = [...names]
      .filter(([key]) => !found.has(key))
      .map(([, value]) => value);
    if (missing.length)
      throw new BadRequestException(
        `없는 사용자 이름이 있어요: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` 외 ${missing.length - 10}명` : ''}`,
      );
    return { userIds: users.map((item) => item.id), emails: [...emails] };
  }

  private assertSchedule(
    startsAt: string,
    endsAt: string,
    durationMin: number,
    future: boolean,
  ) {
    const start = Date.parse(startsAt);
    const end = Date.parse(endsAt);
    if (!(end > start))
      throw new BadRequestException('종료 일시는 시작 일시보다 늦어야 해요.');
    if (future && end <= Date.now())
      throw new BadRequestException('종료 일시는 지금보다 이후여야 해요.');
    if (durationMin * 60_000 > end - start)
      throw new BadRequestException('제한 시간은 응시 기간보다 길 수 없어요.');
  }

  /** 출제 화면에서 고를 수 있는 문제만 허용: 공개 문제, 내가 만든 문제(기업 전용 포함), 관리자는 전부. */
  private async assertProblems(
    manager: EntityManager,
    ids: string[],
    user: AuthenticatedUser,
  ) {
    const [{ count }]: { count: number }[] = await manager.query(
      `SELECT count(*)::int AS count FROM problems
        WHERE id = ANY($1::uuid[]) AND (status = 'PUBLISHED' OR author_id = $2 OR $3)`,
      [ids, user.id, user.role === UserRole.ADMIN],
    );
    if (count !== ids.length)
      throw new BadRequestException(
        '출제할 수 없는 문제가 포함되어 있어요. 문제 목록을 다시 확인해 주세요.',
      );
  }
}

export function assessmentScore(
  solved: number,
  problemCount: number,
  vibeScores: (number | null)[],
) {
  if (vibeScores.some((score) => score === null)) return null;
  return Math.round(
    (solved * 100 +
      vibeScores.reduce<number>((sum, score) => sum + score!, 0)) /
      (problemCount + vibeScores.length),
  );
}
