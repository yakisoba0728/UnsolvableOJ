import { randomUUID } from 'node:crypto';
import {
  afterAll,
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
import { VibeService } from '../src/modules/vibe/vibe.service.js';
import { editableFiles } from '../src/modules/vibe/vibe.catalog.js';

describe('enterprise vibe assignments and private candidate review', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: string;
  let outsider: string;
  let admin: string;
  let candidateId: string;
  let ai: VibeAi;
  let runner: VibeRunner;
  const evaluate = vi.fn<VibeAi['evaluate']>();
  const run = vi.fn<VibeRunner['run']>();
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) => new Date(Date.now() + n * 60000).toISOString();
  const taskId = 'post-search-v1';
  const body = (extra: Record<string, unknown> = {}) => ({
    title: '실무 코딩 테스트',
    startsAt: minutes(-1),
    endsAt: minutes(60),
    durationMin: 30,
    problemIds: [],
    vibeChallengeIds: [taskId],
    ...extra,
  });
  const create = async (extra: Record<string, unknown> = {}) =>
    (
      await http()
        .post(`${base}/enterprise/tests`)
        .set(bearer(owner))
        .send(body(extra))
        .expect(201)
    ).body;
  const start = async (test: { inviteCode: string }) =>
    (
      await http()
        .post(`${base}/enterprise/join/${test.inviteCode}/start`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
  const startTask = async (attemptId: string) =>
    (
      await http()
        .post(`${base}/enterprise/attempts/${attemptId}/vibe/${taskId}`)
        .set(bearer(candidate))
        .expect(201)
    ).body;
  const reviewUrl = (testId: string, attemptId: string, id: string) =>
    `${base}/enterprise/tests/${testId}/attempts/${attemptId}/vibe/${id}`;
  const grade = {
    prompt: { score: 25, feedback: '구체적인 요구사항', evidence: [] },
    process: { score: 24, feedback: '변경을 확인하고 검증', evidence: [] },
  };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const suffix = randomUUID().slice(0, 8);
    owner = (await register(app, 'ev_owner', suffix)).accessToken;
    const account = await register(app, 'ev_candidate', suffix);
    candidate = account.accessToken;
    candidateId = account.user.id;
    outsider = (await register(app, 'ev_outsider', suffix)).accessToken;
    const administrator = await register(app, 'ev_admin', suffix);
    await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [
      administrator.user.id,
    ]);
    // Role is read from the current user row by the JWT strategy.
    admin = administrator.accessToken;
    ai = app.get(VibeAi);
    runner = app.get(VibeRunner);
    vi.spyOn(ai, 'available', 'get').mockReturnValue(true);
    vi.spyOn(ai, 'assist').mockResolvedValue({
      text: '태그를 정확히 비교합니다.',
      files: { 'src/tags.ts': 'export const matchesTag = () => false;\n' },
    });
    evaluate.mockResolvedValue(grade);
    vi.spyOn(ai, 'evaluate').mockImplementation(evaluate);
    vi.spyOn(runner, 'run').mockImplementation(run);
    run.mockResolvedValue(
      Array.from({ length: 11 }, (_, i) => ({
        name: `검증 ${i}`,
        passed: true,
      })),
    );
  });
  beforeEach(async () => {
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

  it('validates combined tasks, preserves assignments on partial edit and permits vibe-only tests', async () => {
    for (const extra of [
      { vibeChallengeIds: [] },
      { vibeChallengeIds: ['unknown'] },
      { vibeChallengeIds: [taskId, taskId] },
    ])
      await http()
        .post(`${base}/enterprise/tests`)
        .set(bearer(owner))
        .send(body(extra))
        .expect(400);
    const test = await create({ startsAt: minutes(5) });
    expect(test.vibeChallengeIds).toEqual([taskId]);
    const updated = await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({ title: '수정된 시험' })
      .expect(200);
    expect(updated.body.vibeChallengeIds).toEqual([taskId]);
    await http()
      .patch(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .send({ vibeChallengeIds: [] })
      .expect(400);
    const info = await http()
      .get(`${base}/enterprise/join/${test.inviteCode}`)
      .set(bearer(candidate))
      .expect(200);
    expect(info.body.test.problemCount).toBe(1);
    expect(info.body.test.vibeChallengeIds).toBeUndefined();
    await http()
      .delete(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .expect(200);
  });

  it('links one workspace to an exam, records actual code revisions and hides reports on every candidate path', async () => {
    const test = await create({
      inviteOnly: true,
      invitees: [candidateId + '@invalid.example'],
    });
    // Use a registered username to exercise the shared invite policy.
    const [{ username }] = await db.query(
      'SELECT username FROM users WHERE id=$1',
      [candidateId],
    );
    await db.query(
      "UPDATE enterprise_tests SET invite_user_ids=$2,invite_emails='{}' WHERE id=$1",
      [test.id, [candidateId]],
    );
    expect(username).toBeTruthy();
    const exam = await start(test);
    const task = await startTask(exam.id);
    const resumed = await startTask(exam.id);
    expect(resumed.id).toBe(task.id);
    expect(Date.parse(task.deadlineAt)).toBe(Date.parse(exam.deadlineAt));
    const url = `${base}/vibe/attempts/${task.id}`;
    const review = reviewUrl(test.id, exam.id, task.id);
    for (const token of [candidate, outsider]) {
      await http().get(review).set(bearer(token)).expect(404);
      await http()
        .get(review + '/revisions/0')
        .set(bearer(token))
        .expect(404);
    }
    await http().get(url).set(bearer(outsider)).expect(404);
    await http()
      .get(reviewUrl(randomUUID(), exam.id, task.id))
      .set(bearer(owner))
      .expect(404);
    await http()
      .get(reviewUrl(test.id, randomUUID(), task.id))
      .set(bearer(owner))
      .expect(404);
    await http()
      .post(review + '/evaluation')
      .set(bearer(owner))
      .expect(409);
    const files = {
      ...editableFiles(),
      'src/tags.ts': 'export const matchesTag = () => false;\n',
    };
    await http()
      .patch(url + '/files')
      .set(bearer(candidate))
      .send({ revision: 0, files })
      .expect(200);
    const chat = await http()
      .post(url + '/messages')
      .set(bearer(candidate))
      .send({ revision: 1, prompt: '태그 필터를 수정하고 검증해 주세요.' })
      .expect(201);
    await http()
      .post(url + '/runs')
      .set(bearer(candidate))
      .send({ revision: 1 })
      .expect(201);
    const snapshot = await http()
      .get(review + '/revisions/1')
      .set(bearer(owner))
      .expect(200);
    expect(snapshot.body.files).toEqual(files);
    expect(snapshot.body.previousFiles).toEqual(editableFiles());
    const reviewed = await http().get(review).set(bearer(owner)).expect(200);
    expect(
      reviewed.body.revisions.map((r: { revision: number }) => r.revision),
    ).toEqual([0, 1]);
    expect(reviewed.body.messages).toEqual(chat.body.messages);
    expect(reviewed.body.runs).toHaveLength(1);
    await http().get(review).set(bearer(admin)).expect(200);
    const submitted = await http()
      .post(url + '/submit')
      .set(bearer(candidate))
      .send({ revision: 1, reflection: '' })
      .expect(201);
    expect(submitted.body.report).toBeNull();
    await http()
      .post(url + '/evaluation')
      .set(bearer(candidate))
      .send({ revision: 1 })
      .expect(201)
      .expect(({ body }) => expect(body.report).toBeNull());
    await http()
      .get(url)
      .set(bearer(candidate))
      .expect(200)
      .expect(({ body }) => expect(body.report).toBeNull());
    const history = await http()
      .get(`${base}/vibe/attempts`)
      .set(bearer(candidate))
      .expect(200);
    expect(history.body.some((row: { id: string }) => row.id === task.id)).toBe(
      false,
    );
    await http()
      .post(`${base}/enterprise/attempts/${exam.id}/finish`)
      .set(bearer(candidate))
      .expect(200);
    const after = await http()
      .get(`${base}/enterprise/attempts/${exam.id}`)
      .set(bearer(candidate))
      .expect(200);
    expect(after.body.result).toBeNull();
    expect(after.body.vibeTasks[0].score).toBeNull();
    const ownerResult = await http()
      .get(`${base}/enterprise/tests/${test.id}/results`)
      .set(bearer(owner))
      .expect(200);
    expect(ownerResult.body.candidates[0].score).toBe(89);
    expect(ownerResult.body.summary.averageScore).toBe(89);
    const full = await http().get(review).set(bearer(owner)).expect(200);
    expect(full.body.report.prompt.score).toBe(25);
    expect(JSON.stringify(full.body)).not.toMatch(
      /gpt-6|medium|OPENAI_API_KEY/,
    );
    await http()
      .delete(`${base}/enterprise/tests/${test.id}`)
      .set(bearer(owner))
      .expect(409);
  });

  it('freezes saved files on finish, keeps unavailable evaluation pending and allows owner retry', async () => {
    const test = await create({ showScoreToCandidates: true });
    const exam = await start(test);
    const task = await startTask(exam.id);
    const url = `${base}/vibe/attempts/${task.id}`;
    const review = reviewUrl(test.id, exam.id, task.id);
    evaluate.mockRejectedValueOnce(new Error('unavailable'));
    await http()
      .post(`${base}/enterprise/attempts/${exam.id}/finish`)
      .set(bearer(candidate))
      .expect(200);
    expect(run).toHaveBeenCalled();
    for (const [method, path, payload] of [
      ['patch', '/files', { revision: 0, files: editableFiles() }],
      ['post', '/messages', { revision: 0, prompt: 'late prompt' }],
      ['post', '/runs', { revision: 0 }],
    ] as const)
      await http()
        [method](url + path)
        .set(bearer(candidate))
        .send(payload)
        .expect(409);
    const pending = await http()
      .get(`${base}/enterprise/tests/${test.id}/results`)
      .set(bearer(owner))
      .expect(200);
    expect(pending.body.summary).toMatchObject({
      pending: 1,
      averageScore: null,
    });
    expect(pending.body.candidates[0]).toMatchObject({
      score: null,
      vibeTasks: [{ status: 'pending', score: null }],
    });
    const partial = await http().get(url).set(bearer(candidate)).expect(200);
    expect(partial.body.report).toMatchObject({
      outcome: 40,
      evaluationStatus: 'unavailable',
    });
    await http()
      .post(review + '/evaluation')
      .set(bearer(outsider))
      .expect(404);
    const retry = await http()
      .post(review + '/evaluation')
      .set(bearer(owner))
      .expect(201);
    expect(retry.body.report.evaluationStatus).toBe('complete');
    const result = await http()
      .get(`${base}/enterprise/attempts/${exam.id}`)
      .set(bearer(candidate))
      .expect(200);
    expect(result.body.result).toMatchObject({ score: 89, total: 1 });
    await http()
      .get(url)
      .set(bearer(candidate))
      .expect(200)
      .expect(({ body }) => expect(body.enterprise.finished).toBe(true));
  });

  it('uses the exam deadline, rejects unassigned workspaces, and lets reviewers grade expired saved work', async () => {
    const test = await create();
    const exam = await start(test);
    const task = await startTask(exam.id);
    const url = `${base}/vibe/attempts/${task.id}`;
    await db.query(
      "UPDATE enterprise_attempts SET deadline_at=now()-interval '1 second' WHERE id=$1",
      [exam.id],
    );
    await http()
      .patch(url + '/files')
      .set(bearer(candidate))
      .send({ revision: 0, files: editableFiles() })
      .expect(409);
    const frozen = await http().get(url).set(bearer(candidate)).expect(200);
    expect(frozen.body.enterprise.finished).toBe(true);
    expect(Date.parse(frozen.body.deadlineAt)).toBeLessThan(Date.now());
    const review = reviewUrl(test.id, exam.id, task.id);
    await http()
      .post(review + '/evaluation')
      .set(bearer(owner))
      .expect(201);
    expect(evaluate.mock.calls.at(-1)?.[1]).toBe('');
    await http()
      .get(review + '/revisions/9')
      .set(bearer(owner))
      .expect(404);
    // Same known challenge, but an exam without that assignment cannot acquire a workspace.
    await db.query(
      "UPDATE enterprise_tests SET vibe_challenge_ids='{}',problem_ids=$2 WHERE id=$1",
      [test.id, [randomUUID()]],
    );
    await expect(
      app.get(VibeService).startEnterprise(exam.id, taskId, candidateId),
    ).rejects.toThrow('응시 과제');
  });
});
