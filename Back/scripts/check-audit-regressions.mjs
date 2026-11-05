// Focused real-service assertions, not a replacement for the Vitest API suite.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import configured from '../dist/database/data-source.js';
import { AuthModule } from '../dist/modules/auth/auth.module.js';
import { UsersModule } from '../dist/modules/users/users.module.js';
import { MissionsModule } from '../dist/modules/missions/missions.module.js';
import { configureHttp } from '../dist/configure-http.js';
import { MissionsService } from '../dist/modules/missions/missions.service.js';
import { SubmissionsService } from '../dist/modules/submissions/submissions.service.js';
import { JudgeService } from '../dist/modules/submissions/judge.service.js';
import { Submission } from '../dist/modules/submissions/submission.entity.js';
import { Problem } from '../dist/modules/problems/problem.entity.js';

const name = `unsolvable_audit_${randomUUID().replaceAll('-', '')}`;
const admin = await new DataSource({ ...configured.options, entities: [], migrations: [] }).initialize();
const url = new URL(configured.options.url);
url.pathname = `/${name}`;
let db, app, created = false;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  db = await new DataSource({ ...configured.options, url: url.href }).initialize();
  await db.runMigrations();
  const module = await Test.createTestingModule({ imports: [
    ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
    TypeOrmModule.forRoot(db.options), AuthModule, UsersModule, MissionsModule,
  ] }).compile();
  app = module.createNestApplication({ bodyParser: false, logger: false });
  configureHttp(app);
  await app.listen(0, '127.0.0.1');
  assert.equal(app.getHttpServer().address().address, '127.0.0.1');
  assert.equal(app.getHttpServer().address().family, 'IPv4');
  await request(app.getHttpServer()).get('/api/v1/missions').expect(401);
  const registered = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
    email: 'audit@fixture.invalid', username: 'audit_fixture', password: 'fixture-password-123',
  }).expect(201);
  await request(app.getHttpServer()).get('/api/v1/missions')
    .set('Authorization', `Bearer ${registered.body.accessToken}`).expect(200);
  console.log('A: IPv4 owned endpoint, real register, unauthorized/authorized mission HTTP passed');
  await app.close(); app = undefined;

  const missions = new MissionsService(db);
  const queue = { add: async () => ({}) };
  const submissions = new SubmissionsService(db.getRepository(Submission), db.getRepository(Problem), db, queue);
  const judge = new JudgeService(db.getRepository(Submission), db, queue);
  async function fixture() {
    const suffix = randomUUID();
    const [user] = await db.query(`INSERT INTO users(email,username,password_hash,role)
      VALUES($1,$2,'unused','AUTHOR') RETURNING id,role`, [`${suffix}@fixture.invalid`, suffix.slice(0, 24)]);
    const [problem] = await db.query(`INSERT INTO problems(slug,title,statement_md,difficulty,status,author_id)
      VALUES($1,'Audit','Test','BEGINNER','PUBLISHED',$2) RETURNING id`, [suffix, user.id]);
    await db.query(`INSERT INTO problem_versions(problem_id,version,snapshot) VALUES($1,1,$2)`, [problem.id, {
      difficulty: 'BEGINNER', timeLimitMs: 1000, memoryLimitMb: 256, testCases: [],
    }]);
    return { user, problem };
  }
  async function clock(at, run) {
    const original = db.createQueryRunner;
    db.createQueryRunner = function (...args) {
      const runner = original.apply(this, args);
      const query = runner.query.bind(runner);
      runner.query = (sql, params, structured) => sql.includes('SELECT clock_timestamp()')
        ? query(sql.replace('clock_timestamp()', '$1::timestamptz'), [at], structured)
        : query(sql, params, structured);
      return runner;
    };
    try { return await run(); } finally { db.createQueryRunner = original; }
  }
  const streak = async (user) => (await missions.list(user.id)).items.find((m) => m.id === 'streak');
  async function finish(id, status) {
    const row = await db.getRepository(Submission).findOneByOrFail({ id });
    const attempt = randomUUID();
    await judge.claimForJudge(id, row.judgeGeneration, attempt);
    const dto = { status, passedTestCases: 0, totalTestCases: 0 };
    await judge.recordJudgeResult(id, row.judgeGeneration, attempt, dto);
    await judge.recordJudgeResult(id, row.judgeGeneration, attempt, dto);
  }
  const { user: precise } = await fixture();
  const timestamp = '2026-10-15T16:00:00.123726Z';
  for (const at of ['.122999', '.123037', '.123900']) await db.query(`INSERT INTO community_posts(author_id,category,title,body,created_at)
    VALUES($1,'SOLUTION','precision','fixture',$2)`, [precise.id, `2026-10-15T16:00:00${at}Z`]);
  await clock(timestamp, async () => {
    let mission = (await missions.list(precise.id)).items.find((m) => m.id === 'community');
    assert.equal(mission.current, 2);
    await db.query("DELETE FROM community_posts WHERE author_id=$1 AND created_at < '2026-10-15T16:00:00.123000Z'", [precise.id]);
    assert.equal((await missions.list(precise.id)).items.find((m) => m.id === 'community').current, 1);
    await assert.rejects(missions.claim(precise.id, mission.stateId), /아직/);
    await db.query("UPDATE community_posts SET created_at='2026-10-15T16:00:00.123038Z' WHERE author_id=$1", [precise.id]);
    await missions.claim(precise.id, mission.stateId);
    await missions.answer(precise.id, 'slice', 2);
    const [row] = await db.query(`SELECT completed_at=$2::timestamptz AS completed, claimed_at=$2::timestamptz AS claimed,
      u.updated_at=$2::timestamptz AS updated, a.created_at=$2::timestamptz AND a.updated_at=$2::timestamptz AS analysis
      FROM mission_states s JOIN users u ON u.id=s.user_id JOIN analysis_attempts a ON a.user_id=u.id WHERE s.id=$1`, [mission.stateId, timestamp]);
    assert.deepEqual(row, { completed: true, claimed: true, updated: true, analysis: true });
    const bonus = (await missions.list(precise.id)).items.find((m) => m.id === 'bonus');
    const [{ problem_id }] = await db.query('SELECT problem_id FROM mission_states WHERE id=$1', [bonus.stateId]);
    const [solve] = await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,created_at)
      VALUES($1,$2,'C','pass','ACCEPTED','2026-10-15T16:00:00.123900Z') RETURNING id`, [precise.id, problem_id]);
    await db.query('INSERT INTO user_problem_solves(user_id,problem_id,accepted_submission_id,awarded_xp) VALUES($1,$2,$3,10)', [precise.id, problem_id, solve.id]);
    let page = await missions.list(precise.id);
    for (const id of ['daily', 'weekly', 'night', 'bonus']) assert.equal(page.items.find((m) => m.id === id).current, 0);
    await db.query("UPDATE submissions SET created_at='2026-10-15T16:00:00.123037Z' WHERE id=$1", [solve.id]);
    page = await missions.list(precise.id);
    for (const id of ['daily', 'weekly', 'night', 'bonus']) assert.equal(page.items.find((m) => m.id === id).current, 1);
    for (let i = 0; i < 2; i++) await db.query(`INSERT INTO submissions(user_id,problem_id,language,source_code,status,created_at)
      VALUES($1,$2,'C','pass','COMPILE_ERROR','2026-10-15T16:00:00.123037Z')`, [precise.id, problem_id]);
    const night = (await missions.list(precise.id)).items.find((m) => m.id === 'night');
    await missions.claim(precise.id, night.stateId);
    assert.equal((await db.query('SELECT awarded_at=$2::timestamptz AS precise FROM user_badges WHERE user_id=$1', [precise.id, timestamp]))[0].precise, true);
  });
  console.log('B: committed .123037 included, later .123900 excluded at .123726; reward/analysis writes and daily/weekly/night/bonus cutoffs passed');

  const initial = await fixture();
  const firstPending = await submissions.create(initial.problem.id, { language: 'PYTHON', sourceCode: 'pass' }, initial.user);
  const stillUnfinished = async () => {
    assert.equal((await db.getRepository(Submission).findOneByOrFail({ id: firstPending.id })).completedForLearning, false);
    assert.equal((await streak(initial.user)).current, 0);
  };
  await stillUnfinished();
  const firstAttempt = randomUUID();
  await judge.claimForJudge(firstPending.id, 1, firstAttempt);
  await stillUnfinished();
  await judge.recordJudgeResult(firstPending.id, 1, firstAttempt, { status: 'SYSTEM_ERROR', passedTestCases: 0, totalTestCases: 0 });
  await stillUnfinished();
  await submissions.rejudge(firstPending.id, initial.user);
  await finish(firstPending.id, 'CANCELLED');
  await stillUnfinished();
  console.log('D: initial QUEUED/JUDGING/SYSTEM_ERROR/CANCELLED never establish learning passed');

  for (const verdict of ['WRONG_ANSWER', 'ACCEPTED']) for (const pending of ['QUEUED', 'JUDGING', 'SYSTEM_ERROR']) {
    const { user, problem } = await fixture();
    const at = (day) => new Date(Date.UTC(2026, 9, day, 3)).toISOString();
    const add = async (day, status) => {
      const row = await submissions.create(problem.id, { language: 'PYTHON', sourceCode: 'pass' }, user);
      await db.query('UPDATE submissions SET created_at=$2 WHERE id=$1', [row.id, at(day)]);
      if (status) await finish(row.id, status);
      return row.id;
    };
    for (let day = 1; day <= 7; day++) await add(day, 'WRONG_ANSWER');
    const first = await clock('2026-10-07T04:00:00Z', async () => {
      const mission = await streak(user);
      assert.equal((await missions.claim(user.id, mission.stateId)).xp, 120);
      return mission;
    });
    let middle;
    for (let day = 8; day <= 15; day++) {
      const id = await add(day, day === 8 ? verdict : 'COMPILE_ERROR');
      if (day === 8) middle = id;
    }
    const [{ xp }] = await db.query('SELECT xp FROM users WHERE id=$1', [user.id]);
    const queued = await submissions.rejudge(middle, user);
    if (pending === 'JUDGING') await judge.claimForJudge(middle, queued.judgeGeneration, randomUUID());
    else if (pending === 'SYSTEM_ERROR') await finish(middle, pending);
    await clock('2026-10-15T04:00:00Z', async () => {
      const unchanged = async () => {
        const current = await streak(user);
        assert.equal(current.stateId, first.stateId);
        const receipts = await Promise.all(Array.from({ length: 4 }, () => missions.claim(user.id, current.stateId)));
        assert.ok(receipts.every((r) => r.alreadyClaimed && r.xp === xp));
        assert.equal(receipts[0].badges.length, 1);
        assert.equal((await submissions.findMine(user, { page: 1, limit: 100 })).items.find((r) => r.id === middle).completedForLearning, true);
      };
      await unchanged();
      if (pending !== 'QUEUED') await submissions.rejudge(middle, user);
      await finish(middle, verdict);
      await unchanged();
      await submissions.rejudge(middle, user);
      await unchanged();
    });
    console.log(`D: ${verdict} → ${pending}, day-7 receipt/day-8 rejudge/day-15 checks, restoration/retries passed`);
  }
  const { user, problem } = await fixture();
  for (const day of [...Array.from({ length: 7 }, (_, i) => i + 1), 8, ...Array.from({ length: 7 }, (_, i) => i + 9)]) {
    const row = await submissions.create(problem.id, { language: 'PYTHON', sourceCode: 'pass' }, user);
    await db.query('UPDATE submissions SET created_at=$2 WHERE id=$1', [row.id, new Date(Date.UTC(2026, 9, day, 3)).toISOString()]);
    if (day !== 8) await finish(row.id, 'WRONG_ANSWER');
    if (day === 7 || day === 15) await clock(`2026-10-${day === 7 ? '07' : '15'}T04:00:00Z`, async () => {
      const receipt = await missions.claim(user.id, (await streak(user)).stateId);
      assert.equal(receipt.xp, day === 7 ? 120 : 240);
      assert.equal(receipt.badges.length, 1);
    });
  }
  console.log('D: initial QUEUED does not bridge a missed day; separate genuine run earns its own reward, one badge passed');
} finally {
  if (app) await app.close();
  if (db?.isInitialized) await db.destroy();
  if (created) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  await admin.destroy();
}
