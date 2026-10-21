import 'reflect-metadata';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import configured from '../src/database/data-source.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';
import { Problem } from '../src/modules/problems/problem.entity.js';
import { Submission } from '../src/modules/submissions/submission.entity.js';
import {
  SubmissionLanguage,
  SubmissionStatus,
} from '../src/modules/submissions/submission.enums.js';
import { JudgeService } from '../src/modules/submissions/judge.service.js';
import { SubmissionsService } from '../src/modules/submissions/submissions.service.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';

describe('submission XP evidence (PostgreSQL)', () => {
  let db: DataSource;
  let service: SubmissionsService;
  let judge: JudgeService;
  let user: AuthenticatedUser;
  let problemId: string;

  beforeAll(async () => {
    db = await new DataSource(configured.options).initialize();
    const queue = { add: async () => ({}) } as unknown as Queue;
    service = new SubmissionsService(
      db.getRepository(Submission),
      db.getRepository(Problem),
      db,
      queue,
    );
    judge = new JudgeService(db.getRepository(Submission), db, queue);
  });

  beforeEach(async () => {
    const suffix = randomUUID();
    const [solver] = await db.query(
      `INSERT INTO users (email, username, password_hash, role, xp)
       VALUES ($1, $2, 'unused', 'AUTHOR', 90) RETURNING id, email, username`,
      [`xp-${suffix}@example.com`, `xp_${suffix.slice(0, 8)}`],
    );
    user = { ...solver, role: UserRole.AUTHOR };
    const [problem] = await db.query(
      `INSERT INTO problems (slug, title, statement_md, difficulty, status, author_id)
       VALUES ($1, 'XP policy', 'Test', 'EXPERT', 'PUBLISHED', $2) RETURNING id`,
      [`xp-${suffix}`, user.id],
    );
    problemId = problem.id;
    await db.query(
      `INSERT INTO problem_versions (problem_id, version, snapshot)
       VALUES ($1, 1, $2::jsonb)`,
      [
        problemId,
        JSON.stringify({
          difficulty: 'MEDIUM',
          timeLimitMs: 1000,
          memoryLimitMb: 256,
          testCases: [{ id: randomUUID(), input: '', expectedOutput: '3', isSample: true, score: 1, order: 1 }],
        }),
      ],
    );
  });

  afterEach(async () => {
    if (problemId) {
      await db.query('DELETE FROM submissions WHERE problem_id = $1', [
        problemId,
      ]);
      await db.query('DELETE FROM problems WHERE id = $1', [problemId]);
    }
    if (user) await db.query('DELETE FROM users WHERE id = $1', [user.id]);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
  });

  async function createSubmission() {
    return service.create(
      problemId,
      { language: SubmissionLanguage.PYTHON, sourceCode: 'print(3)' },
      user,
    );
  }

  async function finish(id: string, status: SubmissionStatus) {
    const submission = await db.getRepository(Submission).findOneByOrFail({ id });
    const generation = submission.judgeGeneration;
    const attemptId = randomUUID();
    await judge.claimForJudge(id, generation, attemptId);
    const dto = {
      status,
      passedTestCases: status === SubmissionStatus.ACCEPTED ? 1 : 0,
      totalTestCases: 1,
    };
    const result = await judge.recordJudgeResult(id, generation, attemptId, dto);
    expect(result).not.toHaveProperty('acceptedForXp');
    return { generation, attemptId, dto };
  }

  async function evidence(id: string) {
    const submission = await db.getRepository(Submission).findOneByOrFail({ id });
    return submission.acceptedForXp;
  }

  async function expectSolve(acceptedId: string | null) {
    expect(
      (await db.query('SELECT xp, level FROM users WHERE id = $1', [user.id]))[0],
    ).toEqual(acceptedId ? { xp: 130, level: 2 } : { xp: 90, level: 1 });
    expect(
      await db.query(
        'SELECT accepted_submission_id, awarded_xp FROM user_problem_solves WHERE user_id = $1 AND problem_id = $2',
        [user.id, problemId],
      ),
    ).toEqual(
      acceptedId ? [{ accepted_submission_id: acceptedId, awarded_xp: 40 }] : [],
    );
  }

  it('does not award XP for first or repeated SYSTEM_ERROR/CANCELLED outcomes', async () => {
    const submission = await createSubmission();
    for (const status of [
      SubmissionStatus.SYSTEM_ERROR,
      SubmissionStatus.SYSTEM_ERROR,
      SubmissionStatus.CANCELLED,
    ]) {
      const result = await finish(submission.id, status);
      await judge.recordJudgeResult(
        submission.id,
        result.generation,
        result.attemptId,
        result.dto,
      );
      expect(await evidence(submission.id)).toBe(false);
      await expectSolve(null);
      await service.rejudge(submission.id, user);
    }
  });

  it('preserves earned XP through errors/cancellation, then revokes once on definitive rejection', async () => {
    const submission = await createSubmission();
    const accepted = await finish(submission.id, SubmissionStatus.ACCEPTED);
    await judge.recordJudgeResult(
      submission.id,
      accepted.generation,
      accepted.attemptId,
      accepted.dto,
    );
    await expectSolve(submission.id);

    for (const status of [
      SubmissionStatus.ACCEPTED,
      SubmissionStatus.SYSTEM_ERROR,
      SubmissionStatus.SYSTEM_ERROR,
      SubmissionStatus.CANCELLED,
    ]) {
      await service.rejudge(submission.id, user);
      expect(await evidence(submission.id)).toBe(true);
      await expect(
        judge.recordJudgeResult(
          submission.id,
          accepted.generation,
          accepted.attemptId,
          {
            status: SubmissionStatus.SYSTEM_ERROR,
            passedTestCases: 0,
            totalTestCases: 1,
          },
        ),
      ).rejects.toThrow('이전 채점 시도의 결과입니다.');
      await expectSolve(submission.id);
      const result = await finish(submission.id, status);
      await judge.recordJudgeResult(
        submission.id,
        result.generation,
        result.attemptId,
        result.dto,
      );
      expect(await evidence(submission.id)).toBe(true);
      await expectSolve(submission.id);
    }

    for (let i = 0; i < 2; i++) {
      await service.rejudge(submission.id, user);
      const rejected = await finish(submission.id, SubmissionStatus.WRONG_ANSWER);
      await judge.recordJudgeResult(
        submission.id,
        rejected.generation,
        rejected.attemptId,
        rejected.dto,
      );
      expect(await evidence(submission.id)).toBe(false);
      await expectSolve(null);
    }
  });

  it.each([
    SubmissionStatus.ACCEPTED,
    SubmissionStatus.QUEUED,
    SubmissionStatus.JUDGING,
    SubmissionStatus.SYSTEM_ERROR,
    SubmissionStatus.CANCELLED,
  ])(
    'retains an alternative acceptance currently %s until every known AC is rejected',
    async (status) => {
      const first = await createSubmission();
      const alternative = await createSubmission();
      await finish(first.id, SubmissionStatus.ACCEPTED);
      await finish(alternative.id, SubmissionStatus.ACCEPTED);
      await expectSolve(first.id);

      if (status === SubmissionStatus.ACCEPTED) {
        // Legacy/direct writers may have a current AC without the new evidence bit.
        await db.getRepository(Submission).update(alternative.id, {
          acceptedForXp: false,
        });
      } else {
        const queued = await service.rejudge(alternative.id, user);
        if (status === SubmissionStatus.JUDGING)
          await judge.claimForJudge(
            alternative.id,
            queued.judgeGeneration,
            randomUUID(),
          );
        else if (status !== SubmissionStatus.QUEUED)
          await finish(alternative.id, status);
        expect(await evidence(alternative.id)).toBe(true);
      }

      await service.rejudge(first.id, user);
      await finish(first.id, SubmissionStatus.WRONG_ANSWER);
      expect(await evidence(first.id)).toBe(false);
      await expectSolve(alternative.id);

      await service.rejudge(alternative.id, user);
      expect(await evidence(alternative.id)).toBe(true);
      const rejected = await finish(alternative.id, SubmissionStatus.WRONG_ANSWER);
      await judge.recordJudgeResult(
        alternative.id,
        rejected.generation,
        rejected.attemptId,
        rejected.dto,
      );
      expect(await evidence(alternative.id)).toBe(false);
      await expectSolve(null);
    },
  );
});
