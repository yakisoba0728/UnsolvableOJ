import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import configured from '../src/database/data-source.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { EmailModule } from '../src/modules/email/email.module.js';
import { EmailService } from '../src/modules/email/email.service.js';
import { tokenHash, unseal } from '../src/modules/email/email-crypto.js';
import { configureHttp } from '../src/configure-http.js';

const secret = 'test-only-email-encryption-secret-at-least-32-characters';
describe('email consent and durable delivery (PostgreSQL + HTTP, simulated provider)', () => {
  let app: NestExpressApplication,
    db: DataSource,
    email: EmailService,
    config: ConfigService;
  let recipients: string[] = [];
  let transport: ReturnType<typeof vi.fn>;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              CORS_ORIGIN: 'http://localhost:4173',
              JWT_ACCESS_EXPIRES_IN: '15m',
              EMAIL_ENABLED: true,
              EMAIL_WORKER_ENABLED: false,
              EMAIL_API_KEY: 'test-never-send',
              EMAIL_FROM: 'test@example.com',
              EMAIL_APP_ORIGIN: 'https://judge.example.com',
              EMAIL_TOKEN_SECRET: secret,
            }),
          ],
        }),
        TypeOrmModule.forRoot(configured.options),
        AuthModule,
        EmailModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    email = app.get(EmailService);
    config = app.get(ConfigService);
  });
  beforeEach(() => {
    transport = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: randomUUID() }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', transport);
    config.set('EMAIL_ENABLED', true);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    if (recipients.length)
      await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [
        recipients,
      ]);
    recipients = [];
  });
  afterAll(async () => {
    await app?.close();
  });
  async function account() {
    const name = `mail_${randomUUID().slice(0, 8)}`;
    const a = await app.get(AuthService).register({
      email: `${name}@example.com`,
      username: name,
      password: 'test-password-123',
    });
    recipients.push(a.user.id);
    return a;
  }
  const get = (token: string) =>
    request(app.getHttpServer())
      .get('/api/v1/email/preferences')
      .auth(token, { type: 'bearer' });
  const post = (path: string, token?: string) => {
    const r = request(app.getHttpServer()).post(`/api/v1/email/${path}`);
    return token ? r.auth(token, { type: 'bearer' }) : r;
  };
  const prefs = (token: string, answer: boolean, accepted = false) =>
    request(app.getHttpServer())
      .patch('/api/v1/email/preferences')
      .auth(token, { type: 'bearer' })
      .send({ answer, accepted });
  async function verify(a: Awaited<ReturnType<typeof account>>) {
    await post('verification/request', a.accessToken).send({}).expect(201);
    const [job] = await db.query(
      "SELECT * FROM email_outbox WHERE user_id=$1 AND kind='VERIFY'",
      [a.user.id],
    );
    const payload = unseal<{ text: string }>(job.encrypted_payload, secret);
    const token = payload.text.split('#token=')[1];
    await post('verification/confirm', a.accessToken)
      .send({ token })
      .expect(201);
    return token;
  }
  async function notification(
    a: Awaited<ReturnType<typeof account>>,
    kind = 'ANSWER',
  ) {
    const actor = await account();
    const [p] = await db.query(
      "INSERT INTO community_posts(author_id,category,title,body) VALUES($1,'QUESTION','private content should not be emailed','body') RETURNING id",
      [a.user.id],
    );
    const [c] = await db.query(
      "INSERT INTO community_comments(post_id,author_id,body) VALUES($1,$2,'answer body') RETURNING id",
      [p.id, actor.user.id],
    );
    if (kind === 'ACCEPTED')
      await db.query(
        'UPDATE community_posts SET accepted_comment_id=$2 WHERE id=$1',
        [p.id, c.id],
      );
    const [n] = await db.query(
      'INSERT INTO notifications(user_id,type,actor_id,post_id,comment_id) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [a.user.id, kind, actor.user.id, p.id, c.id],
    );
    return { postId: p.id, commentId: c.id, notificationId: n.id };
  }
  async function tick() {
    await db.query(
      "UPDATE email_delivery_clock SET last_attempt_at=clock_timestamp()-interval '5 seconds'",
    );
    await email.tick();
  }
  async function atEmailClock<T>(at: Date, run: () => Promise<T>) {
    const create = db.createQueryRunner.bind(db);
    const spy = vi.spyOn(db, 'createQueryRunner').mockImplementation((mode) => {
      const runner = create(mode);
      const query = runner.query.bind(runner) as typeof runner.query;
      vi.spyOn(runner, 'query').mockImplementation(
        (sql: string, parameters?: unknown[], structured?: boolean) => {
          const timed = sql.replaceAll(
            'clock_timestamp()',
            `'${at.toISOString()}'::timestamptz`,
          );
          return structured
            ? query(timed, parameters, true)
            : query(timed, parameters);
        },
      );
      return runner;
    });
    try {
      return await run();
    } finally {
      spy.mockRestore();
    }
  }

  it('keeps the five-request quota across the rolling 24-hour boundary', async () => {
    const a = await account();
    const user = { id: a.user.id, role: a.user.role };
    const start = Date.now() - 25 * 3_600_000;
    const requestAt = (minutes: number) =>
      atEmailClock(new Date(start + minutes * 60_000), () =>
        email.requestVerification(user),
      );
    await requestAt(0);
    for (const minutes of [1380, 1382, 1384, 1386]) await requestAt(minutes);
    await requestAt(1441); // Only the first request has left the rolling window.
    await expect(requestAt(1443)).rejects.toThrow('하루 최대 5회');
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(['concurrent_idempotent_requests', 'resource_locked'])(
    'retries the provider transient 409 %s with the exact same body and key',
    async (name) => {
      const a = await account();
      await verify(a);
      await prefs(a.accessToken, true);
      await notification(a);
      transport.mockResolvedValueOnce(
        new Response(JSON.stringify({ name }), { status: 409 }),
      );
      await tick();
      await db.query(
        "UPDATE email_outbox SET next_attempt_at=clock_timestamp() WHERE user_id=$1 AND state='pending'",
        [a.user.id],
      );
      await tick();
      expect(transport).toHaveBeenCalledTimes(2);
      const first = transport.mock.calls[0] as unknown as [string, RequestInit];
      const second = transport.mock.calls[1] as unknown as [
        string,
        RequestInit,
      ];
      expect(second[1].body).toBe(first[1].body);
      expect(second[1].headers).toEqual(first[1].headers);
    },
  );

  it('keeps a mismatching-idempotency 409 permanently failed', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    transport.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'invalid_idempotent_request' }), {
        status: 409,
      }),
    );
    await tick();
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    const [job] = await db.query(
      "SELECT state FROM email_outbox WHERE user_id=$1 AND kind='ANSWER'",
      [a.user.id],
    );
    expect(job.state).toBe('dead');
  });

  it('allows partial opt-out and unchanged consent while mail is disabled', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true, true);
    config.set('EMAIL_ENABLED', false);
    await prefs(a.accessToken, true, true).expect(200);
    await prefs(a.accessToken, false, true).expect(200);
    await prefs(a.accessToken, true, true).expect(400);
    await prefs(a.accessToken, false, false).expect(200);
  });

  it('requires auth, defaults opt-out, blocks unverified opt-in and forged fields', async () => {
    await get('bad').expect(401);
    const a = await account();
    await get(a.accessToken)
      .expect(200)
      .expect((r) =>
        expect(r.body).toEqual({
          verified: false,
          answer: false,
          accepted: false,
          enabled: true,
        }),
      );
    await prefs(a.accessToken, true).expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/email/preferences')
      .auth(a.accessToken, { type: 'bearer' })
      .send({ answer: false, accepted: false, userId: randomUUID() })
      .expect(400);
  });
  it('verification is bound to account, expires, is single-use and does not auto opt-in', async () => {
    const a = await account(),
      b = await account();
    await post('verification/request', a.accessToken).send({}).expect(201);
    const [job] = await db.query(
      'SELECT encrypted_payload FROM email_outbox WHERE user_id=$1',
      [a.user.id],
    );
    const raw = unseal<{ text: string }>(
      job.encrypted_payload,
      secret,
    ).text.split('#token=')[1];
    expect(job.encrypted_payload).not.toContain(raw);
    await post('verification/confirm', b.accessToken)
      .send({ token: raw })
      .expect(400);
    await post('verification/confirm', a.accessToken)
      .send({ token: raw })
      .expect(201);
    await post('verification/confirm', a.accessToken)
      .send({ token: raw })
      .expect(400);
    await get(a.accessToken)
      .expect(200)
      .expect((r) =>
        expect(r.body).toMatchObject({ verified: true, answer: false }),
      );
    expect(transport).not.toHaveBeenCalled();
    const token = 'x'.repeat(43);
    await db.query(
      "INSERT INTO email_tokens(token_hash,user_id,purpose,email,expires_at) VALUES($1,$2,'VERIFY',$3,clock_timestamp()-interval '1 second')",
      [tokenHash(token), b.user.id, b.user.email],
    );
    await post('verification/confirm', b.accessToken)
      .send({ token })
      .expect(400);
  });
  it('persists verification cooldown and cancels replaced tokens/jobs', async () => {
    const a = await account();
    await post('verification/request', a.accessToken).send({}).expect(201);
    await post('verification/request', a.accessToken).send({}).expect(400);
    await db.query(
      "UPDATE email_request_limits SET last_requested_at=clock_timestamp()-interval '2 minutes'",
    );
    await post('verification/request', a.accessToken).send({}).expect(201);
    const jobs = await db.query(
      'SELECT state,encrypted_payload FROM email_outbox WHERE user_id=$1 ORDER BY created_at',
      [a.user.id],
    );
    expect(jobs[0]).toEqual({ state: 'cancelled', encrypted_payload: null });
    expect(jobs[1].state).toBe('pending');
    await tick();
    expect(transport).toHaveBeenCalledOnce();
  });
  it('does not backfill old notifications on opt-in; ignores self actions', async () => {
    const a = await account();
    await verify(a);
    await notification(a);
    await prefs(a.accessToken, true);
    await db.query(
      "INSERT INTO notifications(user_id,type,actor_id) VALUES($1,'ANSWER',$1)",
      [a.user.id],
    );
    await tick();
    expect(transport).not.toHaveBeenCalled();
  });
  it('queues and sends once, encrypts payload and provides explicit unsubscribe', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await db.query(
      "UPDATE email_delivery_clock SET last_attempt_at=clock_timestamp()-interval '5 seconds'",
    );
    await Promise.all([email.tick(), new EmailService(db, config).tick()]);
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    const [url, options] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.resend.com/emails');
    const payload = JSON.parse(options.body as string);
    expect(payload.to).toEqual([a.user.email]);
    expect(payload.text).not.toContain('private content');
    const raw = payload.text.split('/email/unsubscribe#token=')[1];
    await request(app.getHttpServer())
      .get(`/api/v1/email/unsubscribe?token=${raw}`)
      .expect(404);
    await get(a.accessToken)
      .expect(200)
      .expect((r) => expect(r.body.answer).toBe(true));
    await post('unsubscribe').send({ token: raw }).expect(201);
    await post('unsubscribe').send({ token: raw }).expect(201);
    await post('unsubscribe')
      .send({ token: 'x'.repeat(43) })
      .expect(201);
    await get(a.accessToken)
      .expect(200)
      .expect((r) => expect(r.body.answer).toBe(false));
    const [sent] = await db.query(
      "SELECT encrypted_payload FROM email_outbox WHERE user_id=$1 AND state='sent'",
      [a.user.id],
    );
    expect(sent.encrypted_payload).toBeNull();
  });
  it('rechecks opt-out even after preparing, and old consent cannot revive after opt-out/opt-in', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await prefs(a.accessToken, false);
    await prefs(a.accessToken, true);
    // Simulate an INSERT transaction that committed its old consent snapshot late.
    const [p] = await db.query(
      'SELECT answer_version AS version FROM email_preferences WHERE user_id=$1',
      [a.user.id],
    );
    const n = await notification(a);
    await db.query(
      'UPDATE email_outbox SET consent_version=$2 WHERE notification_id=$1',
      [n.notificationId, Number(p.version) - 2],
    );
    await tick();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(['hidden', 'deleted', 'unaccepted'])(
    'rechecks source eligibility: %s',
    async (mode) => {
      const a = await account();
      await verify(a);
      await prefs(a.accessToken, true, true);
      const n = await notification(
        a,
        mode === 'unaccepted' ? 'ACCEPTED' : 'ANSWER',
      );
      if (mode === 'hidden')
        await db.query(
          'UPDATE community_posts SET hidden_at=clock_timestamp() WHERE id=$1',
          [n.postId],
        );
      if (mode === 'deleted')
        await db.query('DELETE FROM community_comments WHERE id=$1', [
          n.commentId,
        ]);
      if (mode === 'unaccepted')
        await db.query(
          'UPDATE community_posts SET accepted_comment_id=NULL WHERE id=$1',
          [n.postId],
        );
      await tick();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it('retries unknown transport outcomes with identical provider body and key', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    transport.mockRejectedValueOnce(new Error('simulated timeout'));
    await tick();
    await db.query(
      "UPDATE email_outbox SET next_attempt_at=clock_timestamp() WHERE user_id=$1 AND state='pending'",
      [a.user.id],
    );
    await tick();
    expect(transport).toHaveBeenCalledTimes(2);
    const first = transport.mock.calls[0] as unknown as [string, RequestInit];
    const next = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(first[1].body).toBe(next[1].body);
    expect(first[1].headers).toEqual(next[1].headers);
  });
  it('never retries after the idempotency horizon, permanent rejection, or suspension', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await db.query(
      "UPDATE email_outbox SET first_attempt_at=clock_timestamp()-interval '24 hours' WHERE user_id=$1 AND state='pending'",
      [a.user.id],
    );
    await tick();
    expect(transport).not.toHaveBeenCalled();
    await notification(a);
    transport.mockResolvedValueOnce(new Response('{}', { status: 422 }));
    await tick();
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    await notification(a);
    await db.query(
      'UPDATE users SET suspended_at=clock_timestamp() WHERE id=$1',
      [a.user.id],
    );
    await tick();
    expect(transport).toHaveBeenCalledOnce();
  });
  it('withdrawal erases queued addresses/tokens/preferences and blocks old account access', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await request(app.getHttpServer())
      .delete('/api/v1/auth/account')
      .auth(a.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'test-password-123', confirmation: '회원 탈퇴' })
      .expect(204);
    for (const table of ['email_outbox', 'email_tokens', 'email_preferences']) {
      const rows = await db.query(`SELECT * FROM ${table} WHERE user_id=$1`, [
        a.user.id,
      ]);
      expect(rows).toHaveLength(0);
    }
    await tick();
    expect(transport).not.toHaveBeenCalled();
    await get(a.accessToken).expect(401);
  });
  it('mail disabled remains truthful and allows disabling previously enabled preferences', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    config.set('EMAIL_ENABLED', false);
    await post('verification/request', a.accessToken).send({}).expect(503);
    await prefs(a.accessToken, true, true).expect(400);
    await prefs(a.accessToken, false).expect(200);
    await tick();
    expect(transport).not.toHaveBeenCalled();
  });
  it('saving unchanged consent does not drop pending mail', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await prefs(a.accessToken, true);
    await tick();
    expect(transport).toHaveBeenCalledOnce();
  });
  it('changing the accepted preference does not discard pending answer mail', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true, false);
    await notification(a);
    await prefs(a.accessToken, true, true);
    await tick();
    expect(transport).toHaveBeenCalledOnce();
  });
  it('sends accepted-answer email independently of the answer preference', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, false, true);
    await notification(a, 'ANSWER');
    await notification(a, 'ACCEPTED');
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    const [, options] = transport.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(options.body as string).subject).toBe(
      '못풀준 답변 채택 알림',
    );
    const pending = await db.query(
      "SELECT kind FROM email_outbox WHERE user_id=$1 AND state='pending'",
      [a.user.id],
    );
    expect(pending).toEqual([]);
  });
  it('recipient verification limits survive withdrawal and re-registration', async () => {
    const a = await account();
    await post('verification/request', a.accessToken).send({}).expect(201);
    await request(app.getHttpServer())
      .delete('/api/v1/auth/account')
      .auth(a.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'test-password-123', confirmation: '회원 탈퇴' })
      .expect(204);
    const replacement = await app.get(AuthService).register({
      email: a.user.email,
      username: a.user.username,
      password: 'test-password-123',
    });
    recipients.push(replacement.user.id);
    await post('verification/request', replacement.accessToken)
      .send({})
      .expect(400);
  });
  it('a lost database receipt cannot change the persisted body or provider dedupe key', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    await db.query(`CREATE FUNCTION test_lost_mail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.state='sent' THEN RAISE EXCEPTION 'simulated receipt failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_lost_mail_receipt BEFORE UPDATE ON email_outbox FOR EACH ROW EXECUTE FUNCTION test_lost_mail_receipt();`);
    try {
      await expect(tick()).rejects.toThrow();
    } finally {
      await db.query(
        'DROP TRIGGER test_lost_mail_receipt ON email_outbox; DROP FUNCTION test_lost_mail_receipt();',
      );
    }
    expect(transport).toHaveBeenCalledOnce();
    await db.query(
      "UPDATE email_outbox SET lease_until=clock_timestamp()-interval '1 second' WHERE user_id=$1 AND state='pending'",
      [a.user.id],
    );
    await db.query(
      "UPDATE email_delivery_clock SET last_attempt_at=clock_timestamp()-interval '5 seconds'",
    );
    await new EmailService(db, config).tick();
    expect(transport).toHaveBeenCalledTimes(2);
    const first = transport.mock.calls[0] as unknown as [string, RequestInit];
    const next = transport.mock.calls[1] as unknown as [string, RequestInit];
    expect(first[1].body).toBe(next[1].body);
    expect(first[1].headers).toEqual(next[1].headers);
  });
  it('a send already in progress finishes before withdrawal, and no later mail survives', async () => {
    const a = await account();
    await verify(a);
    await prefs(a.accessToken, true);
    await notification(a);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    transport.mockImplementationOnce(async () => {
      entered();
      await gate;
      return new Response(JSON.stringify({ id: randomUUID() }), {
        status: 200,
      });
    });
    const sending = tick();
    await reached;
    const withdrawing = request(app.getHttpServer())
      .delete('/api/v1/auth/account')
      .auth(a.accessToken, { type: 'bearer' })
      .send({ currentPassword: 'test-password-123', confirmation: '회원 탈퇴' })
      .expect(204)
      .then((r) => r);
    release();
    await Promise.all([sending, withdrawing]);
    await tick();
    expect(transport).toHaveBeenCalledOnce();
    const jobs = await db.query('SELECT * FROM email_outbox WHERE user_id=$1', [
      a.user.id,
    ]);
    expect(jobs).toHaveLength(0);
  });
});
