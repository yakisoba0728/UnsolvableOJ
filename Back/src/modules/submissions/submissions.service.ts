import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import {
  DataSource,
  LessThan,
  Raw,
  Repository,
  type FindOptionsWhere,
} from 'typeorm';
import { createListCursor, readListCursor } from '../../common/list-cursor.js';
import {
  JUDGE_QUEUE,
  type JudgeSubmissionJob,
} from '../../common/queue.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Problem } from '../problems/problem.entity.js';
import { ProblemDifficulty, ProblemStatus } from '../problems/problem.enums.js';
import { UserRole } from '../users/user-role.enum.js';
import type { CreateSubmissionDto } from './dto/create-submission.dto.js';
import type { JudgeResultDto } from './dto/judge-result.dto.js';
import type { ListSubmissionsQuery } from './dto/list-submissions.query.js';
import { Submission } from './submission.entity.js';
import { SubmissionStatus } from './submission.enums.js';

const LEASE_MS = 60_000;
const XP: Record<ProblemDifficulty, number> = {
  BEGINNER: 10,
  EASY: 20,
  MEDIUM: 40,
  HARD: 80,
  EXPERT: 160,
};
const FINAL_STATUSES = new Set<SubmissionStatus>([
  SubmissionStatus.ACCEPTED,
  SubmissionStatus.WRONG_ANSWER,
  SubmissionStatus.TIME_LIMIT_EXCEEDED,
  SubmissionStatus.MEMORY_LIMIT_EXCEEDED,
  SubmissionStatus.RUNTIME_ERROR,
  SubmissionStatus.COMPILE_ERROR,
  SubmissionStatus.OUTPUT_LIMIT_EXCEEDED,
  SubmissionStatus.SYSTEM_ERROR,
  SubmissionStatus.CANCELLED,
]);
const REJECTED_STATUSES = new Set<SubmissionStatus>([
  SubmissionStatus.WRONG_ANSWER,
  SubmissionStatus.TIME_LIMIT_EXCEEDED,
  SubmissionStatus.MEMORY_LIMIT_EXCEEDED,
  SubmissionStatus.RUNTIME_ERROR,
  SubmissionStatus.COMPILE_ERROR,
  SubmissionStatus.OUTPUT_LIMIT_EXCEEDED,
]);
interface ProblemSnapshot {
  difficulty: ProblemDifficulty;
  timeLimitMs: number;
  memoryLimitMb: number;
  testCases: {
    id: string;
    input: string;
    expectedOutput: string;
    isSample?: boolean;
    score: number;
    order: number;
  }[];
}

@Injectable()
export class SubmissionsService {
  private recoveryTimer?: NodeJS.Timeout;
  constructor(
    @InjectRepository(Submission)
    private readonly submissions: Repository<Submission>,
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(JUDGE_QUEUE)
    private readonly judgeQueue: Queue<JudgeSubmissionJob>,
  ) {}

  onModuleInit() {
    this.recoveryTimer = setInterval(() => {
      void this.requeueMissingJobs().catch((error) =>
        console.error('Judge queue recovery failed:', error),
      );
    }, 30_000);
    this.recoveryTimer.unref();
  }
  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  async create(
    problemId: string,
    dto: CreateSubmissionDto,
    user: AuthenticatedUser,
  ) {
    const problem = await this.problems.findOneBy({
      id: problemId,
      status: ProblemStatus.PUBLISHED,
    });
    if (!problem)
      throw new NotFoundException('제출할 문제를 찾을 수 없습니다.');
    const submission = await this.submissions.save(
      this.submissions.create({
        problemId,
        userId: user.id,
        language: dto.language,
        sourceCode: dto.sourceCode,
        problemVersion: problem.currentVersion,
        judgeGeneration: 1,
        status: SubmissionStatus.QUEUED,
      }),
    );
    try {
      await this.enqueue(submission.id, 1);
    } catch {
      await this.submissions.update(
        {
          id: submission.id,
          judgeGeneration: 1,
          status: SubmissionStatus.QUEUED,
        },
        {
          status: SubmissionStatus.SYSTEM_ERROR,
          judgeMessage: '채점 큐에 연결할 수 없습니다.',
        },
      );
      throw new ServiceUnavailableException('채점 요청을 등록할 수 없습니다.');
    }
    return this.toResponse(submission);
  }

