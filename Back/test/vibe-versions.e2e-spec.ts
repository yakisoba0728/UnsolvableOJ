import { randomUUID } from 'node:crypto';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { base, bearer, createApp, register } from './helpers.js';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { VibeRunner } from '../src/modules/vibe/vibe.runner.js';
import {
  challenge,
  hiddenChecks,
  initialFiles,
} from '../src/modules/vibe/vibe.catalog.js';
import {
  currentVibeSnapshot,
  registerVibeSnapshot,
  vibeVersion,
} from '../src/modules/vibe/vibe.snapshot.js';

describe('Vibe selection, execution and review use one immutable version', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: string;
  let outsider: string;
  let runner: VibeRunner;
  let ai: VibeAi;
  const runMock = vi.fn<VibeRunner['run']>();
  const evaluateMock = vi.fn<VibeAi['evaluate']>();
  const original = currentVibeSnapshot();
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) =>
    new Date(Date.now() + n * 60_000).toISOString();
  const create = async () =>
    (
      await http()
        .post(`${base}/enterprise/tests`)
        .set(bearer(owner))
        .send({
          title: 'Pinned Vibe',
          startsAt: minutes(5),
          endsAt: minutes(60),
          durationMin: 30,
          problemIds: [],
          vibeChallengeIds: [challenge.id],
          showScoreToCandidates: true,
        })
        .expect(201)
    ).body;
  const begin = async (test: { id: string; inviteCode: string }) => {
    await db.query(
      "UPDATE enterprise_tests SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [test.id],
    );
    const exam = (
      await http()
        .post(`${base}/enterprise/join/${test.inviteCode}/start`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
    const task = (
      await http()
        .post(`${base}/enterprise/attempts/${exam.id}/vibe/${challenge.id}`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
    return { exam, task };
  };
  const changedCatalog = () => {
    // Simulate a deployment changing the same catalog ID without rewriting the DB.
    challenge.title = 'Later deployment title';
    initialFiles['README.md'] = 'Later deployment template';
    hiddenChecks.splice(1);
    hiddenChecks[0].expected = [987654];
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    owner = (await register(app, 'vv_owner', suffix)).accessToken;
    candidate = (await register(app, 'vv_candidate', suffix)).accessToken;
    outsider = (await register(app, 'vv_outside', suffix)).accessToken;
    runner = app.get(VibeRunner);
    ai = app.get(VibeAi);
    vi.spyOn(runner, 'run').mockImplementation(runMock);
    runMock.mockImplementation(async (_files, final, content) =>
      [...content!.publicChecks, ...(final ? content!.hiddenChecks : [])].map(
        ({ name }) => ({ name, passed: true }),
      ),
    );
    vi.spyOn(ai, 'evaluate').mockImplementation(evaluateMock);
    evaluateMock.mockRejectedValue(new Error('No paid provider calls'));
  });
  afterEach(() => {
    Object.assign(challenge, structuredClone(original.challenge));
    Object.assign(initialFiles, original.initialFiles);
    hiddenChecks.splice(
      0,
      hiddenChecks.length,
      ...(structuredClone(original.hiddenChecks) as typeof hiddenChecks),
    );
  });
  beforeEach(async () => {
    // Isolate unrelated request-budget fixtures, as in enterprise-vibe.e2e-spec.
    // Product throttles remain enabled and unchanged for every request.
    const redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
      db: Number(process.env.REDIS_DB),
    });
    try {
      const keys = await redis.keys('throttle:*');
      if (keys.length) await redis.del(...keys);
    } finally {
      await redis.quit();
    }
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app?.close();
  });

  it('retains selected content through catalog edits, candidate starts, saved revisions and staff review', async () => {
    const test = await create();
    const version = vibeVersion(original);
    expect(test.vibeVersionPolicy).toBe('ON_SELECTION');
    expect(test.vibeChallengeVersions).toEqual([
      { challengeId: challenge.id, version },
    ]);
    changedCatalog();
    const changed = await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({ title: 'Ordinary edit', vibeChallengeIds: [challenge.id] })
      .expect(200);
    expect(changed.body.vibeChallengeVersions).toEqual(
      test.vibeChallengeVersions,
    );
    const detail = (
      await http()
        .get(`${base}/enterprise/tests/${test.id}`)
        .set(bearer(owner))
        .expect(200)
    ).body;
    expect(detail.selectedVibeChallenges).toEqual([
      {
        id: challenge.id,
        version,
        title: original.challenge.title,
        difficulty: original.challenge.difficulty,
        stack: original.challenge.stack,
        durationMin: original.challenge.durationMin,
      },
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /hiddenChecks|harness|987654|initialFiles|reviewSystem/,
    );
    const { exam, task } = await begin(test);
    expect(task.challengeVersion).toBe(version);
    expect(task.challenge).toEqual(original.challenge);
    expect(task.files['README.md']).toBe(original.initialFiles['README.md']);
    expect(JSON.stringify(task)).not.toMatch(
      /hiddenChecks|987654|reviewSystem|assistSystem/,
    );
    const status = (
      await http()
        .get(`${base}/enterprise/attempts/${exam.id}`)
        .set(bearer(candidate))
        .expect(200)
    ).body;
    expect(status.vibeTasks[0]).toMatchObject({
      title: original.challenge.title,
      challengeVersion: version,
    });
    const files = Object.fromEntries(
      task.editablePaths.map((path: string) => [path, task.files[path]]),
    );
    files['src/tags.ts'] += '\n// saved revision';
    const saved = (
      await http()
        .patch(`${base}/vibe/attempts/${task.id}/files`)
        .set(bearer(candidate))
        .send({ revision: 0, files })
        .expect(200)
    ).body;
    const submitted = (
      await http()
        .post(`${base}/vibe/attempts/${task.id}/submit`)
        .set(bearer(candidate))
        .send({ revision: saved.revision, reflection: 'Pinned content' })
        .expect(201)
    ).body;
    // Candidate score visibility remains closed until the exam ends.
    expect(submitted.report).toBeNull();
    expect(runMock.mock.calls.at(-1)?.[2]).toEqual(original);
    expect(evaluateMock.mock.calls.at(-1)?.[0].challenge_snapshot).toEqual(
      original,
    );
    const reviewUrl = `${base}/enterprise/tests/${test.id}/attempts/${exam.id}/vibe/${task.id}`;
    const review = (await http().get(reviewUrl).set(bearer(owner)).expect(200))
      .body;
    expect(review.challengeVersion).toBe(version);
    expect(review.report).toMatchObject({ total: 11, passed: 11, outcome: 40 });
    expect(review.files['src/tags.ts']).toBe(files['src/tags.ts']);
    const revision = (
      await http()
        .get(`${reviewUrl}/revisions/1`)
        .set(bearer(owner))
        .expect(200)
    ).body;
    expect(revision.files['src/tags.ts']).toBe(files['src/tags.ts']);
    await http().get(reviewUrl).set(bearer(outsider)).expect(404);
    await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({ refreshVibeVersions: true })
      .expect(409);
  });

  it('refreshes only deliberately before start and scores the selected cohort instead of hardcoding eleven cases', async () => {
    const test = await create();
    changedCatalog();
    const selected = currentVibeSnapshot();
    const version = vibeVersion(selected);
    const refreshed = (
      await http()
        .patch(`${base}/enterprise/tests/${test.id}`)
        .set(bearer(owner))
        .send({ refreshVibeVersions: true })
        .expect(200)
    ).body;
    expect(refreshed.vibeChallengeVersions).toEqual([
      { challengeId: challenge.id, version },
    ]);
    Object.assign(challenge, structuredClone(original.challenge));
    Object.assign(initialFiles, original.initialFiles);
    const { exam, task } = await begin(test);
    expect(task.challenge).toEqual(selected.challenge);
    expect(task.files['README.md']).toBe(selected.initialFiles['README.md']);
    await http()
      .post(`${base}/vibe/attempts/${task.id}/submit`)
      .set(bearer(candidate))
      .send({ revision: 0, reflection: '' })
      .expect(201);
    const review = (
      await http()
        .get(
          `${base}/enterprise/tests/${test.id}/attempts/${exam.id}/vibe/${task.id}`,
        )
        .set(bearer(owner))
        .expect(200)
    ).body;
    expect(review.report).toMatchObject({ total: 6, passed: 6, outcome: 40 });
    expect(review.challengeVersion).toBe(version);
    expect(runMock.mock.calls.at(-1)?.[2]).toEqual(selected);
  });

  it('preserves a refreshed binding across an ordinary save that waited on the test lock', async () => {
    const test = await create();
    changedCatalog();
    const { version } = await db.transaction((manager) =>
      registerVibeSnapshot(manager),
    );
    const lock = db.createQueryRunner();
    await lock.connect();
    await lock.startTransaction();
    let pending: Promise<request.Response> | undefined;
    try {
      const [{ pid }] = await lock.query('SELECT pg_backend_pid() AS pid');
      await lock.query(
        'SELECT id FROM enterprise_tests WHERE id=$1 FOR UPDATE',
        [test.id],
      );
      await lock.query(
        'UPDATE enterprise_vibe_versions SET version=$2 WHERE test_id=$1',
        [test.id, version],
      );
      pending = http()
        .patch(`${base}/enterprise/tests/${test.id}`)
        .set(bearer(owner))
        .send({
          title: 'Waiting ordinary save',
          vibeChallengeIds: [challenge.id],
        })
        .then((response) => response);
      await expect
        .poll(
          async () =>
            (
              await db.query(
                'SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',
                [pid],
              )
            )[0].blocked,
          { timeout: 2500 },
        )
        .toBe(true);
      await lock.commitTransaction();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.body.vibeChallengeVersions).toEqual([
        { challengeId: challenge.id, version },
      ]);
    } finally {
      if (lock.isTransactionActive) await lock.rollbackTransaction();
      await lock.release();
      if (pending) await pending;
    }
  });

  it('retains selected challenges after the current catalog moves to a new ID', async () => {
    const test = await create();
    challenge.id = 'post-search-next';
    await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({
        title: 'Keep archived selection',
        vibeChallengeIds: [original.challenge.id],
      })
      .expect(200);
    await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({ refreshVibeVersions: true })
      .expect(400);
    await db.query(
      "UPDATE enterprise_tests SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [test.id],
    );
    const exam = (
      await http()
        .post(`${base}/enterprise/join/${test.inviteCode}/start`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
    const task = (
      await http()
        .post(
          `${base}/enterprise/attempts/${exam.id}/vibe/${original.challenge.id}`,
        )
        .set(bearer(candidate))
        .expect(201)
    ).body;
    expect(task.challenge.id).toBe(original.challenge.id);
    expect(task.challengeVersion).toBe(vibeVersion(original));
  });

  it('pins one AI model across candidates and changes it only with an explicit selection refresh', async () => {
    const model = vi
      .spyOn(ai, 'model', 'get')
      .mockReturnValue('fixture-selected-model');
    try {
      const retained = await create();
      const refreshed = await create();
      model.mockReturnValue('fixture-next-model');
      const saved = (
        await http()
          .patch(`${base}/enterprise/tests/${retained.id}`)
          .set(bearer(owner))
          .send({
            title: 'Ordinary metadata save',
            vibeChallengeIds: [challenge.id],
          })
          .expect(200)
      ).body;
      const updated = (
        await http()
          .patch(`${base}/enterprise/tests/${refreshed.id}`)
          .set(bearer(owner))
          .send({ refreshVibeVersions: true })
          .expect(200)
      ).body;
      expect(updated.vibeChallengeVersions).toEqual(
        saved.vibeChallengeVersions,
      );
      const first = await begin(retained);
      const otherExam = (
        await http()
          .post(`${base}/enterprise/join/${retained.inviteCode}/start`)
          .set(bearer(outsider))
          .expect(201)
      ).body;
      const otherTask = (
        await http()
          .post(
            `${base}/enterprise/attempts/${otherExam.id}/vibe/${challenge.id}`,
          )
          .set(bearer(outsider))
          .expect(201)
      ).body;
      const next = await begin(refreshed);
      const models: { id: string; model: string }[] = await db.query(
        'SELECT id,model FROM vibe_attempts WHERE id=ANY($1::uuid[])',
        [[first.task.id, otherTask.id, next.task.id]],
      );
      const byId = new Map(models.map((row) => [row.id, row.model]));
      expect(byId.get(first.task.id)).toBe('fixture-selected-model');
      expect(byId.get(otherTask.id)).toBe('fixture-selected-model');
      expect(byId.get(next.task.id)).toBe('fixture-next-model');
      const detail = (
        await http()
          .get(`${base}/enterprise/tests/${retained.id}`)
          .set(bearer(owner))
          .expect(200)
      ).body;
      expect(
        JSON.stringify([
          retained,
          saved,
          updated,
          first.task,
          otherTask,
          next.task,
          detail,
        ]),
      ).not.toMatch(/fixture-selected-model|fixture-next-model|ai_model/);
    } finally {
      model.mockRestore();
    }
  });

  it('refuses missing assessment bindings instead of silently using the current catalog', async () => {
    const test = await create();
    await db.query('DELETE FROM enterprise_vibe_versions WHERE test_id=$1', [
      test.id,
    ]);
    await http()
      .get(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .expect(503);
    await db.query(
      "UPDATE enterprise_tests SET starts_at=clock_timestamp()-interval '1 minute' WHERE id=$1",
      [test.id],
    );
    const exam = (
      await http()
        .post(`${base}/enterprise/join/${test.inviteCode}/start`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
    await http()
      .post(`${base}/enterprise/attempts/${exam.id}/vibe/${challenge.id}`)
      .set(bearer(candidate))
      .expect(503);
    expect(
      (
        await db.query(
          'SELECT count(*)::int AS count FROM vibe_attempts WHERE enterprise_attempt_id=$1',
          [exam.id],
        )
      )[0].count,
    ).toBe(0);
    // Repair this deliberately corrupt fixture; later suites share the owned database.
    await db.query(
      "INSERT INTO enterprise_vibe_versions(test_id,challenge_id,version,ai_model,position) VALUES($1,$2,$3,'gpt-6-luna',1)",
      [test.id, challenge.id, vibeVersion(original)],
    );
  });
});
