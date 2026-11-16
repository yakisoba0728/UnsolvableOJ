import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('assessment submission metadata belongs to the submitted version', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let candidate: string;
  let outsider: string;
  const jobs: string[] = [];
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = (await register(app, 'metadata_owner', suffix)).accessToken;
    candidate = (await register(app, 'metadata_candidate', suffix)).accessToken;
    outsider = (await register(app, 'metadata_outsider', suffix)).accessToken;
  });
  afterAll(() => closeApp(app, jobs));

  it('does not disclose a later private title through queued or judged submission detail', async () => {
    const slug = `pinned-submission-${suffix}`;
    const pinnedTitle = `Selected title ${suffix}`;
    const futureTitle = `PRIVATE_FUTURE_TITLE_${suffix}`;
    const created = await http().post(`${base}/problems`).set(bearer(owner)).send({
      slug, title: pinnedTitle, statementMarkdown: 'Selected statement',
      inputDescriptionMarkdown: '', outputDescriptionMarkdown: '', difficulty: 'BEGINNER',
      isPrivate: true, editorialMarkdown: 'STAFF_ONLY_EDITORIAL', timeLimitMs: 1000, memoryLimitMb: 128,
      testCases: [
        { input: 'public input', expectedOutput: 'public answer', isSample: true },
        { input: 'PRIVATE_CASE_INPUT', expectedOutput: 'PRIVATE_CASE_ANSWER', isSample: false },
      ],
    }).expect(201);
    const problemId = created.body.id as string;
    const selected = await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'Metadata boundary', startsAt: new Date(Date.now() - 60_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 30, problemIds: [problemId],
    }).expect(201);
    await http().patch(`${base}/problems/${problemId}`).set(bearer(owner))
      .send({ title: futureTitle, statementMarkdown: 'PRIVATE_FUTURE_STATEMENT' }).expect(200);
    const started = await http().post(`${base}/enterprise/join/${selected.body.inviteCode}/start`)
      .set(bearer(candidate)).expect(201);
    const submitted = await http().post(`${base}/enterprise/attempts/${started.body.id}/problems/${problemId}/submissions`)
      .set(bearer(candidate)).send({ language: 'PYTHON', sourceCode: 'print(1)' }).expect(202);
    const submissionId = submitted.body.id as string;
    jobs.push(`${submissionId}-1`);
    expect(submitted.body.problemVersion).toBe(1);

    const endpoint = `${base}/submissions/${submissionId}`;
    await http().get(endpoint).set(bearer(outsider)).expect(404);
    for (const status of ['QUEUED', 'WRONG_ANSWER']) {
      if (status === 'WRONG_ANSWER') {
        await db.query(`UPDATE submissions SET status='WRONG_ANSWER', debug_outputs=$2::jsonb,
          passed_test_cases=0, total_test_cases=2 WHERE id=$1`, [submissionId, JSON.stringify([
          { testCase: 1, isSample: true, stdout: '1', stderr: '', status: 'WRONG_ANSWER' },
        ])]);
      }
      for (const token of [candidate, owner]) {
        const detail = await http().get(endpoint).set(bearer(token)).expect(200);
        expect(detail.body).toMatchObject({ status, problemVersion: 1, problem: { id: problemId, slug, title: pinnedTitle } });
        expect(detail.body.sampleTestCases).toEqual(status === 'QUEUED' ? [] : [
          { testCase: 1, input: 'public input', expectedOutput: 'public answer' },
        ]);
        for (const secret of [futureTitle, 'PRIVATE_FUTURE_STATEMENT', 'PRIVATE_CASE_INPUT', 'PRIVATE_CASE_ANSWER', 'STAFF_ONLY_EDITORIAL'])
          expect(JSON.stringify(detail.body)).not.toContain(secret);
      }
    }
    // Assessment submissions remain outside the candidate's public learning list.
    const mine = await http().get(`${base}/submissions`).set(bearer(candidate)).expect(200);
    expect(mine.body.items).toEqual([]);
  });
});