  async findMine(user: AuthenticatedUser, query: ListSubmissionsQuery) {
    const where: FindOptionsWhere<Submission> = { userId: user.id };
    if (query.problemId) where.problemId = query.problemId;
    const cursor = readListCursor(query.cursor);
    const pageWhere = cursor
      ? [
          {
            ...where,
            createdAt: Raw((alias) => `${alias} < :cursorTime::timestamptz`, {
              cursorTime: cursor.createdAt,
            }),
          },
          {
            ...where,
            createdAt: Raw((alias) => `${alias} = :cursorTime::timestamptz`, {
              cursorTime: cursor.createdAt,
            }),
            id: LessThan(cursor.id),
          },
        ]
      : where;
    const [rows, total] = await Promise.all([
      this.submissions.find({
        where: pageWhere,
        relations: { problem: true },
        // Lists must not load large source files or debug output into memory.
        select: {
          id: true,
          problemId: true,
          language: true,
          status: true,
          problemVersion: true,
          judgeGeneration: true,
          runtimeMs: true,
          memoryKb: true,
          passedTestCases: true,
          totalTestCases: true,
          compileOutput: true,
          judgeMessage: true,
          createdAt: true,
          updatedAt: true,
          problem: { id: true, slug: true, title: true },
        },
        order: { createdAt: 'DESC', id: 'DESC' },
        skip: cursor ? 0 : (query.page - 1) * query.limit,
        take: query.limit + 1,
      }),
      this.submissions.count({ where }),
    ]);
    const items = rows.slice(0, query.limit);
    const nextCursor =
      rows.length > query.limit
        ? await createListCursor(this.dataSource, 'submissions', items.at(-1)!.id)
        : null;
    return {
      items: items.map((item) => this.toResponse(item)),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      nextCursor,
    };
  }
  async findMineById(id: string, user: AuthenticatedUser) {
    const submission = await this.submissions.findOne({
      where: { id, userId: user.id },
      relations: { problem: true },
    });
    if (!submission) throw new NotFoundException('제출을 찾을 수 없습니다.');
    const sampleTestCases: {
      testCase: number;
      input: string;
      expectedOutput: string;
    }[] = [];
    if (submission.debugOutputs?.length) {
      const rows: { snapshot: ProblemSnapshot }[] = await this.dataSource.query(
        'SELECT snapshot FROM problem_versions WHERE problem_id = $1 AND version = $2',
        [submission.problemId, submission.problemVersion],
      );
      const visible = new Set(
        submission.debugOutputs.map((item) => item.testCase),
      );
      const cases = [...(rows[0]?.snapshot.testCases ?? [])].sort(
        (left, right) => left.order - right.order,
      );
      cases.forEach((testCase, index) => {
        // Use the original case number, never the current problem's samples.
        if (testCase.isSample === true && visible.has(index + 1)) {
          sampleTestCases.push({
            testCase: index + 1,
            input: testCase.input,
            expectedOutput: testCase.expectedOutput,
          });
        }
      });
    }
    return { ...this.toResponse(submission, true), sampleTestCases };
  }

