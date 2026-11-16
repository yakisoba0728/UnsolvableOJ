import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { Problem } from '../problems/problem.entity.js';
import { UserRole } from '../users/user-role.enum.js';
import type { Submission } from './submission.entity.js';
import { SubmissionLanguage } from './submission.enums.js';
import { SubmissionsService } from './submissions.service.js';

describe('enterprise submission transaction boundary', () => {
  function setup(change: 'finish' | 'revoke' | 'version' | 'none') {
    const user = { id: randomUUID(), role: UserRole.USER };
    const attemptId = randomUUID();
    const problemId = randomUUID();
    let open = true;
    let allowed = true;
    let version = 1;
    const result = () => allowed ? [{ id: attemptId, open, version }] : [];
    const repository = {
      create: vi.fn((value: object) => ({ id: randomUUID(), ...value })),
      save: vi.fn(async (value: object) => value),
    };
    const manager = {
      query: vi.fn(async (sql: string) => sql.includes('enterprise_attempts') ? result() : [{ count: 0 }]),
      getRepository: () => repository,
    };
    const db = {
      query: vi.fn(async () => result()),
      transaction: async (work: (value: typeof manager) => Promise<unknown>) => {
        // The request may wait for a connection or another submission's user lock.
        // Eligibility must be read after that wait, not cached from an earlier query.
        if (change === 'finish') open = false;
        if (change === 'revoke') allowed = false;
        if (change === 'version') version = 2;
        return work(manager);
      },
    };
    const queue = { add: vi.fn(async () => ({})) };
    const service = new SubmissionsService(
      repository as unknown as Repository<Submission>,
      {} as Repository<Problem>,
      db as unknown as DataSource,
      queue as unknown as Queue,
    );
    const submit = () => service.createForAttempt(attemptId, problemId, {
      language: SubmissionLanguage.PYTHON,
      sourceCode: 'print(3)',
    }, user);
    return { submit, repository, queue, db, manager, attemptId, problemId };
  }

  it('rejects an attempt that closes before the submission transaction starts', async () => {
    const { submit, repository, queue } = setup('finish');
    await expect(submit()).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an invitation revoked before the submission transaction starts', async () => {
    const { submit, repository, queue } = setup('revoke');
    await expect(submit()).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.save).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('resolves the accepted problem version inside the transaction', async () => {
    const { submit } = setup('version');
    await expect(submit()).resolves.toMatchObject({ problemVersion: 2, isTest: true });
  });

  it('enqueues an eligible submission only after committing its attempt binding', async () => {
    const { submit, repository, queue, attemptId } = setup('none');
    const saved = await submit();
    expect(repository.save).toHaveBeenCalledWith(expect.objectContaining({ attemptId, isTest: true }));
    expect(queue.add).toHaveBeenCalledExactlyOnceWith(
      'judge-submission',
      { submissionId: saved.id, generation: 1 },
      expect.objectContaining({ jobId: `${saved.id}-1` }),
    );
  });
});
