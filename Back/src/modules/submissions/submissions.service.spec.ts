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
