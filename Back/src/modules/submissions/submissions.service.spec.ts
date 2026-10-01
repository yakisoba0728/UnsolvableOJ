import { ServiceUnavailableException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { ProblemDifficulty, ProblemStatus } from '../problems/problem.enums.js';
import type { Problem } from '../problems/problem.entity.js';
import { UserRole } from '../users/user-role.enum.js';
import { SubmissionLanguage, SubmissionStatus } from './submission.enums.js';
import type { Submission } from './submission.entity.js';
import { SubmissionsService } from './submissions.service.js';

describe('SubmissionsService queue failure', () => {
  it('marks the saved submission as SYSTEM_ERROR when Redis rejects enqueue', async () => {
    const problemId = randomUUID();
    const submissionId = randomUUID();
    const problems = {
      findOneBy: vi.fn().mockResolvedValue({
        id: problemId,
        status: ProblemStatus.PUBLISHED,
        difficulty: ProblemDifficulty.BEGINNER,
        currentVersion: 1,
      }),
    };
    const submissions = {
      create: vi.fn((value: object) => value),
      save: vi.fn(async (value: object) => ({ ...value, id: submissionId })),
      update: vi.fn().mockResolvedValue({ affected: 1 }),
    };
    const queue = {
      add: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
    };
    const service = new SubmissionsService(
      submissions as unknown as Repository<Submission>,
      problems as unknown as Repository<Problem>,
      {} as DataSource,
      queue as unknown as Queue,
    );

    await expect(
      service.create(
        problemId,
        { language: SubmissionLanguage.PYTHON, sourceCode: 'print(3)' },
        {
          id: randomUUID(),
          email: 'solver@example.com',
          username: 'solver',
          role: UserRole.USER,
        },
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(submissions.update).toHaveBeenCalledWith(
      submissionId,
      expect.objectContaining({ status: SubmissionStatus.SYSTEM_ERROR }),
    );
  });
});

describe('submission debug output lifecycle', () => {
  function setup() {
    const user = {
      id: randomUUID(),
      email: 'author@example.com',
      username: 'author',
      role: UserRole.AUTHOR,
    };
    const attemptId = randomUUID();
    const output = {
      testCase: 1,
      stdout: '4\n',
      stderr: 'debug\n',
      stdoutTruncated: false,
      stderrTruncated: false,
    };
    const submission = {
      id: randomUUID(),
      userId: user.id,
      problemId: randomUUID(),
      judgeGeneration: 1,
      judgeAttemptId: attemptId,
      status: SubmissionStatus.JUDGING,
      debugOutputs: [],
      sourceCode: 'print(4)',
    } as unknown as Submission;
    const manager = {
      getRepository: () => ({ findOne: vi.fn().mockResolvedValue(submission) }),
      findOneByOrFail: vi.fn().mockResolvedValue({ authorId: user.id }),
      save: vi.fn().mockResolvedValue(submission),
      query: vi.fn().mockResolvedValue([]),
    };
    const repository = { findOne: vi.fn().mockResolvedValue(submission) };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const service = new SubmissionsService(
      repository as unknown as Repository<Submission>,
      {} as Repository<Problem>,
      {
        transaction: async (
          callback: (value: typeof manager) => Promise<unknown>,
        ) => callback(manager),
      } as unknown as DataSource,
      queue as unknown as Queue,
    );
    return { service, submission, manager, user, attemptId, output };
  }

  it('persists output and returns it through the owner detail endpoint', async () => {
    const { service, submission, manager, user, attemptId, output } = setup();
    await service.recordJudgeResult(submission.id, 1, attemptId, {
      status: SubmissionStatus.WRONG_ANSWER,
      passedTestCases: 0,
      totalTestCases: 1,
      debugOutputs: [output],
    });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ debugOutputs: [output] }),
    );
    expect(
      (await service.findMineById(submission.id, user)).debugOutputs,
    ).toEqual([output]);
    await service.recordJudgeResult(submission.id, 1, attemptId, {
      status: SubmissionStatus.WRONG_ANSWER,
      passedTestCases: 0,
      totalTestCases: 1,
    });
    expect(submission.debugOutputs).toEqual([output]);
  });

  it('clears previous output on rejudge and rejects stale results', async () => {
    const { service, submission, user, attemptId, output } = setup();
    submission.debugOutputs = [output];
    await service.rejudge(submission.id, user);
    expect(submission.debugOutputs).toEqual([]);
    expect(submission.judgeGeneration).toBe(2);
    await expect(
      service.recordJudgeResult(submission.id, 1, attemptId, {
        status: SubmissionStatus.WRONG_ANSWER,
        passedTestCases: 0,
        totalTestCases: 1,
        debugOutputs: [output],
      }),
    ).rejects.toThrow('이전 채점 시도의 결과입니다.');
    expect(submission.debugOutputs).toEqual([]);
  });
});
