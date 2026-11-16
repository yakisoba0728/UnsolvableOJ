import { BASELINE_VERSION } from '../src/database/migrations/1796000000000-vibe-challenge-versions.js';
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { enterpriseResultSummarySql } from '../src/modules/enterprise/enterprise-result-queries.js';
import { base, bearer, closeApp, createApp, register } from './helpers.js';

describe('bounded enterprise result pages with global scores', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  let owner: string;
  let outsider: string;
  let testId: string;
  let emptyId: string;
  let expected: { id: string; n: number; score: number | null; solved: number }[];
  let summary: { candidates: number; pending: number; averageScore: number | null; perfect: number };
  const suffix = randomUUID().slice(0, 8);
  const http = () => request(app.getHttpServer());
  const endpoint = () => `${base}/enterprise/tests/${testId}/results`;

  beforeAll(async () => {
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    db = app.get(DataSource);
    const author = await register(app, 'result_owner', suffix);
    owner = author.accessToken;
    outsider = (await register(app, 'result_other', suffix)).accessToken;
    const problems: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { body } = await http().post(`${base}/problems`).set(bearer(owner)).send({
        slug: `results-${i}-${suffix}`, title: `Results ${i}`, statementMarkdown: 'Synthetic exercise',
        inputDescriptionMarkdown: '', outputDescriptionMarkdown: '', difficulty: 'BEGINNER', isPrivate: true,
        timeLimitMs: 1000, memoryLimitMb: 128, testCases: [{ input: '', expectedOutput: '', isSample: true }],
      }).expect(201);
      problems.push(body.id);
    }
    const create = async () => (await http().post(`${base}/enterprise/tests`).set(bearer(owner)).send({
      title: 'Paginated results', startsAt: new Date(Date.now() - 300_000).toISOString(),
      endsAt: new Date(Date.now() + 3600_000).toISOString(), durationMin: 30,
      problemIds: problems, vibeChallengeIds: ['post-search-v1'],
    }).expect(201)).body.id as string;
    testId = await create();
    emptyId = await create();
    // 123 candidates share a timestamp: the stable ID tie-breaker must prevent
    // omissions/duplicates across pages. This setup avoids throttled signup loops.
    const users = await db.query(`INSERT INTO users(id,email,username,password_hash)
      SELECT md5($1||'-user-'||n)::uuid,$1||'-'||n||'@example.invalid',$1||'_'||n,'fixture-only'
      FROM generate_series(1,123) n RETURNING id`, [suffix]);
    expect(users).toHaveLength(123);
    await db.query(`INSERT INTO enterprise_attempts(id,test_id,user_id,started_at,deadline_at)
      SELECT md5($1||'-attempt-'||n)::uuid,$2,md5($1||'-user-'||n)::uuid,$3,$3::timestamptz+interval '30 minutes'
      FROM generate_series(1,123) n`, [suffix, testId, new Date(Date.now() - 60_000)]);
    await db.query(`INSERT INTO submissions(id,user_id,problem_id,attempt_id,language,source_code,status,problem_version,is_test)
      SELECT md5($1||'-submission-'||n||'-'||p)::uuid,md5($1||'-user-'||n)::uuid,
        ($2::uuid[])[p],md5($1||'-attempt-'||n)::uuid,'PYTHON','fixture',
        CASE WHEN n%(p+1)=0 THEN 'ACCEPTED'::submission_status ELSE 'WRONG_ANSWER'::submission_status END,1,true
      FROM generate_series(1,123) n CROSS JOIN generate_series(1,2) p`, [suffix, problems]);
    await db.query(`INSERT INTO vibe_attempts(user_id,challenge_id,state,model,enterprise_attempt_id,submitted_at,challenge_version)
      SELECT md5($1||'-user-'||n)::uuid,'post-search-v1',
        CASE WHEN n%5=1 THEN jsonb_build_object('files',jsonb_build_object('private.txt','WORKSPACE_NOT_FOR_RESULT_LIST'))
          WHEN n%5=2 THEN '{"report":{"evaluationStatus":"unavailable"}}'::jsonb
          ELSE jsonb_build_object('report',jsonb_build_object('evaluationStatus','complete','outcome',40,
            'prompt',jsonb_build_object('score',CASE WHEN n%5=3 THEN 25 ELSE 30 END),
            'process',jsonb_build_object('score',CASE WHEN n%5=3 THEN 22 ELSE 30 END))) END,
        'fixture',md5($1||'-attempt-'||n)::uuid,CASE WHEN n%5<>1 THEN clock_timestamp() END,$2
      FROM generate_series(1,123) n WHERE n%5<>0`, [suffix, BASELINE_VERSION]);
    const ids = await db.query(`SELECT md5($1||'-attempt-'||n)::uuid AS id,n FROM generate_series(1,123) n ORDER BY id`, [suffix]);
    expected = ids.map(({ id, n }: { id: string; n: number }) => {
      const solved = Number(n % 2 === 0) + Number(n % 3 === 0);
      const vibe = n % 5 === 0 ? 0 : n % 5 === 3 ? 87 : n % 5 === 4 ? 100 : null;
      return { id, n, solved, score: vibe === null ? null : Math.round((solved * 100 + vibe) / 3) };
    });
    const complete = expected.filter((row) => row.score !== null);
    summary = { candidates: 123, pending: 123 - complete.length,
      averageScore: Math.round(complete.reduce((sum, row) => sum + row.score!, 0) / complete.length),
      perfect: expected.filter((row) => row.score === 100).length };
  });
  afterAll(() => closeApp(app, []));

  it('returns exactly 50 default rows while preserving whole-assessment summaries and detail links', async () => {
    const { body } = await http().get(endpoint()).set(bearer(owner)).expect(200);
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 123, totalPages: 3 });
    expect(body.summary).toEqual(summary);
    expect(body.analytics).toEqual({ finished: 0, active: 123, expired: 0,
      scoreBands: [0, 20, 40, 60, 80].map((min) => expected.filter((row) => row.score !== null && row.score >= min && row.score <= (min === 80 ? 100 : min + 19)).length) });
    expect(body.candidates.map((row: { id: string }) => row.id)).toEqual(expected.slice(0, 50).map((row) => row.id));
    for (const [index, row] of body.candidates.entries()) {
      expect(row).toMatchObject({ id: expected[index].id, score: expected[index].score, solved: expected[index].solved });
      expect(row.problems).toHaveLength(2);
      expect(row.problems.every((problem: { submissionId: string; submissions: number }) => problem.submissionId && problem.submissions === 1)).toBe(true);
      expect(row.vibeTasks).toHaveLength(1);
    }
    expect(JSON.stringify(body)).not.toContain('WORKSPACE_NOT_FOR_RESULT_LIST');
  });

  it('walks every candidate once in deterministic order and keeps global pending/rounded average on each page', async () => {
    const ids: string[] = [];
    for (const page of [1, 2, 3]) {
      const { body } = await http().get(`${endpoint()}?page=${page}`).set(bearer(owner)).expect(200);
      expect(body.summary).toEqual(summary);
      expect(body.candidates).toHaveLength(page === 3 ? 23 : 50);
      ids.push(...body.candidates.map((row: { id: string }) => row.id));
    }
    expect(ids).toEqual(expected.map((row) => row.id));
    expect(new Set(ids).size).toBe(123);
    const { body } = await http().get(`${endpoint()}?page=2&limit=100`).set(bearer(owner)).expect(200);
    expect(body.pagination).toEqual({ page: 2, limit: 100, total: 123, totalPages: 2 });
    expect(body.candidates.map((row: { id: string }) => row.id)).toEqual(expected.slice(100).map((row) => row.id));
  });

  it('reports empty and out-of-range pages without inventing candidates or page totals', async () => {
    const empty = await http().get(`${base}/enterprise/tests/${emptyId}/results`).set(bearer(owner)).expect(200);
    expect(empty.body).toMatchObject({ candidates: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
      summary: { candidates: 0, pending: 0, averageScore: null, perfect: 0 } });
    const beyond = await http().get(`${endpoint()}?page=999`).set(bearer(owner)).expect(200);
    expect(beyond.body.candidates).toEqual([]);
    expect(beyond.body.pagination).toEqual({ page: 999, limit: 50, total: 123, totalPages: 3 });
    expect(beyond.body.summary).toEqual(summary);
  });

  it('rejects oversized/invalid requests and preserves owner authorization', async () => {
    await http().get(endpoint()).expect(401);
    await http().get(`${endpoint()}?page=2`).set(bearer(outsider)).expect(404);
    for (const query of ['limit=101', 'limit=0', 'limit=1.5', 'limit=abc', 'page=0', 'page=-1', 'page=1.5', 'page=1000001'])
      await http().get(`${endpoint()}?${query}`).set(bearer(owner)).expect(400);
  });

  it('reads count and page from one snapshot when a candidate joins between the summary and detail queries', async () => {
    let summaryRead!: () => void;
    let release!: () => void;
    const observed = new Promise<void>((resolve) => { summaryRead = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const originalFactory = db.createQueryRunner.bind(db);
    let held = false;
    const spy = vi.spyOn(db, 'createQueryRunner').mockImplementation((mode) => {
      const runner = originalFactory(mode);
      const originalQuery = runner.query.bind(runner);
      runner.query = (async (sql: string, params?: unknown[] | Record<string, unknown>, structured?: boolean) => {
        const result = structured ? await originalQuery(sql, params, true) : await originalQuery(sql, params);
        if (!held && sql === enterpriseResultSummarySql) {
          held = true; summaryRead(); await resume;
        }
        return result;
      }) as typeof runner.query;
      return runner;
    });
    const pending = http().get(endpoint()).set(bearer(owner)).then((response) => response);
    const newId = randomUUID();
    try {
      await Promise.race([observed, new Promise((_, reject) => setTimeout(() => reject(new Error('Summary was not observed')), 2500))]);
      const [person] = await db.query("INSERT INTO users(email,username,password_hash) VALUES($1,$2,'fixture') RETURNING id", [`late-${suffix}@example.invalid`, `late_${suffix}`]);
      await db.query(`INSERT INTO enterprise_attempts(id,test_id,user_id,started_at,deadline_at)
        VALUES($1,$2,$3,clock_timestamp()-interval '2 minutes',clock_timestamp()+interval '28 minutes')`, [newId,testId,person.id]);
      release();
      const response = await pending;
      expect(response.status).toBe(200);
      expect(response.body.pagination.total).toBe(123);
      expect(response.body.candidates.map((row: { id: string }) => row.id)).toEqual(expected.slice(0,50).map((row) => row.id));
    } finally { release(); spy.mockRestore(); await pending; }
    const next = await http().get(endpoint()).set(bearer(owner)).expect(200);
    expect(next.body.pagination.total).toBe(124);
    expect(next.body.candidates[0].id).toBe(newId);
  });
});
