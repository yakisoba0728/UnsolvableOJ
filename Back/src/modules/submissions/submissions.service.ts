import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import {
  DataSource,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from 'typeorm';
import { recordAudit } from '../../common/database.js';
import { findListPage } from '../../common/list-cursor.js';
import {
  JUDGE_QUEUE,
  type JudgeSubmissionJob,
} from '../../common/queue.constants.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { Problem } from '../problems/problem.entity.js';
import { ProblemDifficulty, ProblemStatus } from '../problems/problem.enums.js';
import { UserRole } from '../users/user-role.enum.js';
import type { CreateSubmissionDto } from './dto/create-submission.dto.js';
import type {
  ListProblemSubmissionsQuery,
  ListSubmissionsQuery,
} from './dto/list-submissions.query.js';
import { Submission } from './submission.entity.js';
import { learningStatuses, SubmissionStatus } from './submission.enums.js';

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

export async function findProblemSnapshot(
  db: Pick<EntityManager, 'query'>,
  submission: Submission,
) {
  const rows: { snapshot: ProblemSnapshot }[] = await db.query(
    'SELECT snapshot FROM problem_versions WHERE problem_id = $1 AND version = $2',
    [submission.problemId, submission.problemVersion],
  );
  return rows[0]?.snapshot;
}

function judgeJob(submissionId: string, generation: number, priority?: number) {
  return {
    name: 'judge-submission',
    data: { submissionId, generation },
    opts: {
      jobId: `${submissionId}-${generation}`,
      ...(priority ? { priority } : {}),
      // 약 10분(5초부터 지수 증가) 동안 재시도해 짧은 API 재시작에 제출이 실패하지 않게 합니다.
      attempts: 8,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  };
}

export function enqueueJudge(
  queue: Queue<JudgeSubmissionJob>,
  submissionId: string,
  generation: number,
) {
  const job = judgeJob(submissionId, generation);
  return queue.add(job.name, job.data, job.opts);
}

export function toSubmissionResponse(
  submission: Submission,
  includeSource = false,
) {
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
    completedForLearning: submission.completedForLearning === true,
    isTest: submission.isTest === true,
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

const BULK_REJUDGE_LIMIT = 200;
// BullMQ는 priority 없는 작업을 먼저 꺼내므로, 일괄 재채점이 새 제출 앞을 막지 않는다.
// shortcut: 복구 타이머가 다시 넣은 작업은 priority를 잃는다. 일괄 재채점이 잦아지면 작업에 priority를 저장한다.
const BULK_REJUDGE_PRIORITY = 10;

function canManage(problem: Pick<Problem, 'authorId'>, user: AuthenticatedUser) {
  return (
    user.role === UserRole.ADMIN ||
    (user.role === UserRole.AUTHOR && problem.authorId === user.id)
  );
}

function resetForRejudge(current: Submission, problem: Problem) {
  // 공개 문제와 검증용 제출은 현재 버전으로 다시 채점한다. 비공개(초안·보관) 문제의 일반 제출은
  // 검수 전 테스트가 다른 사용자의 결과·XP를 바꾸지 않도록 제출 당시 버전을 유지한다.
  if (problem.status === ProblemStatus.PUBLISHED || current.isTest)
    current.problemVersion = problem.currentVersion;
  current.judgeGeneration += 1;
  current.judgeAttemptId = null;
  current.judgeLeaseExpiresAt = null;
  current.recoveryCount = 0;
  if (!current.isTest) {
    if (current.status === SubmissionStatus.ACCEPTED)
      current.acceptedForXp = true;
    if (learningStatuses.has(current.status))
      current.completedForLearning = true;
  }
  current.status = SubmissionStatus.QUEUED;
  current.runtimeMs = null;
  current.memoryKb = null;
  current.passedTestCases = 0;
  current.totalTestCases = 0;
  current.compileOutput = null;
  current.debugOutputs = [];
  current.judgeMessage = null;
}

@Injectable()
export class SubmissionsService {
  constructor(
    @InjectRepository(Submission)
    private readonly submissions: Repository<Submission>,
    @InjectRepository(Problem) private readonly problems: Repository<Problem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectQueue(JUDGE_QUEUE)
    private readonly judgeQueue: Queue<JudgeSubmissionJob>,
  ) {}

  async create(
    problemId: string,
    dto: CreateSubmissionDto,
    user: AuthenticatedUser,
  ) {
    const problem = await this.problems.findOneBy({ id: problemId });
    // 공개 전 문제는 작성자·관리자만 검증용(isTest)으로 제출할 수 있다.
    const isTest = problem?.status !== ProblemStatus.PUBLISHED;
    if (!problem || (isTest && !canManage(problem, user)))
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
        isTest,
      }),
    );
    try {
      await enqueueJudge(this.judgeQueue, submission.id, 1);
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
    return toSubmissionResponse(submission);
  }

  async findMine(user: AuthenticatedUser, query: ListSubmissionsQuery) {
    // 검증용 제출은 학습 기록(히트맵·연속 학습)에 섞이지 않게 내 목록에서 뺀다.
    const where: FindOptionsWhere<Submission> = { userId: user.id, isTest: false };
    if (query.problemId) where.problemId = query.problemId;
    const page = await findListPage(
      this.submissions,
      this.dataSource,
      'submissions',
      query,
      where,
      {
        relations: { problem: true },
        // Lists must not load large source files or debug output into memory.
        select: {
          id: true,
          problemId: true,
          language: true,
          status: true,
          completedForLearning: true,
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
      },
    );
    return {
      ...page,
      items: page.items.map((item) => toSubmissionResponse(item)),
    };
  }
  async findMineById(id: string, user: AuthenticatedUser) {
    const submission = await this.submissions.findOne({
      where: { id },
      relations: { problem: true },
    });
    // 남의 제출은 그 문제의 작성자와 관리자만 본다. 존재 여부를 드러내지 않도록 403 대신 404.
    if (
      !submission ||
      (submission.userId !== user.id && !canManage(submission.problem, user))
    )
      throw new NotFoundException('제출을 찾을 수 없습니다.');
    const sampleTestCases: {
      testCase: number;
      input: string;
      expectedOutput: string;
    }[] = [];
    if (submission.debugOutputs?.length) {
      const snapshot = await findProblemSnapshot(this.dataSource, submission);
      const visible = new Set(
        submission.debugOutputs.map((item) => item.testCase),
      );
      const cases = [...(snapshot?.testCases ?? [])].sort(
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
    return { ...toSubmissionResponse(submission, true), sampleTestCases };
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
      if (!canManage(problem, user))
        throw new ForbiddenException('재채점 권한이 없습니다.');
      resetForRejudge(current, problem);
      await manager.save(current);
      await recordAudit(
        manager,
        user.id,
        'submission.rejudge',
        'submission',
        id,
        { generation: current.judgeGeneration, version: current.problemVersion },
      );
      return current;
    });
    try {
      await enqueueJudge(this.judgeQueue, id, submission.judgeGeneration);
    } catch {
      throw new ServiceUnavailableException(
        '재채점 큐 등록에 실패했습니다. 복구 작업이 다시 시도합니다.',
      );
    }
    return toSubmissionResponse(submission);
  }

  /** 작성자·관리자용 문제별 제출 목록(검증용 제출 포함). 소스는 상세 조회로만 준다. */
  async findForProblem(
    problemId: string,
    user: AuthenticatedUser,
    query: ListProblemSubmissionsQuery,
  ) {
    const problem = await this.problems.findOneBy({ id: problemId });
    if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
    if (!canManage(problem, user))
      throw new ForbiddenException('이 문제의 제출을 볼 권한이 없습니다.');
    const where: FindOptionsWhere<Submission> = { problemId };
    if (query.status) where.status = query.status;
    const page = await findListPage(
      this.submissions,
      this.dataSource,
      'submissions',
      query,
      where,
      {
        relations: { problem: true, user: true },
        select: {
          id: true,
          problemId: true,
          userId: true,
          language: true,
          status: true,
          completedForLearning: true,
          isTest: true,
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
          user: { id: true, username: true },
        },
      },
    );
    return {
      ...page,
      items: page.items.map((item) => ({
        ...toSubmissionResponse(item),
        user: { id: item.user.id, username: item.user.username },
      })),
    };
  }

  /**
   * 문제의 제출을 오래된 것부터 최대 200건씩 재채점한다. 채점 대기·진행 중인 제출은 건너뛴다.
   * 응답의 next를 after로 넘겨 남은 제출을 이어서 처리한다.
   */
  async rejudgeProblem(
    problemId: string,
    user: AuthenticatedUser,
    after?: string,
  ) {
    const result = await this.dataSource.transaction(async (manager) => {
      // 같은 문제의 일괄 재채점끼리 직렬화한다.
      const problem = await manager
        .getRepository(Problem)
        .findOne({ where: { id: problemId }, lock: { mode: 'pessimistic_write' } });
      if (!problem) throw new NotFoundException('문제를 찾을 수 없습니다.');
      if (!canManage(problem, user))
        throw new ForbiddenException('재채점 권한이 없습니다.');
      if (
        after &&
        !(await manager.existsBy(Submission, { id: after, problemId }))
      )
        throw new NotFoundException('이어서 처리할 제출을 찾을 수 없습니다.');
      // JS Date는 마이크로초를 잃으므로 기준 행의 시각은 SQL 안에서 비교한다.
      const afterRow =
        '(s.created_at, s.id) > (SELECT created_at, id FROM submissions WHERE id = :after)';
      const repository = manager.getRepository(Submission);
      const batch = await repository
        .createQueryBuilder('s')
        .setLock('pessimistic_write')
        .where('s.problem_id = :problemId', { problemId })
        .andWhere(after ? afterRow : 'TRUE', { after })
        .orderBy('s.created_at', 'ASC')
        .addOrderBy('s.id', 'ASC')
        .limit(BULK_REJUDGE_LIMIT)
        .getMany();
      const requeued: Submission[] = [];
      for (const current of batch) {
        if (
          current.status === SubmissionStatus.QUEUED ||
          current.status === SubmissionStatus.JUDGING
        )
          continue;
        resetForRejudge(current, problem);
        requeued.push(current);
      }
      await repository.save(requeued);
      const last = batch.at(-1);
      const [{ remaining }]: { remaining: number }[] = last
        ? await manager.query(
            'SELECT count(*)::integer AS remaining FROM submissions s WHERE s.problem_id = $1 AND (s.created_at, s.id) > (SELECT created_at, id FROM submissions WHERE id = $2)',
            [problemId, last.id],
          )
        : [{ remaining: 0 }];
      await recordAudit(manager, user.id, 'problem.rejudge', 'problem', problemId, {
        requeued: requeued.length,
        version: problem.currentVersion,
      });
      return {
        jobs: requeued.map((item) => [item.id, item.judgeGeneration] as const),
        skipped: batch.length - requeued.length,
        remaining,
        next: remaining ? last!.id : null,
      };
    });
    try {
      await this.judgeQueue.addBulk(
        result.jobs.map(([id, generation]) =>
          judgeJob(id, generation, BULK_REJUDGE_PRIORITY),
        ),
      );
    } catch {
      throw new ServiceUnavailableException(
        '재채점 큐 등록에 실패했습니다. 복구 작업이 다시 시도합니다.',
      );
    }
    return {
      requeued: result.jobs.length,
      skipped: result.skipped,
      remaining: result.remaining,
      next: result.next,
    };
  }
}
