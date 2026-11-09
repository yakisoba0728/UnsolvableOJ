import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { isUniqueViolation, recordAudit } from '../../common/database.js';
import { createListCursor, readListCursor } from '../../common/list-cursor.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import type { CreateProblemDto } from './dto/create-problem.dto.js';
import type { UpdateProblemDto } from './dto/update-problem.dto.js';
import type { ListProblemsQuery } from './dto/list-problems.query.js';
import { Problem } from './problem.entity.js';
import { ProblemDifficulty, ProblemStatus } from './problem.enums.js';
import { TestCase } from './test-case.entity.js';

const DRAFT_LIMIT = 50;
// 출제는 누구나 하므로 제출 하나가 채점기를 잡는 최악의 시간(시간 제한 × 테스트 수)을 묶는다(관리자 제외).
export const JUDGE_BUDGET_MS = 120_000;
const PRIVATE_PUBLISH_MESSAGE =
  '기업 전용 문제는 공개할 수 없습니다. 공개하려면 먼저 기업 전용을 해제하세요.';

@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateProblemDto, user: AuthenticatedUser) {
    this.assertJudgeBudget(dto.timeLimitMs, dto.testCases.length, user);
    if (
      dto.status === ProblemStatus.PUBLISHED &&
      user.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('문제 공개는 관리자 검수가 필요합니다.');
    }
    if (dto.isPrivate && dto.status === ProblemStatus.PUBLISHED)
      throw new BadRequestException(PRIVATE_PUBLISH_MESSAGE);
    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.assertDraftRoom(manager, user);
        const problem = manager.create(Problem, {
          slug: dto.slug.toLowerCase(),
          title: dto.title,
          statementMarkdown: dto.statementMarkdown,
          inputDescriptionMarkdown: dto.inputDescriptionMarkdown,
          outputDescriptionMarkdown: dto.outputDescriptionMarkdown,
          editorialMarkdown: dto.editorialMarkdown,
          tags: dto.tags,
          difficulty: dto.difficulty,
          isPrivate: dto.isPrivate,
          status: dto.status,
          timeLimitMs: dto.timeLimitMs,
          memoryLimitMb: dto.memoryLimitMb,
          authorId: user.id,
          currentVersion: 1,
          testCases: dto.testCases.map((testCase, index) =>
            manager.create(TestCase, {
              input: testCase.input,
              expectedOutput: testCase.expectedOutput,
              isSample: testCase.isSample,
              score: testCase.score,
              order: index + 1,
            }),
          ),
        });
        const saved = await manager.save(problem);
        await manager.query(
          'INSERT INTO problem_versions (problem_id, version, snapshot) VALUES ($1, 1, $2::jsonb)',
          [saved.id, JSON.stringify(this.snapshot(saved))],
        );
        await recordAudit(
          manager,
          user.id,
          'problem.create',
          'problem',
          saved.id,
          { version: 1 },
        );
        return { ...this.toDetail(saved), isPrivate: saved.isPrivate };
      });
    } catch (error: unknown) {
      if (isUniqueViolation(error))
        throw new ConflictException('이미 사용 중인 문제 slug입니다.');
      throw error;
    }
  }

  async update(id: string, dto: UpdateProblemDto, user: AuthenticatedUser) {
    if (!Object.keys(dto).length)
      throw new BadRequestException('변경할 필드가 없습니다.');
    return this.dataSource.transaction(async (manager) => {
      const problem = await manager
        .getRepository(Problem)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
      this.assertOwner(problem, user);
      const fields = [
        'title',
        'statementMarkdown',
        'inputDescriptionMarkdown',
        'outputDescriptionMarkdown',
        'editorialMarkdown',
        'tags',
        'difficulty',
        'timeLimitMs',
        'memoryLimitMb',
      ] as const;
      for (const field of fields)
        if (dto[field] !== undefined)
          Object.assign(problem, { [field]: dto[field] });
      if (dto.testCases) {
        await manager.delete(TestCase, { problemId: id });
        problem.testCases = dto.testCases.map((testCase, index) =>
          manager.create(TestCase, {
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
            isSample: testCase.isSample,
            score: testCase.score,
            problemId: id,
            order: index + 1,
          }),
        );
        await manager.save(problem.testCases);
      } else {
        problem.testCases = await manager.find(TestCase, {
          where: { problemId: id },
          order: { order: 'ASC' },
        });
      }
      this.assertJudgeBudget(problem.timeLimitMs, problem.testCases.length, user);
      if (dto.isPrivate !== undefined) problem.isPrivate = dto.isPrivate;
      if (
        problem.status === ProblemStatus.PUBLISHED &&
        (user.role !== UserRole.ADMIN || problem.isPrivate)
      ) {
        problem.status = ProblemStatus.DRAFT;
      }
      problem.currentVersion += 1;
      await manager.save(problem);
      await manager.query(
        'INSERT INTO problem_versions (problem_id, version, snapshot) VALUES ($1, $2, $3::jsonb)',
        [id, problem.currentVersion, JSON.stringify(this.snapshot(problem))],
      );
      await recordAudit(manager, user.id, 'problem.update', 'problem', id, {
        version: problem.currentVersion,
        status: problem.status,
      });
      return this.toManagement(problem);
    });
  }

  async changeStatus(
    id: string,
    status: ProblemStatus,
    user: AuthenticatedUser,
  ) {
    if (status === ProblemStatus.PUBLISHED && user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('문제 공개는 관리자 검수가 필요합니다.');
    }
    return this.dataSource.transaction(async (manager) => {
      const problem = await manager
        .getRepository(Problem)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
      this.assertOwner(problem, user);
      if (problem.isPrivate && status === ProblemStatus.PUBLISHED)
        throw new BadRequestException(PRIVATE_PUBLISH_MESSAGE);
      const oldStatus = problem.status;
      // 보관했다가 되살려 초안 상한을 넘기지 못하게 한다.
      if (status === ProblemStatus.DRAFT && oldStatus !== ProblemStatus.DRAFT)
        await this.assertDraftRoom(manager, user);
      problem.status = status;
      await manager.save(problem);
      await recordAudit(manager, user.id, 'problem.status', 'problem', id, {
        from: oldStatus,
        to: status,
      });
      return { id, status, currentVersion: problem.currentVersion };
    });
  }

  /**
   * 공개 문제 목록: 검색어·난이도·태그·내 풀이 상태로 거르고 정렬한 한 쪽과 칩별 개수(facets)를 돌려준다.
   * 기본 정렬(최신순)은 커서로 이어 읽을 수 있고, 다른 정렬은 쪽 번호로 읽는다(nextCursor 없음).
   */
  async findAll(query: ListProblemsQuery, viewer?: AuthenticatedUser) {
    const sort = query.sort ?? 'latest';
    const reverse = query.reverse === 'true';
    const keyset = sort === 'latest' && !reverse;
    if (query.cursor && !keyset)
      throw new BadRequestException('목록 커서는 최신순에서만 쓸 수 있습니다.');
    const cursor = readListCursor(query.cursor);
    if (query.solve?.length && !viewer)
      throw new UnauthorizedException('풀이 상태로 거르려면 로그인이 필요합니다.');

    // 기업 전용 문제는 공개로 바꿀 수 없지만 목록에서도 한 번 더 막는다.
    const visible = "p.status = 'PUBLISHED' AND NOT p.is_private";
    const keyword = query.q?.trim();
    // 내 풀이 상태: 해결(정답 있음)·풀이 중(제출만 있음)·미해결. 웹의 제출 기록처럼 검증용 제출은 뺀다.
    const state = viewer
      ? "CASE WHEN mine.solved THEN 'solved' WHEN mine.problem_id IS NOT NULL THEN 'attempted' ELSE 'none' END"
      : "'none'";
    // PostgreSQL은 SQL에 쓰이지 않은 매개변수를 거절하므로, 조건을 쓸 때만 값을 더한다(쿼리마다 새로).
    const scope = () => {
      const params: unknown[] = [];
      const add = (value: unknown) => `$${params.push(value)}`;
      const mine = viewer
        ? `LEFT JOIN (SELECT problem_id, bool_or(status = 'ACCEPTED') AS solved
             FROM submissions WHERE user_id = ${add(viewer.id)} AND NOT is_test
             GROUP BY problem_id) mine ON mine.problem_id = p.id`
        : '';
      const search = () => {
        if (!keyword) return 'TRUE';
        const pattern = add(`%${keyword.replace(/[\\%_]/g, '\\$&')}%`);
        return `(p.title ILIKE ${pattern} ESCAPE '\\' OR p.slug ILIKE ${pattern} ESCAPE '\\')`;
      };
      return {
        params,
        add,
        from: `FROM problems p ${mine}`,
        search,
        tag: () => (query.tag ? `${add(query.tag)} = ANY(p.tags)` : 'TRUE'),
        difficulty: () =>
          query.difficulty?.length
            ? `p.difficulty = ANY(${add(query.difficulty)}::problem_difficulty[])`
            : 'TRUE',
        solve: () =>
          query.solve?.length ? `${state} = ANY(${add(query.solve)}::text[])` : 'TRUE',
      };
    };

    // 칩의 숫자는 그 칩을 눌렀을 때의 결과 수다: 같은 묶음(난이도·상태·태그)의 조건만 빼고 센다.
    const groupScope = scope();
    const tagScope = scope();
    const [groups, tagRows] = await Promise.all([
      this.dataSource.query<
        { difficulty: ProblemDifficulty; state: string; count: number }[]
      >(
        `SELECT p.difficulty, ${state} AS state, count(*)::int AS count
         ${groupScope.from}
         WHERE ${visible} AND ${groupScope.search()} AND ${groupScope.tag()}
         GROUP BY 1, 2`,
        groupScope.params,
      ),
      // 태그 목록은 공개 문제 전체에서 모으고 숫자에만 다른 조건을 적용한다(0개인 태그도 고를 수 있다).
      // shortcut: 많이 쓰인 200개만 돌려준다. 태그가 더 많아지면 태그 검색으로 바꾼다.
      this.dataSource.query<{ tag: string; count: number }[]>(
        `SELECT t AS tag, count(*) FILTER (WHERE ${tagScope.search()} AND ${tagScope.difficulty()} AND ${tagScope.solve()})::int AS count
         ${tagScope.from} CROSS JOIN unnest(p.tags) t
         WHERE ${visible}
         GROUP BY t ORDER BY count DESC, t LIMIT 200`,
        tagScope.params,
      ),
    ]);
    const difficultyOk = (value: ProblemDifficulty) =>
      !query.difficulty?.length || query.difficulty.includes(value);
    const solveOk = (value: string) =>
      !query.solve?.length || (query.solve as string[]).includes(value);
    const sum = (rows: typeof groups) =>
      rows.reduce((total, row) => total + row.count, 0);
    const facets = {
      difficulties: Object.fromEntries(
        ['', ...Object.values(ProblemDifficulty)].map((value) => [
          value,
          sum(
            groups.filter(
              (g) => (!value || g.difficulty === value) && solveOk(g.state),
            ),
          ),
        ]),
      ),
      // 비로그인에는 풀이 상태가 없다.
      solves: viewer
        ? Object.fromEntries(
            ['', 'none', 'attempted', 'solved'].map((value) => [
              value,
              sum(
                groups.filter(
                  (g) => (!value || g.state === value) && difficultyOk(g.difficulty),
                ),
              ),
            ]),
          )
        : null,
      tags: tagRows,
    };
    const total = sum(
      groups.filter((g) => difficultyOk(g.difficulty) && solveOk(g.state)),
    );

    const items = scope();
    const conditions = [
      visible,
      items.search(),
      items.tag(),
      items.difficulty(),
      items.solve(),
    ];
    if (cursor)
      conditions.push(
        `(p.created_at, p.id) < (${items.add(cursor.createdAt)}::timestamptz, ${items.add(cursor.id)}::uuid)`,
      );
    // 기본 방향: 최신순·푼 사람순·정답률순은 큰 값부터, 난이도순·제목순은 작은 값부터.
    const high = reverse ? 'ASC' : 'DESC';
    const low = reverse ? 'DESC' : 'ASC';
    const ties = 'p.created_at DESC, p.id DESC';
    const order =
      sort === 'random'
        ? `md5(p.id::text || ${items.add(String(query.seed ?? 1))}), p.id`
        : {
            latest: `p.created_at ${high}, p.id ${high}`,
            difficulty: `p.difficulty ${low}, ${ties}`,
            // DB 기본 정렬 규칙(collation)은 서버마다 달라 순서가 바뀐다. 대소문자를 무시한 코드포인트 순으로 고정한다.
            title: `lower(p.title) COLLATE "C" ${low}, p.title COLLATE "C" ${low}, ${ties}`,
            solvers: `COALESCE(stats.solver_count, 0) ${high}, ${ties}`,
            // 정답률이 없는(제출 없는) 문제는 뒤집어도 맨 뒤다.
            rate: `ROUND(100.0 * stats.accepted_count / NULLIF(stats.finished_count, 0), 1) ${high} NULLS LAST, ${ties}`,
          }[sort];
    // 문제별 집계는 제출 트리거가 problem_stats에 미리 센다(마이그레이션 1795200000000).
    const stats =
      sort === 'solvers' || sort === 'rate'
        ? 'LEFT JOIN problem_stats stats ON stats.problem_id = p.id'
        : '';
    const rows = await this.dataSource.query<
      {
        id: string;
        slug: string;
        title: string;
        difficulty: ProblemDifficulty;
        tags: string[];
        timeLimitMs: number;
        memoryLimitMb: number;
        currentVersion: number;
        createdAt: Date;
      }[]
    >(
      `SELECT p.id, p.slug, p.title, p.difficulty, p.tags,
         p.time_limit_ms AS "timeLimitMs", p.memory_limit_mb AS "memoryLimitMb",
         p.current_version AS "currentVersion", p.created_at AS "createdAt"
       ${items.from} ${stats}
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${order}
       LIMIT ${items.add(query.limit + 1)} OFFSET ${items.add(cursor ? 0 : (query.page - 1) * query.limit)}`,
      items.params,
    );
    const page = rows.slice(0, query.limit);
    return {
      items: await this.withStats(this.dataSource, page),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      facets,
      // 최신순이 아니면 커서를 주지 않는다(null은 '끝'이라는 뜻이라 쪽 번호로 읽게 비워 둔다).
      ...(keyset && {
        nextCursor:
          rows.length > query.limit
            ? await createListCursor(this.dataSource, 'problems', page.at(-1)!.id)
            : null,
      }),
    };
  }

  // 쪽마다 미리 센 통계를 한 번에 읽는다. 행이 없거나 끝난 제출이 없으면 정답률은 null이다.
  private async withStats<T extends { id: string }>(
    db: Pick<EntityManager, 'query'>,
    problems: T[],
  ) {
    const stats = problems.length
      ? await db.query<
          { problemId: string; solverCount: number; acceptanceRate: number | null }[]
        >(
          `SELECT problem_id AS "problemId", solver_count AS "solverCount",
             ROUND(100.0 * accepted_count / NULLIF(finished_count, 0), 1)::float8 AS "acceptanceRate"
           FROM problem_stats WHERE problem_id = ANY($1::uuid[])`,
          [problems.map((problem) => problem.id)],
        )
      : [];
    const byProblem = new Map(stats.map((item) => [item.problemId, item]));
    return problems.map((problem) =>
      Object.assign(problem, {
        solverCount: byProblem.get(problem.id)?.solverCount ?? 0,
        acceptanceRate: byProblem.get(problem.id)?.acceptanceRate ?? null,
      }),
    );
  }

  async findMine(user: AuthenticatedUser) {
    const where = user.role === UserRole.ADMIN ? {} : { authorId: user.id };
    return this.problems.find({
      where,
      select: {
        id: true,
        slug: true,
        title: true,
        status: true,
        isPrivate: true,
        difficulty: true,
        timeLimitMs: true,
        memoryLimitMb: true,
        currentVersion: true,
        updatedAt: true,
      },
      order: { updatedAt: 'DESC' },
      take: 100,
    });
  }

  async findForManagement(id: string, user: AuthenticatedUser) {
    const problem = await this.problems.findOne({
      where: { id },
      relations: { testCases: true },
      order: { testCases: { order: 'ASC' } },
    });
    if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
    this.assertOwner(problem, user);
    return this.toManagement(problem);
  }

  async findPublishedBySlug(slug: string) {
    // Same character boundary as IsPostgresText, without narrowing legacy slug formats.
    if (/[\0\p{Cs}]/u.test(slug))
      throw new BadRequestException(
        'slug에는 NUL 문자나 짝이 맞지 않는 서로게이트 문자를 쓸 수 없습니다.',
      );
    return this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const problem = await manager.findOneBy(Problem, {
        slug: slug.toLowerCase(),
        status: ProblemStatus.PUBLISHED,
      });
      if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
      // Read body and samples from one snapshot; never load large hidden cases.
      problem.testCases = await manager.find(TestCase, {
        where: { problemId: problem.id, isSample: true },
        order: { order: 'ASC' },
      });
      const [detail] = await this.withStats(manager, [this.toDetail(problem)]);
      return detail;
    });
  }

  /** 검수 대기(초안)가 무한히 쌓이지 않게 한다. 보관한 문제는 세지 않으므로 보관이 정리 수단이다. */
  private async assertDraftRoom(manager: EntityManager, user: AuthenticatedUser) {
    if (user.role === UserRole.ADMIN) return;
    // 같은 계정의 동시 생성·전환을 직렬화한다.
    await manager.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    const [{ count }]: { count: number }[] = await manager.query(
      "SELECT count(*)::int AS count FROM problems WHERE author_id = $1 AND status = 'DRAFT'",
      [user.id],
    );
    if (count >= DRAFT_LIMIT)
      throw new ConflictException(
        `초안(기업 전용 포함)은 ${DRAFT_LIMIT}개까지 둘 수 있어요. 쓰지 않는 문제는 보관해 주세요.`,
      );
  }

  private assertJudgeBudget(timeLimitMs: number, testCount: number, user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN && timeLimitMs * testCount > JUDGE_BUDGET_MS)
      throw new BadRequestException(
        `시간 제한 × 테스트 개수는 ${JUDGE_BUDGET_MS / 1000}초를 넘을 수 없어요. 시간 제한을 줄이거나 테스트를 합쳐 주세요.`,
      );
  }

  private assertOwner(problem: Problem, user: AuthenticatedUser) {
    if (user.role !== UserRole.ADMIN && problem.authorId !== user.id)
      throw new ForbiddenException('이 문제의 관리 권한이 없습니다.');
  }

  private snapshot(problem: Problem) {
    return {
      title: problem.title,
      statementMarkdown: problem.statementMarkdown,
      inputDescriptionMarkdown: problem.inputDescriptionMarkdown,
      outputDescriptionMarkdown: problem.outputDescriptionMarkdown,
      editorialMarkdown: problem.editorialMarkdown,
      tags: problem.tags,
      difficulty: problem.difficulty,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      testCases: (problem.testCases ?? []).map((testCase) => ({
        id: testCase.id,
        input: testCase.input,
        expectedOutput: testCase.expectedOutput,
        isSample: testCase.isSample,
        score: testCase.score,
        order: testCase.order,
      })),
    };
  }

  private toDetail(problem: Problem) {
    return {
      id: problem.id,
      slug: problem.slug,
      title: problem.title,
      statementMarkdown: problem.statementMarkdown,
      inputDescriptionMarkdown: problem.inputDescriptionMarkdown,
      outputDescriptionMarkdown: problem.outputDescriptionMarkdown,
      editorialMarkdown: problem.editorialMarkdown,
      tags: problem.tags,
      difficulty: problem.difficulty,
      status: problem.status,
      timeLimitMs: problem.timeLimitMs,
      memoryLimitMb: problem.memoryLimitMb,
      currentVersion: problem.currentVersion,
      samples: (problem.testCases ?? [])
        .filter((testCase) => testCase.isSample)
        .map(({ input, expectedOutput }) => ({ input, expectedOutput })),
      createdAt: problem.createdAt,
      updatedAt: problem.updatedAt,
    };
  }

  private toManagement(problem: Problem) {
    return {
      ...this.toDetail(problem),
      isPrivate: problem.isPrivate,
      testCases: this.snapshot(problem).testCases,
    };
  }
}
