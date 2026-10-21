import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import { DataSource, LessThan, Repository } from 'typeorm';
import {
  JUDGE_QUEUE,
  JUDGE_WORKER_PRUNE_MS,
  JUDGE_WORKERS_KEY,
  type JudgeSubmissionJob,
} from '../../common/queue.constants.js';
import { ProblemDifficulty } from '../problems/problem.enums.js';
import type { JudgeResultDto } from './dto/judge-result.dto.js';
import { Submission } from './submission.entity.js';
import { SubmissionStatus } from './submission.enums.js';
import {
  enqueueJudge,
  findProblemSnapshot,
  toSubmissionResponse,
} from './submissions.service.js';

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

@Injectable()
export class JudgeService {
  private recoveryTimer?: NodeJS.Timeout;
  constructor(
    @InjectRepository(Submission)
    private readonly submissions: Repository<Submission>,
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
      const snapshot = await findProblemSnapshot(manager, submission);
      if (!snapshot)
        throw new NotFoundException('문제 버전을 찾을 수 없습니다.');
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
        return toSubmissionResponse(submission);
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
      return toSubmissionResponse(submission);
    });
  }

  async heartbeat(workerId: string) {
    if (!isUUID(workerId))
      throw new BadRequestException('워커 ID가 올바르지 않습니다.');
    const client = await this.judgeQueue.getBackend().client;
    const now = Date.now();
    await client.hset(JUDGE_WORKERS_KEY, { [workerId]: now });
    const workers = await client.hgetall(JUDGE_WORKERS_KEY);
    const stale = Object.entries(workers)
      .filter(([, lastSeen]) => now - Number(lastSeen) > JUDGE_WORKER_PRUNE_MS)
      .map(([id]) => id);
    if (stale.length) await client.hdel(JUDGE_WORKERS_KEY, ...stale);
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
      const snapshot = await findProblemSnapshot(manager, submission);
      const awarded = XP[snapshot?.difficulty ?? ProblemDifficulty.BEGINNER];
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
    return Buffer.from(value, 'utf8')
      .toString('utf8')
      .replaceAll('\0', '\uFFFD');
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

  private async requeueMissingJobs() {
    // Look past a healthy backlog for lost jobs, bounded per pass.
    const queued = await this.submissions.find({
      select: { id: true, judgeGeneration: true },
      where: {
        status: SubmissionStatus.QUEUED,
        updatedAt: LessThan(new Date(Date.now() - 10_000)),
      },
      take: 1000,
      order: { updatedAt: 'ASC', id: 'ASC' },
    });
    let requeued = 0;
    for (const submission of queued) {
      const job = await this.judgeQueue.getJob(
        `${submission.id}-${submission.judgeGeneration}`,
      );
      if (!job) {
        await enqueueJudge(
          this.judgeQueue,
          submission.id,
          submission.judgeGeneration,
        );
        if (++requeued === 100) break;
      } else if (['failed', 'completed'].includes(await job.getState()))
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
        await enqueueJudge(
          this.judgeQueue,
          submission.id,
          submission.judgeGeneration + 1,
        );
    }
  }
}
