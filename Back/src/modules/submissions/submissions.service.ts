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
import type { ListSubmissionsQuery } from './dto/list-submissions.query.js';
import { Submission } from './submission.entity.js';
import { SubmissionStatus } from './submission.enums.js';

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

export function enqueueJudge(
  queue: Queue<JudgeSubmissionJob>,
  submissionId: string,
  generation: number,
) {
  return queue.add(
    'judge-submission',
    { submissionId, generation },
    {
      jobId: `${submissionId}-${generation}`,
      // 약 10분(5초부터 지수 증가) 동안 재시도해 짧은 API 재시작에 제출이 실패하지 않게 합니다.
      attempts: 8,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  );
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
    const where: FindOptionsWhere<Submission> = { userId: user.id };
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
      if (
        user.role !== UserRole.ADMIN &&
        (user.role !== UserRole.AUTHOR || problem.authorId !== user.id)
      )
        throw new ForbiddenException('재채점 권한이 없습니다.');
      current.judgeGeneration += 1;
      current.judgeAttemptId = null;
      current.judgeLeaseExpiresAt = null;
      current.recoveryCount = 0;
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
      await recordAudit(
        manager,
        user.id,
        'submission.rejudge',
        'submission',
        id,
        { generation: current.judgeGeneration },
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
}