  async rejudge(id: string, user: AuthenticatedUser) {
    const submission = await this.dataSource.transaction(async (manager) => {
      const current = await manager
        .getRepository(Submission)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!current) throw new NotFoundException('제출을 찾을 수 없습니다.');
      const problem = await manager.findOneByOrFail(Problem, {
        id: current.problemId,
      });
      if (
        user.role !== UserRole.ADMIN &&
        (user.role !== UserRole.AUTHOR || problem.authorId !== user.id)
      )
        throw new ForbiddenException('재채점 권한이 없습니다.');
      current.judgeGeneration += 1;
      current.judgeAttemptId = null;
      current.judgeLeaseExpiresAt = null;
      if (current.status === SubmissionStatus.ACCEPTED)
        current.acceptedForXp = true;
      current.status = SubmissionStatus.QUEUED;
      current.runtimeMs = null;
      current.memoryKb = null;
      current.passedTestCases = 0;
      current.totalTestCases = 0;
      current.compileOutput = null;
      current.debugOutputs = [];
      current.judgeMessage = null;
      await manager.save(current);
      await manager.query(
        'INSERT INTO audit_events (actor_id, action, target_type, target_id, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
        [
          user.id,
          'submission.rejudge',
          'submission',
          id,
          JSON.stringify({ generation: current.judgeGeneration }),
        ],
      );
      return current;
    });
    try {
      await this.enqueue(id, submission.judgeGeneration);
    } catch {
      throw new ServiceUnavailableException(
        '재채점 큐 등록에 실패했습니다. 복구 작업이 다시 시도합니다.',
      );
    }
    return this.toResponse(submission);
  }

  async claimForJudge(id: string, generation: number, attemptId: string) {
    this.validateAttempt(generation, attemptId);
    return this.dataSource.transaction(async (manager) => {
      const submission = await manager
        .getRepository(Submission)
        .findOne({ where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!submission) throw new NotFoundException('제출을 찾을 수 없습니다.');
      if (
        submission.judgeGeneration !== generation ||
        FINAL_STATUSES.has(submission.status)
      )
        throw new ConflictException(
          '종료되었거나 이전 세대의 채점 작업입니다.',
        );
      if (
        submission.status === SubmissionStatus.JUDGING &&
        submission.judgeAttemptId !== attemptId &&
        submission.judgeLeaseExpiresAt &&
        submission.judgeLeaseExpiresAt > new Date()
      )
        throw new ConflictException('다른 워커가 채점 중입니다.');
      submission.status = SubmissionStatus.JUDGING;
      submission.judgeAttemptId = attemptId;
      submission.judgeLeaseExpiresAt = new Date(Date.now() + LEASE_MS);
      await manager.save(submission);
      const rows: { snapshot: ProblemSnapshot }[] = await manager.query(
        'SELECT snapshot FROM problem_versions WHERE problem_id = $1 AND version = $2',
        [submission.problemId, submission.problemVersion],
      );
      if (!rows[0])
        throw new NotFoundException('문제 버전을 찾을 수 없습니다.');
      const snapshot = rows[0].snapshot;
      return {
        submissionId: id,
        generation,
        attemptId,
        language: submission.language,
        sourceCode: submission.sourceCode,
        limits: {
          timeMs: snapshot.timeLimitMs,
          memoryMb: snapshot.memoryLimitMb,
        },
        testCases: [...snapshot.testCases]
          .sort((a, b) => a.order - b.order)
          .map(({ id: caseId, input, expectedOutput, score, isSample }) => ({
            id: caseId,
            input,
            expectedOutput,
            isSample: isSample === true,
            score,
          })),
      };
    });
  }

  async renewLease(id: string, generation: number, attemptId: string) {
    this.validateAttempt(generation, attemptId);
    const updated = await this.submissions
      .createQueryBuilder()
      .update()
      .set({ judgeLeaseExpiresAt: new Date(Date.now() + LEASE_MS) })
      .where(
        'id = :id AND judge_generation = :generation AND judge_attempt_id = :attemptId AND status = :status',
        { id, generation, attemptId, status: SubmissionStatus.JUDGING },
      )
      .execute();
    if (updated.affected !== 1)
      throw new ConflictException('채점 권한이 만료되었습니다.');
    return { leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
  }

  async recordJudgeResult(
    id: string,
    generation: number,
    attemptId: string,
    dto: JudgeResultDto,
  ) {
    this.validateAttempt(generation, attemptId);
    if (!FINAL_STATUSES.has(dto.status))
      throw new ConflictException('최종 판정 상태만 기록할 수 있습니다.');
    if (dto.passedTestCases > dto.totalTestCases)
      throw new BadRequestException(
        '통과한 테스트 수가 전체 테스트 수보다 많습니다.',
      );
    return this.dataSource.transaction(async (manager) => {
      // Serialize result/claim writes without blocking solve foreign-key checks.
      const submission = await manager
        .getRepository(Submission)
        .findOne({ where: { id }, lock: { mode: 'for_no_key_update' } });
      if (!submission) throw new NotFoundException('제출을 찾을 수 없습니다.');
      if (
        submission.judgeGeneration !== generation ||
        submission.judgeAttemptId !== attemptId
      )
        throw new ConflictException('이전 채점 시도의 결과입니다.');
      if (FINAL_STATUSES.has(submission.status)) {
        if (submission.status !== dto.status)
          throw new ConflictException('이미 다른 판정으로 종료된 제출입니다.');
        return this.toResponse(submission);
      }
      if (submission.status !== SubmissionStatus.JUDGING)
        throw new ConflictException('채점 중인 제출이 아닙니다.');
      if (dto.status === SubmissionStatus.ACCEPTED)
        submission.acceptedForXp = true;
      else if (REJECTED_STATUSES.has(dto.status))
        submission.acceptedForXp = false;
      submission.status = dto.status;
      submission.runtimeMs = dto.runtimeMs ?? null;
      submission.memoryKb = dto.memoryKb ?? null;
      submission.passedTestCases = dto.passedTestCases;
      submission.totalTestCases = dto.totalTestCases;
      submission.compileOutput =
        dto.compileOutput == null
          ? null
          : this.safeDiagnosticText(dto.compileOutput);
      submission.debugOutputs = (dto.debugOutputs ?? []).map((output) => ({
        ...output,
        stdout: this.safeDiagnosticText(output.stdout),
        stderr: this.safeDiagnosticText(output.stderr),
      }));
      submission.judgeMessage =
        dto.judgeMessage == null
          ? null
          : this.safeDiagnosticText(dto.judgeMessage);
      submission.judgeLeaseExpiresAt = null;
      await manager.save(submission);
      await this.reconcileSolve(manager, submission);
      return this.toResponse(submission);
    });
  }

  async heartbeat(workerId: string) {
    if (!isUUID(workerId))
      throw new BadRequestException('워커 ID가 올바르지 않습니다.');
    const client = await this.judgeQueue.getBackend().client;
    const now = Date.now();
    await client.hset('judge:workers', { [workerId]: now });
    const workers = await client.hgetall('judge:workers');
    const stale = Object.entries(workers)
      .filter(([, lastSeen]) => now - Number(lastSeen) > 60_000)
      .map(([id]) => id);
    if (stale.length) await client.hdel('judge:workers', ...stale);
    return { ok: true };
  }

  private async reconcileSolve(
    manager: DataSource['manager'],
    submission: Submission,
  ) {
    if (
      submission.status !== SubmissionStatus.ACCEPTED &&
      !REJECTED_STATUSES.has(submission.status)
    )
      return;
    const rows: { accepted_submission_id: string; awarded_xp: number }[] =
      await manager.query(
        'SELECT accepted_submission_id, awarded_xp FROM user_problem_solves WHERE user_id = $1 AND problem_id = $2 FOR UPDATE',
        [submission.userId, submission.problemId],
      );
    if (submission.status === SubmissionStatus.ACCEPTED) {
      if (rows.length) return;
      const versions: { snapshot: ProblemSnapshot }[] = await manager.query(
        'SELECT snapshot FROM problem_versions WHERE problem_id = $1 AND version = $2',
        [submission.problemId, submission.problemVersion],
      );
      const awarded =
        XP[versions[0]?.snapshot.difficulty ?? ProblemDifficulty.BEGINNER];
      const inserted: { user_id: string }[] = await manager.query(
        'INSERT INTO user_problem_solves (user_id, problem_id, accepted_submission_id, awarded_xp) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING user_id',
        [submission.userId, submission.problemId, submission.id, awarded],
      );
      if (inserted.length)
        await manager.query(
          'UPDATE users SET xp = xp + $1, level = 1 + (xp + $1) / 100, updated_at = now() WHERE id = $2',
          [awarded, submission.userId],
        );
      return;
    }
    if (rows[0]?.accepted_submission_id !== submission.id) return;
    const alternatives: { id: string }[] = await manager.query(
      "SELECT id FROM submissions WHERE user_id = $1 AND problem_id = $2 AND (accepted_for_xp = true OR status = 'ACCEPTED') ORDER BY created_at, id LIMIT 1",
      [submission.userId, submission.problemId],
    );
    if (alternatives[0])
      await manager.query(
        'UPDATE user_problem_solves SET accepted_submission_id = $1 WHERE user_id = $2 AND problem_id = $3',
        [alternatives[0].id, submission.userId, submission.problemId],
      );
    else {
      await manager.query(
        'DELETE FROM user_problem_solves WHERE user_id = $1 AND problem_id = $2',
        [submission.userId, submission.problemId],
      );
      await manager.query(
        'UPDATE users SET xp = GREATEST(0, xp - $1), level = 1 + GREATEST(0, xp - $1) / 100, updated_at = now() WHERE id = $2',
        [rows[0].awarded_xp, submission.userId],
      );
    }
  }

  private safeDiagnosticText(value: string) {
    // PostgreSQL text/jsonb reject NUL and unpaired UTF-16 surrogates.
    return Buffer.from(value, 'utf8').toString('utf8').replaceAll('\0', '\uFFFD');
  }

  private validateAttempt(generation: number, attemptId: string) {
    if (
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !isUUID(attemptId)
    ) {
      throw new BadRequestException('채점 시도 정보가 올바르지 않습니다.');
    }
  }

  private enqueue(submissionId: string, generation: number) {
    return this.judgeQueue.add(
      'judge-submission',
      { submissionId, generation },
      {
        jobId: `${submissionId}-${generation}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    );
  }

  private async requeueMissingJobs() {
    const queued = await this.submissions.find({
      where: {
        status: SubmissionStatus.QUEUED,
        updatedAt: LessThan(new Date(Date.now() - 10_000)),
      },
      take: 100,
      order: { updatedAt: 'ASC' },
    });
    for (const submission of queued) {
      const job = await this.judgeQueue.getJob(
        `${submission.id}-${submission.judgeGeneration}`,
      );
      if (!job) await this.enqueue(submission.id, submission.judgeGeneration);
      else if (['failed', 'completed'].includes(await job.getState()))
        await this.submissions.update(
          {
            id: submission.id,
            judgeGeneration: submission.judgeGeneration,
            status: SubmissionStatus.QUEUED,
          },
          {
            status: SubmissionStatus.SYSTEM_ERROR,
            judgeMessage: '채점 작업이 실패했습니다.',
          },
        );
    }
    const expired = await this.submissions.find({
      where: {
        status: SubmissionStatus.JUDGING,
        judgeLeaseExpiresAt: LessThan(new Date()),
      },
      take: 100,
    });
    for (const submission of expired) {
      const changed = await this.submissions
        .createQueryBuilder()
        .update()
        .set({
          status: SubmissionStatus.QUEUED,
          judgeGeneration: submission.judgeGeneration + 1,
          judgeAttemptId: null,
          judgeLeaseExpiresAt: null,
        })
        .where(
          'id = :id AND status = :status AND judge_generation = :generation AND judge_lease_expires_at < now()',
          {
            id: submission.id,
            status: SubmissionStatus.JUDGING,
            generation: submission.judgeGeneration,
          },
        )
        .execute();
      if (changed.affected)
        await this.enqueue(submission.id, submission.judgeGeneration + 1);
    }
  }

  private toResponse(submission: Submission, includeSource = false) {
    return {
      id: submission.id,
      problem: submission.problem
        ? {
            id: submission.problem.id,
            slug: submission.problem.slug,
            title: submission.problem.title,
          }
        : { id: submission.problemId },
      language: submission.language,
      status: submission.status,
      problemVersion: submission.problemVersion,
      judgeGeneration: submission.judgeGeneration,
      runtimeMs: submission.runtimeMs,
      memoryKb: submission.memoryKb,
      passedTestCases: submission.passedTestCases,
      totalTestCases: submission.totalTestCases,
      compileOutput: submission.compileOutput ?? null,
      judgeMessage: submission.judgeMessage ?? null,
      ...(includeSource
        ? {
            sourceCode: submission.sourceCode,
            debugOutputs: submission.debugOutputs ?? [],
          }
        : {}),
      createdAt: submission.createdAt,
      updatedAt: submission.updatedAt,
    };
  }
}
