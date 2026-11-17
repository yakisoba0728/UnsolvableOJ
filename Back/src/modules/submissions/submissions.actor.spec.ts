import { UnauthorizedException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { DataSource, Repository } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { Problem } from '../problems/problem.entity.js';
import { ProblemStatus } from '../problems/problem.enums.js';
import { UserRole } from '../users/user-role.enum.js';
import type { Submission } from './submission.entity.js';
import { SubmissionLanguage } from './submission.enums.js';
import { SubmissionsService } from './submissions.service.js';

describe.each(['ordinary', 'enterprise'] as const)('%s submission actor fencing', (kind) => {
  function setup(role: UserRole, active: boolean, liveSession: boolean) {
    const user = { id: randomUUID(), role, tokenVersion: 7, sessionId: randomUUID() };
    const problemId = randomUUID();
    let committed = false;
    const repository = {
      create: vi.fn((value: object) => ({ id: randomUUID(), ...value })),
      save: vi.fn(async (value: object) => value),
    };
    const manager = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM enterprise_attempts')) return [{ open: true, version: 1 }];
        if (sql.includes('FROM users')) return active ? [{ id: user.id }] : [];
        if (sql.includes('FROM refresh_tokens')) return liveSession ? [{}] : [];
        return [{ count: role === UserRole.ADMIN ? 3 : 0 }];
      }),
      getRepository: () => repository,
    };
    const dataSource = {
      transaction: async (work: (transactionManager: typeof manager) => Promise<unknown>) => {
        const result = await work(manager);
        committed = true;
        return result;
      },
    };
    const queue = { add: vi.fn(async () => { expect(committed).toBe(true); }) };
    const problems = { findOneBy: vi.fn().mockResolvedValue({
      id: problemId, status: ProblemStatus.PUBLISHED, currentVersion: 1,
    }) };
    const service = new SubmissionsService(
      repository as unknown as Repository<Submission>,
      problems as unknown as Repository<Problem>,
      dataSource as unknown as DataSource,
      queue as unknown as Queue,
    );
    const dto = { language: SubmissionLanguage.PYTHON, sourceCode: 'print(3)' };
    const submit = () => kind === 'ordinary'
      ? service.create(problemId, dto, user)
      : service.createForAttempt(randomUUID(), problemId, dto, user);
    return { submit, repository, queue };
  }

  for (const role of [UserRole.USER, UserRole.ADMIN]) {
    it(`rejects a revoked ${role} actor before saving or enqueueing`, async () => {
      const { submit, repository, queue } = setup(role, false, true);
      await expect(submit()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it(`rejects a revoked ${role} session even when the account remains active`, async () => {
      const { submit, repository, queue } = setup(role, true, false);
      await expect(submit()).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.save).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    });

    it(`keeps an eligible ${role} submission and queues it after commit`, async () => {
      const { submit, repository, queue } = setup(role, true, true);
      await expect(submit()).resolves.toHaveProperty('id');
      expect(repository.save).toHaveBeenCalledTimes(1);
      expect(queue.add).toHaveBeenCalledTimes(1);
    });
  }
});
