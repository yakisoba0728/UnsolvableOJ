import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import request from 'supertest';
import configured from '../src/database/data-source.js';
import { AuthModule } from '../src/modules/auth/auth.module.js';
import { UsersModule } from '../src/modules/users/users.module.js';
import { MissionsModule } from '../src/modules/missions/missions.module.js';
import { configureHttp } from '../src/configure-http.js';
import { MissionsService } from '../src/modules/missions/missions.service.js';
import { Missions1793000000000 } from '../src/database/migrations/1793000000000-missions.js';
import { analysisCatalog } from '../src/modules/missions/analysis-catalog.js';
import { DAY, periods } from '../src/modules/missions/mission-policy.js';

describe('missions (real PostgreSQL transactions and HTTP)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let service: MissionsService;
  let userId: string;
  let token: string;
  const users: string[] = [];
  let now: Date;
  let problemId: string;
  beforeAll(async () => {
    // Real auth, DTO validation, controllers and PostgreSQL; no judge/Redis process is needed.
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              CORS_ORIGIN: 'http://localhost:4173',
              JWT_ACCESS_EXPIRES_IN: '15m',
            }),
          ],
        }),
        TypeOrmModule.forRoot(configured.options),
        AuthModule,
        UsersModule,
        MissionsModule,
      ],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    configureHttp(app);
    await app.init();
    db = app.get(DataSource);
    service = app.get(MissionsService);
  });
  beforeEach(async () => {
    const suffix = randomUUID().slice(0, 8);
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({
        email: `mission-${suffix}@example.com`,
        username: `mission_${suffix}`,
        password: 'test-password-123',
      })
      .expect(201);
    userId = res.body.user.id;
    token = res.body.accessToken;
    users.push(userId);
    [{ now }] = await db.query('SELECT clock_timestamp() AS now');
    const [p] = await db.query(
      `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
      VALUES($1,'Mission test','Test','BEGINNER','PUBLISHED',$2) RETURNING id`,
      [`mission-${suffix}`, userId],
    );
    problemId = p.id;
  });
  afterAll(async () => {
    for (const id of users) {
      await db.query('DELETE FROM submissions WHERE user_id=$1', [id]);
    }
    for (const id of users) {
      await db.query('DELETE FROM problems WHERE author_id=$1', [id]);
      await db.query('DELETE FROM users WHERE id=$1', [id]);
    }
    await app?.close();
  });
  const list = () => service.list(userId);
  async function analysisReady() {
    for (const q of analysisCatalog.slice(0, 5))
      await service.answer(userId, q.id, q.answer);
    return (await list()).items.find((m) => m.id === 'analysis')!;
  }
  async function submit(
    at: Date,
    status = 'ACCEPTED',
    problem = problemId,
    accepted = false,
  ) {
    const [s] = await db.query(
      `INSERT INTO submissions(user_id,problem_id,language,source_code,status,created_at,accepted_for_xp)
      VALUES($1,$2,'C','int main() {return 0;}',$3,$4,$5) RETURNING id`,
      [userId, problem, status, at, accepted],
    );
    return s.id as string;
  }
  it('requires authentication and ignores other accounts for all progress', async () => {
    await request(app.getHttpServer()).get('/api/v1/missions').expect(401);
    const dashboard = await list();
    expect(dashboard.items).toHaveLength(7);
    expect(dashboard.items.every((m) => m.current === 0)).toBe(true);
    expect(dashboard.timezone).toBe('Asia/Seoul');
  });
  it('refuses rollback with reward records and leaves balances and receipts intact', async () => {
    const mission = await analysisReady();
    await service.claim(userId, mission.stateId);
    const runner = db.createQueryRunner();
    await runner.connect(); await runner.startTransaction();
    try {
      await expect(new Missions1793000000000().down(runner)).rejects.toThrow('Cannot roll back populated missions');
    } finally {
      await runner.rollbackTransaction(); await runner.release();
    }
    const receipt = await service.claim(userId, mission.stateId);
    expect(receipt.xp).toBe(80); expect(receipt.alreadyClaimed).toBe(true);
  });
  it('serializes concurrent first visits and creates exactly one state per period', async () => {
    const pages = await Promise.all(Array.from({ length: 8 }, list));
    expect(new Set(pages.map((p) => p.items[0].stateId)).size).toBe(1);
    const [{ n }] = await db.query(
      'SELECT count(*)::int AS n FROM mission_states WHERE user_id=$1',
      [userId],
    );
    expect(n).toBe(7);
  });
  it('rejects unearned, invalid, missing and another account reward IDs', async () => {
    const mission = (await list()).items[0];
    await request(app.getHttpServer())
      .post(`/api/v1/missions/${mission.stateId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/v1/missions/not-a-uuid/claim')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    await expect(service.claim(userId, randomUUID())).rejects.toThrow(
      '미션을 찾을',
    );
    await expect(
      service.claim(
        users[0] === userId ? randomUUID() : users[0],
        mission.stateId,
      ),
    ).rejects.toThrow('미션을 찾을');
  });
  it('checks analysis IDs and choices on the server, never accepts supplied correctness/user/date', async () => {
    const root = '/api/v1/missions/analysis';
    for (const body of [
      { selected: 4 },
      { selected: -1 },
      { selected: 0.5 },
      { selected: '0' },
      { selected: 0, correct: true },
      { selected: 0, userId: 'other' },
      { selected: 0, at: '2020-01-01' },
    ]) {
      await request(app.getHttpServer())
        .post(`${root}/slice/attempts`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post(`${root}/unknown/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ selected: 0 })
      .expect(404);
    const r = await request(app.getHttpServer())
      .post(`${root}/slice/attempts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ selected: 0 })
      .expect(201);
    expect(r.body.correct).toBe(false);
    await service.answer(userId, 'slice', 2);
    await service.answer(userId, 'slice', 0);
    expect(await service.attempts(userId)).toEqual([
      expect.objectContaining({
        questionId: 'slice',
        correct: false,
        solved: true,
        selected: 0,
      }),
    ]);
    expect((await list()).items.find((m) => m.id === 'analysis')?.current).toBe(
      1,
    );
  });
  it('awards once under concurrent claims, preserves existing XP and persists across new service instances', async () => {
    await db.query('UPDATE users SET xp=90 WHERE id=$1', [userId]);
    const mission = await analysisReady();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.claim(userId, mission.stateId)),
    );
    expect(results.filter((r) => !r.alreadyClaimed)).toHaveLength(1);
    expect(results.every((r) => r.xp === 170 && r.level === 2)).toBe(true);
    const fresh = new MissionsService(db);
    expect(
      (await fresh.list(userId)).items.find((m) => m.id === 'analysis')
        ?.claimedAt,
    ).toBeTruthy();
    expect((await fresh.claim(userId, mission.stateId)).alreadyClaimed).toBe(
      true,
    );
    expect((await list()).season.done).toBe(1);
  });
  it('rolls back claim, XP and badge together when a reward write fails', async () => {
    const mission = await analysisReady();
    await db.query('UPDATE users SET xp=2147483647 WHERE id=$1', [userId]);
    await expect(service.claim(userId, mission.stateId)).rejects.toThrow();
    const [state] = await db.query(
      'SELECT claimed_at FROM mission_states WHERE id=$1',
      [mission.stateId],
    );
    expect(state.claimed_at).toBeNull();
    await db.query('UPDATE users SET xp=0 WHERE id=$1', [userId]);
    expect((await service.claim(userId, mission.stateId)).alreadyClaimed).toBe(
      false,
    );
  });
  it('rejects stale periods but keeps old receipt retries idempotent', async () => {
    const mission = await analysisReady();
    await db.query(
      "UPDATE mission_states SET period_key='2000-01-01' WHERE id=$1",
      [mission.stateId],
    );
    await expect(service.claim(userId, mission.stateId)).rejects.toThrow(
      '기간이 끝났',
    );
    const current = await analysisReady();
    await service.claim(userId, current.stateId);
    await db.query(
      "UPDATE mission_states SET period_key='2000-01-02' WHERE id=$1",
      [current.stateId],
    );
    expect((await service.claim(userId, current.stateId)).alreadyClaimed).toBe(
      true,
    );
  });
  it('counts distinct accepted problems, not repeated submissions; respects retained rejudge evidence', async () => {
    await submit(new Date(now.getTime() - 1000));
    await submit(new Date(now.getTime() - 900));
    expect((await list()).items.find((m) => m.id === 'daily')?.current).toBe(1);
    await db.query(
      "UPDATE submissions SET status='JUDGING',accepted_for_xp=true WHERE user_id=$1",
      [userId],
    );
    expect((await list()).items.find((m) => m.id === 'daily')?.current).toBe(1);
    await db.query(
      "UPDATE submissions SET status='WRONG_ANSWER',accepted_for_xp=false WHERE user_id=$1",
      [userId],
    );
    expect((await list()).items.find((m) => m.id === 'daily')?.current).toBe(0);
  });
  it('revalidates community completions before claiming, but never claws back an issued achievement', async () => {
    for (let i = 0; i < 2; i++)
      await db.query(
        "INSERT INTO community_posts(author_id,category,title,body) VALUES($1,'SOLUTION','풀이','설명')",
        [userId],
      );
    const mission = (await list()).items.find((m) => m.id === 'community')!;
    expect(mission.completedAt).toBeTruthy();
    await db.query(
      "UPDATE community_posts SET category='FREE' WHERE author_id=$1",
      [userId],
    );
    await expect(service.claim(userId, mission.stateId)).rejects.toThrow(
      '아직',
    );
    await db.query(
      "UPDATE community_posts SET category='SOLUTION' WHERE author_id=$1",
      [userId],
    );
    await service.claim(userId, mission.stateId);
    await db.query('DELETE FROM community_posts WHERE author_id=$1', [userId]);
    expect((await service.claim(userId, mission.stateId)).xp).toBe(150);
  });
  it('grants the streak XP and unique badge once per continuous run', async () => {
    const start = periods(now).start;
    for (let i = 1; i <= 7; i++)
      await submit(new Date(start.getTime() - i * DAY + 1000), 'WRONG_ANSWER');
    const mission = (await list()).items.find((m) => m.id === 'streak')!;
    expect(mission.current).toBe(7);
    const receipt = await service.claim(userId, mission.stateId);
    expect(receipt.badges.map((b) => b.badge)).toContain('seven-day-streak');
    await submit(new Date(now.getTime() - 1));
    expect((await list()).items.find((m) => m.id === 'streak')?.stateId).toBe(
      mission.stateId,
    );
    expect((await service.claim(userId, mission.stateId)).xp).toBe(120);
    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.badges).toHaveLength(1);
  });
  it('persists a daily bonus assignment and only awards its first-solve bonus', async () => {
    const bonus = (await list()).items.find((m) => m.id === 'bonus')!;
    const [state] = await db.query(
      'SELECT problem_id FROM mission_states WHERE id=$1',
      [bonus.stateId],
    );
    expect((await list()).items.find((m) => m.id === 'bonus')?.stateId).toBe(
      bonus.stateId,
    );
    const submissionId = await submit(
      new Date(now.getTime() - 1),
      'ACCEPTED',
      state.problem_id,
    );
    await db.query(
      'INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp) VALUES($1,$2,$3,10)',
      [userId, state.problem_id, submissionId],
    );
    expect(
      (await service.claim(userId, bonus.stateId)).awardedXp,
    ).toBeGreaterThan(0);
    expect(
      (await list()).items.find((m) => m.id === 'bonus')?.claimedAt,
    ).toBeTruthy();
  });
  it('counts Korean night submissions only and awards a single badge without adding XP', async () => {
    const start = periods(now).start;
    for (let i = 0; i < 3; i++)
      await submit(new Date(start.getTime() + i), 'WRONG_ANSWER');
    await submit(new Date(start.getTime() + 6 * 60 * 60 * 1000), 'ACCEPTED');
    await submit(new Date(start.getTime() - 1), 'ACCEPTED');
    await submit(new Date(start.getTime() + 1), 'SYSTEM_ERROR');
    await submit(new Date(start.getTime() + 1), 'QUEUED');
    const mission = (await list()).items.find((m) => m.id === 'night')!;
    expect(mission.current).toBe(3);
    const results = await Promise.all([
      service.claim(userId, mission.stateId),
      service.claim(userId, mission.stateId),
    ]);
    expect(results.every((r) => r.xp === 0)).toBe(true);
    expect(results[0].badges.map((b) => b.badge)).toEqual(['night-coder']);
  });
  it('uses the authenticated HTTP account for dashboard, claim and cross-session history', async () => {
    const mission = await analysisReady();
    await request(app.getHttpServer())
      .post(`/api/v1/missions/${mission.stateId}/claim`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    const res = await request(app.getHttpServer())
      .get('/api/v1/missions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      res.body.items.find((m: { id: string }) => m.id === 'analysis').claimedAt,
    ).toBeTruthy();
    const attempts = await request(app.getHttpServer())
      .get('/api/v1/missions/analysis/attempts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(attempts.body).toHaveLength(5);
  });
  it('claims daily and weekly rewards independently without lost concurrent XP writes', async () => {
    for (let i = 0; i < 10; i++) {
      const [p] = await db.query(
        `INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
        VALUES($1,'Daily test','Test','BEGINNER','PUBLISHED',$2) RETURNING id`,
        [randomUUID(), userId],
      );
      await submit(new Date(now.getTime() - 1), 'ACCEPTED', p.id);
    }
    const missions = (await list()).items.filter(
      (m) => m.id === 'daily' || m.id === 'weekly',
    );
    expect(missions.every((m) => m.status === 'done')).toBe(true);
    await Promise.all([
      ...missions.map((m) => service.claim(userId, m.stateId)),
      db.query('UPDATE users SET xp=xp+10, level=1+(xp+10)/100 WHERE id=$1', [
        userId,
      ]),
    ]);
    const [user] = await db.query('SELECT xp,level FROM users WHERE id=$1', [
      userId,
    ]);
    expect(user).toEqual({ xp: 360, level: 4 });
    // The existing judge reverses only its solve award, leaving mission rewards intact.
    await db.query(
      'UPDATE users SET xp=xp-10, level=1+(xp-10)/100 WHERE id=$1',
      [userId],
    );
    expect((await service.claim(userId, missions[0].stateId)).xp).toBe(350);
  });
});
