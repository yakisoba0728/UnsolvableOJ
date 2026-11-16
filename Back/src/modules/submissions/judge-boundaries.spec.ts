import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { DataSource, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import { JudgeService } from './judge.service.js';
import { Submission } from './submission.entity.js';
import { SubmissionStatus } from './submission.enums.js';

function setup() {
  const attemptId = randomUUID();
  const submission = {
    id: randomUUID(),
    userId: randomUUID(),
    problemId: randomUUID(),
    problemVersion: 7,
    judgeGeneration: 1,
    judgeAttemptId: attemptId,
    status: SubmissionStatus.JUDGING,
    isTest: true,
  } as Submission;
  // Snapshot order deliberately differs from physical JSON order.
  const snapshot = {
    testCases: [
      { order: 20, isSample: true },
      { order: 10, isSample: false },
    ],
  };
  const manager = {
    getRepository: () => ({ findOne: vi.fn().mockResolvedValue(submission) }),
    query: vi.fn(async (sql: string) =>
      sql.startsWith('SELECT snapshot') ? [{ snapshot }] : [],
    ),
    save: vi.fn().mockResolvedValue(submission),
  };
  const db = {
    transaction: (callback: (value: typeof manager) => unknown) =>
      callback(manager),
  };
  const service = new JudgeService(
    {} as Repository<Submission>,
    db as unknown as DataSource,
    {} as Queue,
  );
  const record = (details: Record<string, unknown> = {}) =>
    service.recordJudgeResult(submission.id, 1, attemptId, {
      status: SubmissionStatus.WRONG_ANSWER,
      passedTestCases: 0,
      totalTestCases: 2,
      ...details,
    });
  return { submission, manager, record };
}

const output = (testCase: number) => ({
  testCase,
  stdout: 'sample trace',
  stderr: '',
  stdoutTruncated: false,
  stderrTruncated: false,
});
const result = (testCase: number, isSample: boolean) => ({
  testCase,
  isSample,
  status: SubmissionStatus.WRONG_ANSWER,
  runtimeMs: 1,
  memoryKb: 1,
});

describe('Judge result diagnostic boundaries', () => {
  it('persists only unique public-sample output from the immutable submitted version', async () => {
    const { record, submission, manager } = setup();
    await record({
      debugOutputs: [output(1), output(2), output(3), output(2)],
    });
    expect(submission.debugOutputs).toEqual([output(2)]);
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT snapshot FROM problem_versions WHERE problem_id = $1 AND version = $2',
      [submission.problemId, 7],
    );
  });

  it('derives sample labels from the version snapshot instead of the callback', async () => {
    const { record, submission } = setup();
    await record({ testResults: [result(1, true), result(2, false)] });
    expect(submission.testResults).toEqual([result(1, false), result(2, true)]);
  });

  it('rejects duplicate per-case results before persisting a terminal verdict', async () => {
    const { record, submission, manager } = setup();
    await expect(
      record({ testResults: [result(1, false), result(1, false)] }),
    ).rejects.toThrow();
    expect(submission.status).toBe(SubmissionStatus.JUDGING);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('rejects per-case indices outside the snapshot even when callback totals are inflated', async () => {
    const { record, manager } = setup();
    await expect(
      record({ totalTestCases: 3, testResults: [result(3, true)] }),
    ).rejects.toThrow();
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('fails closed for details with no immutable version, without reading the current problem', async () => {
    const { record, manager } = setup();
    manager.query.mockResolvedValue([]);
    await expect(record({ debugOutputs: [output(2)] })).rejects.toThrow();
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.query).toHaveBeenCalledTimes(1);
  });

  it('retains old-worker callbacks without per-case details and avoids an extra snapshot query', async () => {
    const { record, submission, manager } = setup();
    await record();
    expect(submission.status).toBe(SubmissionStatus.WRONG_ANSWER);
    expect(submission.testResults).toEqual([]);
    expect(submission.debugOutputs).toEqual([]);
    expect(
      manager.query.mock.calls.every(
        ([sql]) => !sql.startsWith('SELECT snapshot'),
      ),
    ).toBe(true);
  });

  it('accepts an incomplete but valid result list for a stopped execution', async () => {
    const { record, submission } = setup();
    await record({
      status: SubmissionStatus.TIME_LIMIT_EXCEEDED,
      testResults: [result(1, false)],
    });
    expect(submission.testResults).toHaveLength(1);
  });
});
