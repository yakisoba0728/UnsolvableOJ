import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { newEmailToken, tokenHash } from '../src/modules/email/email-crypto.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('verified invitations and snapshot-authoritative judge details', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const suffix = randomUUID().slice(0, 8);
  const jobIds: string[] = [];
  type Account = {
    accessToken: string;
    user: { id: string; username: string; email: string };
  };
  let owner: Account;
  const http = () => request(app.getHttpServer());
  const verify = async (account: Account) => {
    // Seed a disposable delivery token and exercise the real verification endpoint.
    // No outbound message or real mailbox is used.
    const token = newEmailToken();
    await db.query(
      "INSERT INTO email_tokens(token_hash,user_id,purpose,email,expires_at) VALUES($1,$2,'VERIFY',$3,clock_timestamp()+interval '1 hour')",
      [tokenHash(token), account.user.id, account.user.email],
    );
    await http()
      .post(`${base}/email/verification/confirm`)
      .set(bearer(account.accessToken))
      .send({ token })
      .expect(201);
  };
  const testFor = async (invitees: string[]) =>
    (
      await http()
        .post(`${base}/enterprise/tests`)
        .set(bearer(owner.accessToken))
        .send({
          title: 'Invitation boundary fixture',
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          durationMin: 30,
          problemIds: [],
          vibeChallengeIds: ['post-search-v1'],
          inviteOnly: true,
          invitees,
        })
        .expect(201)
    ).body as { id: string; inviteCode: string };

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    owner = await register(app, 'sec_owner', suffix);
  });
  afterAll(() => closeApp(app, jobIds));

  it('requires successful email verification before accepting an email invitation', async () => {
    const account = await register(app, 'sec_email', suffix);
    const test = await testFor([account.user.email.toUpperCase()]);
    const url = `${base}/enterprise/join/${test.inviteCode}`;
    await http().get(url).set(bearer(account.accessToken)).expect(404);
    await http()
      .post(`${url}/start`)
      .set(bearer(account.accessToken))
      .expect(404);
    await verify(account);
    await http().get(url).set(bearer(account.accessToken)).expect(200);
    await http()
      .post(`${url}/start`)
      .set(bearer(account.accessToken))
      .expect(201);
  });

  it('preserves explicit username invitations and conceals the test from unrelated users', async () => {
    const named = await register(app, 'sec_named', suffix);
    const other = await register(app, 'sec_other', suffix);
    const test = await testFor([named.user.username.toUpperCase()]);
    const url = `${base}/enterprise/join/${test.inviteCode}`;
    await http().get(url).set(bearer(named.accessToken)).expect(200);
    await http()
      .post(`${url}/start`)
      .set(bearer(named.accessToken))
      .expect(201);
    await verify(other);
    await http().get(url).set(bearer(other.accessToken)).expect(404);
    await http().get(url).set(bearer(owner.accessToken)).expect(200);
  });

  it('rechecks mailbox verification when opening an existing attempt or project', async () => {
    const account = await register(app, 'sec_recheck', suffix);
    await verify(account);
    const test = await testFor([account.user.email]);
    const started = await http()
      .post(`${base}/enterprise/join/${test.inviteCode}/start`)
      .set(bearer(account.accessToken))
      .expect(201);
    await db.query('UPDATE users SET email_verified_at=NULL WHERE id=$1', [
      account.user.id,
    ]);
    await http()
      .get(`${base}/enterprise/attempts/${started.body.id}`)
      .set(bearer(account.accessToken))
      .expect(404);
    await http()
      .post(
        `${base}/enterprise/attempts/${started.body.id}/vibe/post-search-v1`,
      )
      .set(bearer(account.accessToken))
      .expect(404);
  });

  it('keeps private diagnostic content out of stored results and owner responses using the submitted version', async () => {
    const created = await http()
      .post(`${base}/problems`)
      .set(bearer(owner.accessToken))
      .send({
        slug: `sec-case-${suffix}`,
        title: 'Diagnostic fixture',
        statementMarkdown: 'test',
        inputDescriptionMarkdown: 'input',
        outputDescriptionMarkdown: 'output',
        difficulty: 'BEGINNER',
        testCases: [
          {
            input: 'hidden input',
            expectedOutput: 'hidden expected',
            isSample: false,
          },
          {
            input: 'sample input',
            expectedOutput: 'sample expected',
            isSample: true,
          },
        ],
      })
      .expect(201);
    const submitted = await http()
      .post(`${base}/problems/${created.body.id}/submissions`)
      .set(bearer(owner.accessToken))
      .send({ language: 'PYTHON', sourceCode: 'print(0)' })
      .expect(202);
    const id = submitted.body.id as string;
    jobIds.push(`${id}-1`);
    // Editing the current problem must not redefine visibility for this submission.
    await http()
      .patch(`${base}/problems/${created.body.id}`)
      .set(bearer(owner.accessToken))
      .send({
        testCases: [
          {
            input: 'new public input',
            expectedOutput: 'new public expected',
            isSample: true,
          },
          {
            input: 'new hidden input',
            expectedOutput: 'new hidden expected',
            isSample: false,
          },
        ],
      })
      .expect(200);
    const headers = {
      'X-Judge-Token': 'test-judge-token-with-at-least-32-characters',
      'X-Judge-Generation': '1',
      'X-Judge-Attempt': randomUUID(),
    };
    await http()
      .get(`${base}/internal/judge/submissions/${id}`)
      .set(headers)
      .expect(200);
    const diagnostics = (testCase: number, stdout: string) => ({
      testCase,
      stdout,
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
    });
    const returned = await http()
      .patch(`${base}/internal/judge/submissions/${id}/result`)
      .set(headers)
      .send({
        status: 'WRONG_ANSWER',
        passedTestCases: 0,
        totalTestCases: 2,
        debugOutputs: [
          diagnostics(1, 'private-diagnostic-marker'),
          diagnostics(2, 'public trace'),
        ],
        testResults: [
          {
            testCase: 1,
            isSample: true,
            status: 'WRONG_ANSWER',
            runtimeMs: 1,
            memoryKb: 1,
          },
          {
            testCase: 2,
            isSample: false,
            status: 'WRONG_ANSWER',
            runtimeMs: 1,
            memoryKb: 1,
          },
        ],
      })
      .expect(200);
    expect(returned.body.status).toBe('WRONG_ANSWER');
    const detail = await http()
      .get(`${base}/submissions/${id}`)
      .set(bearer(owner.accessToken))
      .expect(200);
    expect(detail.body.debugOutputs).toEqual([diagnostics(2, 'public trace')]);
    expect(detail.body.testResults.map((item: { isSample: boolean }) => item.isSample)).toEqual([false, true]);
    expect(JSON.stringify(detail.body)).not.toContain(
      'private-diagnostic-marker',
    );
    expect(detail.body.sampleTestCases).toEqual([
      { testCase: 2, input: 'sample input', expectedOutput: 'sample expected' },
    ]);
    const [stored] = await db.query(
      'SELECT debug_outputs FROM submissions WHERE id=$1',
      [id],
    );
    expect(stored.debug_outputs).toEqual([diagnostics(2, 'public trace')]);
  });
});
