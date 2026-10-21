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
  it.each([
    [1, SubmissionStatus.QUEUED, SubmissionStatus.SYSTEM_ERROR],
    [1, SubmissionStatus.JUDGING, SubmissionStatus.JUDGING],
    [1, SubmissionStatus.ACCEPTED, SubmissionStatus.ACCEPTED],
    [2, SubmissionStatus.QUEUED, SubmissionStatus.QUEUED],
  ])(
    'fences enqueue failure against generation %i in %s',
    async (generation, status, expectedStatus) => {
      const problemId = randomUUID();
      const submissionId = randomUUID();
      const stored = {
        id: submissionId,
        judgeGeneration: 1,
        status: SubmissionStatus.QUEUED,
      };
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
        save: vi.fn(async (value: object) => Object.assign(stored, value)),
        update: vi.fn(
          async (criteria: Partial<Submission>, changes: Partial<Submission>) => {
            const matches = Object.entries(criteria).every(
              ([key, value]) => stored[key as keyof typeof stored] === value,
            );
            if (matches) Object.assign(stored, changes);
            return { affected: Number(matches) };
          },
        ),
      };
      const queue = {
        add: vi.fn(async () => {
          Object.assign(stored, { judgeGeneration: generation, status });
          throw new Error('Redis unavailable');
        }),
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
        {
          id: submissionId,
          judgeGeneration: 1,
          status: SubmissionStatus.QUEUED,
        },
        expect.objectContaining({ status: SubmissionStatus.SYSTEM_ERROR }),
      );
      expect(stored.status).toBe(expectedStatus);
      expect(stored.judgeGeneration).toBe(generation);
    },
  );

  it.each(['failed', 'completed'])(
    'fences recovery of an observed %s job against a newer queued generation',
    async (jobState) => {
      const stored = {
        id: randomUUID(),
        judgeGeneration: 1,
        status: SubmissionStatus.QUEUED,
      };
      const submissions = {
        find: vi
          .fn()
          .mockResolvedValueOnce([{ ...stored }])
          .mockResolvedValue([]),
        update: vi.fn().mockResolvedValue({ affected: 0 }),
      };
      const queue = {
        getJob: vi.fn().mockResolvedValue({
          getState: vi.fn(async () => {
            stored.judgeGeneration = 2;
            return jobState;
          }),
        }),
      };
      const service = new SubmissionsService(
        submissions as unknown as Repository<Submission>,
        {} as Repository<Problem>,
        {} as DataSource,
        queue as unknown as Queue,
      );

      await service['requeueMissingJobs']();

      expect(queue.getJob).toHaveBeenCalledWith(`${stored.id}-1`);
      expect(submissions.update).toHaveBeenCalledWith(
        {
          id: stored.id,
          judgeGeneration: 1,
          status: SubmissionStatus.QUEUED,
        },
        expect.objectContaining({ status: SubmissionStatus.SYSTEM_ERROR }),
      );
      expect(stored).toMatchObject({
        judgeGeneration: 2,
        status: SubmissionStatus.QUEUED,
      });
    },
  );
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
      acceptedForXp: false,
      debugOutputs: [],
      sourceCode: 'print(4)',
    } as unknown as Submission;
    const findOne = vi.fn().mockResolvedValue(submission);
    const manager = {
      getRepository: () => ({ findOne }),
      findOneByOrFail: vi.fn().mockResolvedValue({ authorId: user.id }),
      save: vi.fn().mockResolvedValue(submission),
      query: vi.fn().mockResolvedValue([]),
    };
    const repository = { findOne: vi.fn().mockResolvedValue(submission) };
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const db = {
      query: vi.fn().mockResolvedValue([]),
      transaction: async (
        callback: (value: typeof manager) => Promise<unknown>,
      ) => callback(manager),
    };
    const service = new SubmissionsService(
      repository as unknown as Repository<Submission>,
      {} as Repository<Problem>,
      db as unknown as DataSource,
      queue as unknown as Queue,
    );
    return {
      service,
      submission,
      manager,
      user,
      attemptId,
      output,
      db,
      repository,
      findOne,
    };
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

  it('makes every persisted diagnostic PostgreSQL-safe without changing raw results or bounds', async () => {
    const { service, submission, manager, attemptId, output } = setup();
    const unsafe = '\0\uD800한글😀\uDC00\n\\u0000';
    const safe = '\uFFFD\uFFFD한글😀\uFFFD\n\\u0000';
    const dto = {
      status: SubmissionStatus.WRONG_ANSWER,
      passedTestCases: 0,
      totalTestCases: 1,
      compileOutput: 'c'.repeat(65_536 - unsafe.length) + unsafe,
      judgeMessage: 'm'.repeat(10_000 - unsafe.length) + unsafe,
      debugOutputs: [
        {
          ...output,
          stdout: 'o'.repeat(1000 - unsafe.length) + unsafe,
          stderr: 'e'.repeat(1000 - unsafe.length) + unsafe,
          stdoutTruncated: true,
        },
      ],
    };
    await service.recordJudgeResult(submission.id, 1, attemptId, dto);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({
        compileOutput: 'c'.repeat(65_536 - unsafe.length) + safe,
        judgeMessage: 'm'.repeat(10_000 - unsafe.length) + safe,
        debugOutputs: [
          {
            ...output,
            stdout: 'o'.repeat(1000 - unsafe.length) + safe,
            stderr: 'e'.repeat(1000 - unsafe.length) + safe,
            stdoutTruncated: true,
          },
        ],
      }),
    );
    expect(dto.compileOutput.endsWith(unsafe)).toBe(true);
    expect(dto.judgeMessage.endsWith(unsafe)).toBe(true);
    expect(dto.debugOutputs[0].stdout.endsWith(unsafe)).toBe(true);
    expect(dto.debugOutputs[0].stderr.endsWith(unsafe)).toBe(true);
    expect(submission.compileOutput).toHaveLength(65_536);
    expect(submission.judgeMessage).toHaveLength(10_000);
    expect(submission.debugOutputs[0].stdout).toHaveLength(1000);
    expect(submission.debugOutputs[0].stderr).toHaveLength(1000);
  });

  it('uses an exclusive non-key result lock while retaining claim and rejudge serialization', async () => {
    const { service, submission, user, attemptId, findOne, manager } = setup();
    await service.recordJudgeResult(submission.id, 1, attemptId, {
      status: SubmissionStatus.WRONG_ANSWER,
      passedTestCases: 0,
      totalTestCases: 1,
    });
    expect(findOne).toHaveBeenNthCalledWith(1, {
      where: { id: submission.id },
      lock: { mode: 'for_no_key_update' },
    });
    await service.rejudge(submission.id, user);
    expect(findOne).toHaveBeenNthCalledWith(2, {
      where: { id: submission.id },
      lock: { mode: 'pessimistic_write' },
    });
    manager.query.mockResolvedValue([
      { snapshot: { timeLimitMs: 1000, memoryLimitMb: 256, testCases: [] } },
    ]);
    await service.claimForJudge(submission.id, 2, randomUUID());
    expect(findOne).toHaveBeenNthCalledWith(3, {
      where: { id: submission.id },
      lock: { mode: 'pessimistic_write' },
    });
    expect(submission.status).toBe(SubmissionStatus.JUDGING);
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

  it.each([
    [SubmissionStatus.ACCEPTED, true],
    [SubmissionStatus.WRONG_ANSWER, false],
    [SubmissionStatus.TIME_LIMIT_EXCEEDED, false],
    [SubmissionStatus.MEMORY_LIMIT_EXCEEDED, false],
    [SubmissionStatus.RUNTIME_ERROR, false],
    [SubmissionStatus.COMPILE_ERROR, false],
    [SubmissionStatus.OUTPUT_LIMIT_EXCEEDED, false],
  ] as const)('records definitive XP evidence for %s', async (status, accepted) => {
    const { service, submission, attemptId, manager } = setup();
    submission.acceptedForXp = !accepted;
    const result = await service.recordJudgeResult(submission.id, 1, attemptId, {
      status,
      passedTestCases: accepted ? 1 : 0,
      totalTestCases: 1,
    });
    expect(submission.acceptedForXp).toBe(accepted);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedForXp: accepted }),
    );
    expect(result).not.toHaveProperty('acceptedForXp');
  });

  it.each([
    [SubmissionStatus.SYSTEM_ERROR, false],
    [SubmissionStatus.SYSTEM_ERROR, true],
    [SubmissionStatus.CANCELLED, false],
    [SubmissionStatus.CANCELLED, true],
  ] as const)(
    '%s preserves XP evidence %s without reconciling or replaying writes',
    async (status, accepted) => {
      const { service, submission, attemptId, manager } = setup();
      submission.acceptedForXp = accepted;
      const dto = { status, passedTestCases: 0, totalTestCases: 1 };
      await service.recordJudgeResult(submission.id, 1, attemptId, dto);
      await service.recordJudgeResult(submission.id, 1, attemptId, dto);
      expect(submission.acceptedForXp).toBe(accepted);
      expect(manager.save).toHaveBeenCalledTimes(1);
      expect(manager.query).not.toHaveBeenCalled();
    },
  );

  it('captures legacy current ACCEPTED evidence before rejudge overwrites its status', async () => {
    const { service, submission, user, manager } = setup();
    submission.status = SubmissionStatus.ACCEPTED;
    await service.rejudge(submission.id, user);
    expect(submission.status).toBe(SubmissionStatus.QUEUED);
    expect(submission.acceptedForXp).toBe(true);
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ acceptedForXp: true }),
    );
  });

  it('rejects a stale generation SYSTEM_ERROR without touching retained evidence', async () => {
    const { service, submission, attemptId, manager } = setup();
    submission.judgeGeneration = 2;
    submission.acceptedForXp = true;
    await expect(
      service.recordJudgeResult(submission.id, 1, attemptId, {
        status: SubmissionStatus.SYSTEM_ERROR,
        passedTestCases: 0,
        totalTestCases: 1,
      }),
    ).rejects.toThrow('이전 채점 시도의 결과입니다.');
    expect(submission.acceptedForXp).toBe(true);
    expect(submission.status).toBe(SubmissionStatus.JUDGING);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('returns only displayed public samples from the submitted version with original case numbers', async () => {
    const { service, submission, user, output, db, repository } = setup();
    submission.problemVersion = 1;
    submission.debugOutputs = [
      { ...output, testCase: 2 },
      { ...output, testCase: 1 },
    ];
    db.query.mockResolvedValue([
      {
        snapshot: {
          testCases: [
            {
              order: 3,
              isSample: true,
              input: 'unexecuted',
              expectedOutput: 'later',
            },
            {
              order: 2,
              isSample: true,
              input: 'old sample',
              expectedOutput: 'old answer',
            },
            {
              order: 1,
              isSample: false,
              input: 'secret input',
              expectedOutput: 'secret answer',
            },
          ],
        },
      },
    ]);
    const detail = await service.findMineById(submission.id, user);
    expect(detail.sampleTestCases).toEqual([
      { testCase: 2, input: 'old sample', expectedOutput: 'old answer' },
    ]);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('problem_versions'),
      [submission.problemId, 1],
    );
    expect(repository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: submission.id, userId: user.id },
      }),
    );
  });

  it('does not fall back to the current problem when the snapshot is missing', async () => {
    const { service, submission, user, output } = setup();
    submission.debugOutputs = [output];
    expect(
      (await service.findMineById(submission.id, user)).sampleTestCases,
    ).toEqual([]);
  });

  it('does not read samples for a queued submission or another user', async () => {
    const { service, submission, user, db, repository } = setup();
    expect(
      (await service.findMineById(submission.id, user)).sampleTestCases,
    ).toEqual([]);
    repository.findOne.mockResolvedValue(null);
    await expect(service.findMineById(submission.id, user)).rejects.toThrow(
      '제출을 찾을 수 없습니다.',
    );
    expect(db.query).not.toHaveBeenCalled();
  });
});
