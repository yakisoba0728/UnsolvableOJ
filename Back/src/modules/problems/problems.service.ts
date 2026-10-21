import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type FindOptionsWhere } from 'typeorm';
import { findListPage } from '../../common/list-cursor.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { UserRole } from '../users/user-role.enum.js';
import type { CreateProblemDto } from './dto/create-problem.dto.js';
import type { UpdateProblemDto } from './dto/update-problem.dto.js';
import type { ListProblemsQuery } from './dto/list-problems.query.js';
import { Problem } from './problem.entity.js';
import { ProblemStatus } from './problem.enums.js';
import { TestCase } from './test-case.entity.js';

@Injectable()
export class ProblemsService {
  constructor(
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateProblemDto, user: AuthenticatedUser) {
    if (
      dto.status === ProblemStatus.PUBLISHED &&
      user.role !== UserRole.ADMIN
    ) {
      throw new ForbiddenException('문제 공개는 관리자 검수가 필요합니다.');
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const problem = manager.create(Problem, {
          slug: dto.slug.toLowerCase(),
          title: dto.title,
          statementMarkdown: dto.statementMarkdown,
          inputDescriptionMarkdown: dto.inputDescriptionMarkdown,
          outputDescriptionMarkdown: dto.outputDescriptionMarkdown,
          difficulty: dto.difficulty,
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
        await this.audit(manager, user.id, 'problem.create', saved.id, {
          version: 1,
        });
        return this.toDetail(saved);
      });
    } catch (error: unknown) {
      if (this.isUniqueViolation(error))
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
      if (
        user.role !== UserRole.ADMIN &&
        problem.status === ProblemStatus.PUBLISHED
      ) {
        problem.status = ProblemStatus.DRAFT;
      }
      problem.currentVersion += 1;
      await manager.save(problem);
      await manager.query(
        'INSERT INTO problem_versions (problem_id, version, snapshot) VALUES ($1, $2, $3::jsonb)',
        [id, problem.currentVersion, JSON.stringify(this.snapshot(problem))],
      );
      await this.audit(manager, user.id, 'problem.update', id, {
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
      const oldStatus = problem.status;
      problem.status = status;
      await manager.save(problem);
      await this.audit(manager, user.id, 'problem.status', id, {
        from: oldStatus,
        to: status,
      });
      return { id, status, currentVersion: problem.currentVersion };
    });
  }

  async findAll(query: ListProblemsQuery) {
    const where: FindOptionsWhere<Problem> = {
      status: ProblemStatus.PUBLISHED,
    };
    if (query.difficulty) where.difficulty = query.difficulty;
    const page = await findListPage(
      this.problems,
      this.dataSource,
      'problems',
      query,
      where,
      {
        select: {
          id: true,
          slug: true,
          title: true,
          difficulty: true,
          timeLimitMs: true,
          memoryLimitMb: true,
          currentVersion: true,
          createdAt: true,
        },
      },
    );
    // One indexed aggregate per page, not one submissions query per problem.
    const stats = page.items.length
      ? await this.dataSource.query<
          { problemId: string; solverCount: number; acceptanceRate: number }[]
        >(
          `SELECT problem_id AS "problemId",
             COUNT(DISTINCT user_id) FILTER (WHERE status = 'ACCEPTED')::int AS "solverCount",
             ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'ACCEPTED') / COUNT(*), 1)::float8 AS "acceptanceRate"
           FROM submissions
           WHERE problem_id = ANY($1::uuid[])
             AND status NOT IN ('QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED')
           GROUP BY problem_id`,
          [page.items.map((problem) => problem.id)],
        )
      : [];
    const byProblem = new Map(stats.map((item) => [item.problemId, item]));
    return {
      ...page,
      items: page.items.map((problem) =>
        Object.assign(problem, {
          solverCount: byProblem.get(problem.id)?.solverCount ?? 0,
          acceptanceRate: byProblem.get(problem.id)?.acceptanceRate ?? null,
        }),
      ),
    };
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
        difficulty: true,
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
    const problem = await this.problems.findOneBy({
      slug: slug.toLowerCase(),
      status: ProblemStatus.PUBLISHED,
    });
    if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
    // Hidden cases can be megabytes each; the public view needs samples only.
    problem.testCases = await this.dataSource.manager.find(TestCase, {
      where: { problemId: problem.id, isSample: true },
      order: { order: 'ASC' },
    });
    return this.toDetail(problem);
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
      testCases: this.snapshot(problem).testCases,
    };
  }

  private audit(
    manager: DataSource['manager'],
    actorId: string,
    action: string,
    targetId: string,
    details: object,
  ) {
    return manager.query(
      'INSERT INTO audit_events (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [actorId, action, 'problem', targetId, JSON.stringify(details)],
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === '23505'
    );
  }
}
