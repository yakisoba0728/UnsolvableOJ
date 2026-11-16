import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { AuthenticatedUser } from '../src/modules/auth/auth.types.js';
import { UserRole } from '../src/modules/users/user-role.enum.js';
import { EnterpriseService } from '../src/modules/enterprise/enterprise.service.js';
import { ENTERPRISE_EXPORT_LIMIT } from '../src/modules/enterprise/enterprise-result-export.js';
import { enterpriseResultExportSql } from '../src/modules/enterprise/enterprise-result-queries.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('owner-only complete enterprise CSV export', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let service: EnterpriseService;
  let owner: string;
  let outsider: string;
  let ownerUser: AuthenticatedUser;
  let testId: string;
  let emptyId: string;
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const endpoint = () => `${base}/enterprise/tests/${testId}/results/export`;

  async function addCandidates(start: number, end: number) {
    await db.query(`INSERT INTO users(id,email,username,password_hash)
      SELECT md5($1||'-export-user-'||n)::uuid,$1||'-export-'||n||'@example.invalid',
        $1||'_export_'||n,'EXPORT_PASSWORD_PRIVATE'
      FROM generate_series($2::int,$3::int) n`, [suffix, start, end]);
    await db.query(`INSERT INTO enterprise_attempts(id,test_id,user_id,started_at,deadline_at,finished_at)
      SELECT md5($1||'-export-attempt-'||n)::uuid,$2,md5($1||'-export-user-'||n)::uuid,
        now()-interval '2 hours',CASE WHEN n%3=0 THEN now()+interval '1 hour' ELSE now()-interval '1 hour' END,
        CASE WHEN n%3=1 THEN now()-interval '90 minutes' ELSE NULL END
      FROM generate_series($3::int,$4::int) n`, [suffix, testId, start, end]);
  }

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    service = app.get(EnterpriseService);
    const author = await register(app, 'export_owner', suffix);
    owner = author.accessToken;
    ownerUser = { id: author.user.id, role: UserRole.USER, tokenVersion: 0 };
    outsider = (await register(app, 'export_other', suffix)).accessToken;
    const { body: problem } = await http().post(`${base}/problems`).set(bearer(owner)).send({
      slug: `export-${suffix}`, title: 'Export fixture', statementMarkdown: 'Synthetic task',
      inputDescriptionMarkdown: '', outputDescriptionMarkdown: '', difficulty: 'BEGINNER', isPrivate: true,
      timeLimitMs: 1000, memoryLimitMb: 128,
      testCases: [{ input: 'HIDDEN_INPUT_PRIVATE', expectedOutput: 'HIDDEN_OUTPUT_PRIVATE', isSample: false }],
    }).expect(201);
    const create = async () => (await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'Export assessment', startsAt: new Date(Date.now() - 300_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 30, problemIds: [problem.id],
      inviteOnly: true, invitees: [`export_other_${suffix}`],
    }).expect(201)).body.id as string;
    testId = await create();
    emptyId = await create();
    await addCandidates(1, 123);
    await db.query(`UPDATE users SET username=$2 WHERE id=md5($1||'-export-user-1')::uuid`, [suffix, '=SUM(1,2)']);
    await db.query(`INSERT INTO submissions(user_id,problem_id,attempt_id,language,source_code,status,problem_version,is_test)
      VALUES(md5($1||'-export-user-1')::uuid,$2,md5($1||'-export-attempt-1')::uuid,
        'PYTHON','EXPORT_SOURCE_PRIVATE','ACCEPTED',1,true)`, [suffix, problem.id]);
  });
  afterAll(() => closeApp(app, []));

  it('rejects anonymous callers and even invited non-owner candidates', async () => {
    await http().get(endpoint()).expect(401);
    await http().get(endpoint()).set(bearer(outsider)).expect(404);
  });

  it('exports all pages with safe cells, narrow projection and non-cacheable attachment headers', async () => {
    const response = await http().get(`${endpoint()}?page=2&limit=1`).set(bearer(owner)).expect(200);
    expect(response.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/i);
    expect(response.headers['content-disposition']).toBe('attachment; filename="enterprise-results.csv"');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const csv = response.text as string;
    expect(csv.split('\r\n')).toHaveLength(125); // one header, all 123 rows, final empty line
    expect(csv).toContain('"\'=SUM(1,2)"');
    expect(csv).toContain('"FINISHED","1","1","100","SCORED"');
    expect(csv).toContain('"ACTIVE"');
    expect(csv).toContain('"EXPIRED"');
    for (const secret of ['EXPORT_SOURCE_PRIVATE', 'EXPORT_PASSWORD_PRIVATE', 'HIDDEN_INPUT_PRIVATE', 'HIDDEN_OUTPUT_PRIVATE', '@example.invalid', owner, 'invite_code'])
      expect(csv).not.toContain(secret);
    const results = await http().get(`${base}/enterprise/tests/${testId}/results?page=3`).set(bearer(owner)).expect(200);
    expect(results.body.analytics).toEqual({ finished: 41, active: 41, expired: 41, scoreBands: [122, 0, 0, 0, 1] });
    expect(results.body.summary).toEqual({ candidates: 123, pending: 0, averageScore: 1, perfect: 1 });
    expect(results.body.exportLimit).toBe(ENTERPRISE_EXPORT_LIMIT);
    expect(results.body.candidates).toHaveLength(23);
  });

  it('returns a header-only CSV and zero analytics for an empty assessment', async () => {
    expect((await service.exportResults(emptyId, ownerUser)).split('\r\n')).toHaveLength(2);
    const empty = await service.results(emptyId, ownerUser);
    expect(empty.analytics).toEqual({ finished: 0, active: 0, expired: 0, scoreBands: [0, 0, 0, 0, 0] });
    expect(empty.summary.averageScore).toBeNull();
    await expect(service.exportResults(randomUUID(), ownerUser)).rejects.toMatchObject({ status: 404 });
  });

  it('accepts exactly 5,000 candidates and rejects 5,001 before score projection', async () => {
    await addCandidates(124, ENTERPRISE_EXPORT_LIMIT);
    const atLimit = await http().get(endpoint()).set(bearer(owner)).expect(200);
    expect(atLimit.text.split('\r\n')).toHaveLength(ENTERPRISE_EXPORT_LIMIT + 2);
    // A join between the cap check and projection belongs to the next export,
    // rather than turning this whole-snapshot download into a truncated report.
    let checked!: () => void;
    let release!: () => void;
    const observed = new Promise<void>(resolve => { checked = resolve; });
    const resume = new Promise<void>(resolve => { release = resolve; });
    let held = false;
    const factory = db.createQueryRunner.bind(db);
    const capSpy = vi.spyOn(db, 'createQueryRunner').mockImplementation(mode => {
      const runner = factory(mode);
      const query = runner.query.bind(runner);
      runner.query = (async (sql: string, params?: unknown[] | Record<string, unknown>, structured?: boolean) => {
        const result = structured ? await query(sql, params, true) : await query(sql, params);
        if (!held && sql.startsWith('SELECT t.*,') && sql.includes('AS attempt_count')) {
          held = true; checked(); await resume;
        }
        return result;
      }) as typeof runner.query;
      return runner;
    });
    const inProgress = service.exportResults(testId, ownerUser);
    try {
      await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Export cap query was not observed')), 2500))]);
      await addCandidates(ENTERPRISE_EXPORT_LIMIT + 1, ENTERPRISE_EXPORT_LIMIT + 1);
      release();
      expect((await inProgress).split('\r\n')).toHaveLength(ENTERPRISE_EXPORT_LIMIT + 2);
    } finally { release(); capSpy.mockRestore(); await inProgress; }
    const projected = vi.fn();
    const originalFactory = db.createQueryRunner.bind(db);
    const spy = vi.spyOn(db, 'createQueryRunner').mockImplementation((mode) => {
      const runner = originalFactory(mode);
      const query = runner.query.bind(runner);
      runner.query = (async (sql: string, params?: unknown[] | Record<string, unknown>, structured?: boolean) => {
        if (sql === enterpriseResultExportSql) projected();
        return structured ? query(sql, params, true) : query(sql, params);
      }) as typeof runner.query;
      return runner;
    });
    try {
      const response = await http().get(endpoint()).set(bearer(owner)).expect(409);
      // Error transport remains JSON despite the success response being CSV.
      expect(response.body.message).toContain('5,000');
      expect(projected).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
});
