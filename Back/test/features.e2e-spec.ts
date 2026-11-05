import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type EntitySubscriberInterface } from 'typeorm';
import { Problem } from '../src/modules/problems/problem.entity.js';
import { ProblemsService } from '../src/modules/problems/problems.service.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import request from 'supertest';
import {
  base,
  bearer,
  closeApp,
  createApp,
  login,
  register,
} from './helpers.js';

const judge = (generation: number, attempt: string) => ({
  'X-Judge-Token': 'test-judge-token-with-at-least-32-characters',
  'X-Judge-Generation': String(generation),
  'X-Judge-Attempt': attempt,
});

describe('Backend features (e2e)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let submissionId: string | undefined;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
  });

  it('rejects non-object test-case elements on POST/PATCH with 400 and no problem/case/version/audit changes', async () => {
    const suffix = randomUUID().slice(0, 8);
    const admin = await register(app, 'shape', suffix);
    await db.query("UPDATE users SET role='ADMIN', token_version=token_version+1 WHERE id=$1", [admin.user.id]);
    const token = (await login(app, admin.user.email)).accessToken;
    const testCase = { input: ' \n', expectedOutput: '', isSample: false };
    const testCases = [testCase, { input: '', expectedOutput: '\t\r\n ', isSample: false }];
    const content = {
      slug: `shape-${suffix}`,
      title: 'Original title',
      statementMarkdown: '',
      inputDescriptionMarkdown: '',
      outputDescriptionMarkdown: '',
      difficulty: 'BEGINNER',
      testCases,
    };
    const created = await request(app.getHttpServer())
      .post(`${base}/problems`).set(bearer(token)).send(content).expect(201);
    expect(created.body.samples).toEqual([]);
    const problemId = created.body.id;
    const state = () => Promise.all([
      db.query('SELECT * FROM problems WHERE author_id=$1 ORDER BY id', [admin.user.id]),
      db.query(`SELECT t.* FROM test_cases t JOIN problems p ON p.id=t.problem_id
        WHERE p.author_id=$1 ORDER BY t.id`, [admin.user.id]),
      db.query(`SELECT v.* FROM problem_versions v JOIN problems p ON p.id=v.problem_id
        WHERE p.author_id=$1 ORDER BY v.problem_id,v.version`, [admin.user.id]),
      db.query('SELECT * FROM audit_events WHERE actor_id=$1 ORDER BY id', [admin.user.id]),
    ]);
    const before = await state();
    const invalid = [
      [[]], [[testCase]], [[], [testCase]], [testCase, []],
      [null], ['case'], [1], [true], [{}], null, testCase,
    ];
    for (const [index, value] of invalid.entries()) {
      await request(app.getHttpServer())
        .post(`${base}/problems`).set(bearer(token))
        .send({ ...content, slug: `invalid-shape-${suffix}-${index}`, testCases: value })
        .expect(400);
      expect(await state()).toEqual(before);
      await request(app.getHttpServer())
        .patch(`${base}/problems/${problemId}`).set(bearer(token))
        .send({ title: 'Must not persist', testCases: value })
        .expect(400);
      expect(await state()).toEqual(before);
    }
    const updated = await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`).set(bearer(token))
      .send({ testCases }).expect(200);
    expect(updated.body.currentVersion).toBe(2);
    expect(updated.body.testCases).toMatchObject(testCases);
  });

  it('rejects encoded NUL slugs with 400 on both public aliases and keeps uppercase lookups working', async () => {
    const suffix = randomUUID().slice(0, 8);
    const [author]: { id: string }[] = await db.query(
      `INSERT INTO users(email,username,password_hash) VALUES($1,$2,'unused') RETURNING id`,
      [`slug-${suffix}@example.com`, `slug_${suffix}`],
    );
    const slug = `slug-${suffix}`;
    const [problem]: { id: string }[] = await db.query(
      `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
       VALUES($1,'Slug lookup','Published','BEGINNER','PUBLISHED',$2) RETURNING id`,
      [slug, author.id],
    );
    await db.query(`INSERT INTO test_cases(problem_id,input,expected_output,is_sample,"order")
      VALUES($1,'public sample','',true,1),($1,'hidden input','hidden output',false,2)`, [problem.id]);
    for (const prefix of [`${base}/problems/by-slug/`, `${base}/problems/`]) {
      await request(app.getHttpServer()).get(`${prefix}abc%00def`).expect(400);
      const detail = await request(app.getHttpServer()).get(`${prefix}${slug.toUpperCase()}`).expect(200);
      expect(detail.body.id).toBe(problem.id);
      expect(detail.body.samples).toEqual([{ input: 'public sample', expectedOutput: '' }]);
      expect(JSON.stringify(detail.body)).not.toContain('hidden input');
      await request(app.getHttpServer()).get(`${prefix}missing-${suffix}`).expect(404);
    }
  });

  it('keeps public body and samples on v1 when an author commits unpublished v2 between reads', async () => {
    const suffix = randomUUID().slice(0, 8);
    const author = await register(app, 'race', suffix);
    const slug = `snapshot-${suffix}`;
    const [problem]: { id: string }[] = await db.query(
      `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
       VALUES($1,'v1','published body','BEGINNER','PUBLISHED',$2) RETURNING id`,
      [slug, author.user.id],
    );
    await db.query(`INSERT INTO test_cases(problem_id,input,expected_output,is_sample,"order")
      VALUES($1,'public v1','v1',true,1),($1,'hidden','secret',false,2)`, [problem.id]);
    let interleaved = false;
    const subscriber: EntitySubscriberInterface<Problem> = {
      listenTo: () => Problem,
      afterLoad: async (entity) => {
        if (entity.id !== problem.id || interleaved) return;
        interleaved = true;
        await app.get(ProblemsService).update(problem.id, {
          statementMarkdown: 'unpublished body v2',
          testCases: [{ input: 'unpublished sample v2', expectedOutput: 'secret v2', isSample: true, score: 1 }],
        }, { id: author.user.id, role: UserRole.AUTHOR });
      },
    };
    db.subscribers.push(subscriber);
    try {
      const detail = await request(app.getHttpServer()).get(`${base}/problems/by-slug/${slug}`).expect(200);
      expect(interleaved).toBe(true);
      expect(detail.body.statementMarkdown).toBe('published body');
      expect(detail.body.currentVersion).toBe(1);
      expect(detail.body.samples).toEqual([{ input: 'public v1', expectedOutput: 'v1' }]);
      await request(app.getHttpServer()).get(`${base}/problems/by-slug/${slug}`).expect(404);
    } finally {
      db.subscribers.splice(db.subscribers.indexOf(subscriber), 1);
    }
  });

  it('keeps a submission on its problem version, fences attempts, and reconciles XP', async () => {
    const suffix = randomUUID().slice(0, 8);
    const author = await register(app, 'author', suffix);
    const solver = await register(app, 'solver', suffix);
    const admin = await register(app, 'admin', suffix);
    await db.query(
      "UPDATE users SET role = 'AUTHOR', token_version = token_version + 1 WHERE id = $1",
      [author.user.id],
    );
    await db.query(
      "UPDATE users SET role = 'ADMIN', token_version = token_version + 1 WHERE id = $1",
      [admin.user.id],
    );
    const authorToken = (await login(app, author.user.email)).accessToken;
    const adminToken = (await login(app, admin.user.email)).accessToken;
    await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(author.accessToken))
      .expect(401);

    const created = await request(app.getHttpServer())
      .post(`${base}/problems`)
      .set(bearer(authorToken))
      .send({
        slug: `version-${suffix}`,
        title: 'Version one',
        statementMarkdown: 'x'.repeat(150_000),
        inputDescriptionMarkdown: 'numbers',
        outputDescriptionMarkdown: 'sum',
        difficulty: 'BEGINNER',
        status: 'DRAFT',
        timeLimitMs: 5000,
        memoryLimitMb: 512,
        testCases: [
          { input: '1 2\n', expectedOutput: '3\n', isSample: true },
          { input: '5 7\n', expectedOutput: '12\n', isSample: false },
        ],
      })
      .expect(201);
    const problemId = created.body.id;
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(authorToken))
      .send({ status: 'PUBLISHED' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    const publicView = await request(app.getHttpServer())
      .get(`${base}/problems/version-${suffix}`)
      .expect(200);
    expect(JSON.stringify(publicView.body)).not.toContain('5 7');
    await request(app.getHttpServer())
      .get(`${base}/problems?page=1000001`)
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/submissions?page=1000001`)
      .set(bearer(solver.accessToken))
      .expect(400);
    await request(app.getHttpServer())
      .get(`${base}/problems/${problemId}/manage`)
      .set(bearer(solver.accessToken))
      .expect(403);

    const submitted = await request(app.getHttpServer())
      .post(`${base}/problems/${problemId}/submissions`)
      .set(bearer(solver.accessToken))
      .send({
        language: 'PYTHON',
        sourceCode: 'print(3)\n#' + 'x'.repeat(199_990),
      })
      .expect(202);
    submissionId = submitted.body.id;
    expect(submitted.body.problemVersion).toBe(1);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({ timeLimitMs: null })
      .expect(400);
    const updated = await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}`)
      .set(bearer(authorToken))
      .send({
        title: 'Version two',
        testCases: [
          { input: '9 9\n', expectedOutput: '18\n', isSample: false },
        ],
      })
      .expect(200);
    expect(updated.body.currentVersion).toBe(2);
    expect(updated.body.status).toBe('DRAFT');
    expect(updated.body).toMatchObject({
      timeLimitMs: 5000,
      memoryLimitMb: 512,
    });
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(adminToken))
      .send({ status: 'PUBLISHED' })
      .expect(200);
    const hiddenOnly = await request(app.getHttpServer())
      .get(`${base}/problems/version-${suffix}`)
      .expect(200);
    expect(hiddenOnly.body.samples).toEqual([]);
    const path = `${base}/internal/judge/submissions/${submissionId}`;
    const firstAttempt = randomUUID();
    const claim = await request(app.getHttpServer())
      .get(path)
      .set(judge(1, firstAttempt))
      .expect(200);
    expect(
      claim.body.testCases.map((item: { input: string }) => item.input),
    ).toEqual(['1 2\n', '5 7\n']);
    await request(app.getHttpServer())
      .get(path)
      .set(judge(1, randomUUID()))
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${path}/heartbeat`)
      .set(judge(1, firstAttempt))
      .expect(200);
    await db.query(
      "UPDATE submissions SET judge_lease_expires_at = now() - interval '1 second' WHERE id = $1",
      [submissionId],
    );
    const secondAttempt = randomUUID();
    await request(app.getHttpServer())
      .get(path)
      .set(judge(1, secondAttempt))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, firstAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(409);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({
        status: 'ACCEPTED',
        passedTestCases: 2,
        totalTestCases: 2,
        memoryKb: 512,
        debugOutputs: [
          {
            testCase: 1,
            stdout: '3\n',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
          },
        ],
      })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(200);
    // The current problem is now a draft with different tests. The detail must
    // still show only the public sample from the immutable submitted version.
    const oldDetail = await request(app.getHttpServer())
      .get(`${base}/submissions/${submissionId}`)
      .set(bearer(solver.accessToken))
      .expect(200);
    expect(oldDetail.body.sampleTestCases).toEqual([
      { testCase: 1, input: '1 2\n', expectedOutput: '3\n' },
    ]);
    expect(JSON.stringify(oldDetail.body)).not.toContain('5 7');
    await request(app.getHttpServer())
      .get(`${base}/submissions/${submissionId}`)
      .set(bearer(authorToken))
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/users/me`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body,
    ).toMatchObject({ xp: 10, solvedCount: 1 });

    await request(app.getHttpServer())
      .post(`${base}/submissions/${submissionId}/rejudge`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`${base}/submissions/${submissionId}/rejudge`)
      .set(bearer(solver.accessToken))
      .expect(403);
    const rejudge = await request(app.getHttpServer())
      .post(`${base}/submissions/${submissionId}/rejudge`)
      .set(bearer(authorToken))
      .expect(202);
    expect(rejudge.body.judgeGeneration).toBe(2);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/submissions/${submissionId}`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body.sampleTestCases,
    ).toEqual([]);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(1, secondAttempt))
      .send({ status: 'ACCEPTED', passedTestCases: 2, totalTestCases: 2 })
      .expect(409);
    const thirdAttempt = randomUUID();
    await request(app.getHttpServer())
      .get(path)
      .set(judge(2, thirdAttempt))
      .expect(200);
    await request(app.getHttpServer())
      .patch(`${path}/result`)
      .set(judge(2, thirdAttempt))
      .send({ status: 'WRONG_ANSWER', passedTestCases: 0, totalTestCases: 2 })
      .expect(200);
    expect(
      (
        await request(app.getHttpServer())
          .get(`${base}/users/me`)
          .set(bearer(solver.accessToken))
          .expect(200)
      ).body,
    ).toMatchObject({ xp: 0, solvedCount: 0 });

    await request(app.getHttpServer())
      .get(`${base}/admin/ops`)
      .set(bearer(authorToken))
      .expect(403);
    const ops = await request(app.getHttpServer())
      .get(`${base}/admin/ops`)
      .set(bearer(adminToken))
      .expect(200);
    expect(ops.body.queue).toHaveProperty('waiting');
    await request(app.getHttpServer())
      .patch(`${base}/admin/users/${solver.user.id}/role`)
      .set(bearer(adminToken))
      .send({ role: 'AUTHOR' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${base}/users/me`)
      .set(bearer(solver.accessToken))
      .expect(401);
    const audit = await request(app.getHttpServer())
      .get(`${base}/admin/audit`)
      .set(bearer(adminToken))
      .expect(200);
    expect(
      audit.body.find(
        (event: { action: string; targetId: string }) =>
          event.action === 'user.role' && event.targetId === solver.user.id,
      ),
    ).toMatchObject({
      actorId: admin.user.id,
      targetType: 'user',
      createdAt: expect.any(String),
    });
    expect(audit.body[0]).not.toHaveProperty('created_at');
    const users = await request(app.getHttpServer())
      .get(`${base}/admin/users`)
      .set(bearer(adminToken))
      .expect(200);
    expect(
      users.body.find((item: { id: string }) => item.id === solver.user.id),
    ).toMatchObject({ createdAt: expect.any(String) });
    expect(users.body[0]).not.toHaveProperty('created_at');
    await request(app.getHttpServer())
      .patch(`${base}/problems/${problemId}/status`)
      .set(bearer(authorToken))
      .send({ status: 'ARCHIVED' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`${base}/problems/version-${suffix}`)
      .expect(404);
  });

  afterAll(async () => {
    await closeApp(
      app,
      submissionId ? [`${submissionId}-1`, `${submissionId}-2`] : [],
    );
  });
});
