// 대량 데이터(문제 5,000·제출 50만·사용자 2만)에서 주요 화면의 실제 서비스 쿼리를 EXPLAIN (ANALYZE, BUFFERS)로 잰다.
// 사용: npm run build && node scripts/bench-queries.mjs [--reset] [--plans]
// 로컬 PostgreSQL에 따로 만드는 unsolvable_bench 데이터베이스만 쓴다(설정된 DB는 만들기·지우기에만 쓴다).
// 이미 있으면 데이터를 다시 넣지 않고 새 마이그레이션만 적용한다(전/후 비교는 --reset 없이 다시 돌린다).
// 문제 통계 트리거(1795200000000)가 있는 상태의 --reset은 제출 50만 건마다 통계를 다시 세므로 몇 분 걸린다.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { PostgresQueryRunner } from 'typeorm/driver/postgres/PostgresQueryRunner.js';
import configured from '../dist/database/data-source.js';
import { ProblemsService } from '../dist/modules/problems/problems.service.js';
import { Problem } from '../dist/modules/problems/problem.entity.js';
import { Submission } from '../dist/modules/submissions/submission.entity.js';
import { SubmissionsService } from '../dist/modules/submissions/submissions.service.js';
import { UsersService } from '../dist/modules/users/users.service.js';
import { MissionsService } from '../dist/modules/missions/missions.service.js';

const NAME = 'unsolvable_bench';
const args = new Set(process.argv.slice(2));
assert.notEqual(process.env.NODE_ENV, 'production', '운영 환경에서는 실행할 수 없습니다.');
const base = new URL(configured.options.url);
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  `로컬 PostgreSQL에서만 실행합니다(지금: ${base.hostname}).`,
);

const admin = new DataSource({ ...configured.options, entities: [], migrations: [] });
await admin.initialize();
if (args.has('--reset')) await admin.query(`DROP DATABASE IF EXISTS "${NAME}" WITH (FORCE)`);
const [exists] = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [NAME]);
if (!exists) await admin.query(`CREATE DATABASE "${NAME}"`);
await admin.destroy();

const url = new URL(configured.options.url);
url.pathname = `/${NAME}`;
const db = await new DataSource({ ...configured.options, url: url.href }).initialize();
assert.equal((await db.query('SELECT current_database() AS name'))[0].name, NAME);
await db.runMigrations();
if (!(await db.query("SELECT 1 FROM users WHERE username = 'bench_1'")).length) await seed();

async function seed() {
  console.log('대량 데이터를 넣는 중…');
  const started = Date.now();
  await db.transaction(async (m) => {
    await m.query('SELECT setseed(0.42)');
    await m.query(`
      INSERT INTO users (email, username, password_hash, created_at)
      SELECT 'bench' || g || '@bench.local', 'bench_' || g, 'unused', now() - g * interval '20 minutes'
      FROM generate_series(1, 20000) g`);
    const words = `'{Sum,Graph,Tree,Path,Prime,String,Array,Matrix,Queue,Stack,Binary,Search,Sort,Game,Number,Grid,Coin,Bridge,Robot,Tower}'::text[]`;
    await m.query(`
      INSERT INTO problems (slug, title, statement_md, difficulty, status, is_private, tags, author_id, created_at)
      SELECT 'bench-' || g,
        w[1 + abs(hashtext(g || 'a')) % 20] || ' ' || w[1 + abs(hashtext(g || 'b')) % 20] || ' ' || g,
        'statement', (enum_range(NULL::problem_difficulty))[1 + g % 5],
        (CASE WHEN g % 20 = 0 THEN 'DRAFT' ELSE 'PUBLISHED' END)::problem_status, g % 40 = 0,
        ARRAY(SELECT DISTINCT 'tag' || (1 + abs(hashtext(g || '-' || k)) % 60) FROM generate_series(1, 1 + g % 3) k),
        (SELECT id FROM users WHERE username = 'bench_1'), now() - g * interval '90 minutes'
      FROM generate_series(1, 5000) g, (SELECT ${words} AS w) words`);
    // 사용자·문제 모두 치우치게 고른다: 앞쪽 사용자가 많이 내고 앞쪽 문제가 많이 풀린다.
    await m.query(`
      WITH u AS (SELECT array_agg(id ORDER BY created_at DESC) a FROM users WHERE username LIKE 'bench\\_%'),
           p AS (SELECT array_agg(id ORDER BY created_at DESC) a FROM problems WHERE slug LIKE 'bench-%'),
           raw AS (
             SELECT u.a[1 + floor(20000 * power(random(), 2))::int] AS user_id,
               p.a[1 + floor(5000 * power(random(), 1.5))::int] AS problem_id,
               random() AS r, random() < 0.01 AS is_test,
               now() - random() * interval '365 days' AS created_at
             FROM generate_series(1, 500000), u, p)
      INSERT INTO submissions (user_id, problem_id, language, source_code, status, is_test,
        accepted_for_xp, completed_for_learning, passed_test_cases, total_test_cases, created_at, updated_at)
      SELECT user_id, problem_id, 'PYTHON', 'print(1)', s.status::submission_status, is_test,
        s.status = 'ACCEPTED' AND NOT is_test,
        s.status NOT IN ('QUEUED', 'SYSTEM_ERROR') AND NOT is_test, 1, 2, created_at, created_at
      FROM raw, LATERAL (SELECT CASE WHEN r < 0.40 THEN 'ACCEPTED' WHEN r < 0.75 THEN 'WRONG_ANSWER'
        WHEN r < 0.83 THEN 'TIME_LIMIT_EXCEEDED' WHEN r < 0.88 THEN 'RUNTIME_ERROR'
        WHEN r < 0.93 THEN 'COMPILE_ERROR' WHEN r < 0.96 THEN 'MEMORY_LIMIT_EXCEEDED'
        WHEN r < 0.998 THEN 'OUTPUT_LIMIT_EXCEEDED' WHEN r < 0.999 THEN 'SYSTEM_ERROR' ELSE 'QUEUED' END AS status) s`);
    await m.query(`
      INSERT INTO user_problem_solves (user_id, problem_id, accepted_submission_id, awarded_xp, created_at)
      SELECT DISTINCT ON (s.user_id, s.problem_id) s.user_id, s.problem_id, s.id,
        CASE p.difficulty WHEN 'BEGINNER' THEN 10 WHEN 'EASY' THEN 20 WHEN 'MEDIUM' THEN 40 WHEN 'HARD' THEN 80 ELSE 160 END,
        s.created_at
      FROM submissions s JOIN problems p ON p.id = s.problem_id
      WHERE s.status = 'ACCEPTED' AND NOT s.is_test
      ORDER BY s.user_id, s.problem_id, s.created_at, s.id`);
    await m.query(`
      UPDATE users u SET xp = t.xp, level = 1 + t.xp / 100
      FROM (SELECT user_id, sum(awarded_xp)::int xp FROM user_problem_solves GROUP BY user_id) t
      WHERE t.user_id = u.id`);
  });
  console.log(`넣기 ${((Date.now() - started) / 1000).toFixed(1)}초`);
}
// 새로 넣었든 마이그레이션이 열을 채웠든 통계를 최신으로 맞춰야 실제 운영의 계획과 같다.
await db.query('VACUUM ANALYZE');

// 서비스가 보내는 SELECT마다 같은 SQL을 EXPLAIN (ANALYZE, BUFFERS)로 한 번 더 돌려 기록한다.
let recording = null;
const original = PostgresQueryRunner.prototype.query;
PostgresQueryRunner.prototype.query = async function (sql, params, structured) {
  if (
    recording &&
    /^\s*(SELECT|WITH)\b/i.test(sql) &&
    !/\b(INSERT|UPDATE|DELETE)\b|pg_advisory|clock_timestamp/i.test(sql)
  ) {
    const [row] = await original.call(this, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
    const [plan] = row['QUERY PLAN'];
    recording.push({ sql, ms: plan['Execution Time'], plan: plan.Plan });
  }
  return original.call(this, sql, params, structured);
};

const [heavy] = await db.query(`
  SELECT u.id, u.username, u.role FROM users u JOIN submissions s ON s.user_id = u.id
  GROUP BY u.id ORDER BY count(*) DESC LIMIT 1`);
const [popular] = await db.query(`
  SELECT p.slug, p.id FROM problems p JOIN submissions s ON s.problem_id = p.id
  WHERE p.status = 'PUBLISHED' GROUP BY p.id ORDER BY count(*) DESC LIMIT 1`);
const counts = (
  await db.query(`SELECT (SELECT count(*) FROM problems)::int problems, (SELECT count(*) FROM submissions)::int submissions,
    (SELECT count(*) FROM users)::int users, (SELECT count(*) FROM submissions WHERE user_id = $1)::int heavy`, [heavy.id])
)[0];
console.log(`문제 ${counts.problems} · 제출 ${counts.submissions} · 사용자 ${counts.users} · 측정 사용자 제출 ${counts.heavy}`);

const problems = new ProblemsService(db.getRepository(Problem), db);
const submissions = new SubmissionsService(db.getRepository(Submission), db.getRepository(Problem), db, null);
const users = new UsersService(db);
const missions = new MissionsService(db);
const list = (extra = {}) => ({ page: 1, limit: 20, ...extra });
// 홈·프로필이 하던 useAllProblems: 1,000개씩 커서로 끝까지 읽는다.
// 채점 결과 1건 저장(통계 트리거 비용 포함). 되돌려서 데이터는 그대로 둔다.
const [wrong] = await db.query(
  "SELECT id FROM submissions WHERE problem_id = $1 AND status = 'WRONG_ANSWER' AND NOT is_test LIMIT 1",
  [popular.id],
);
const judgeOne = async () => {
  const runner = db.createQueryRunner();
  await runner.startTransaction();
  try {
    await runner.query("UPDATE submissions SET status = 'ACCEPTED' WHERE id = $1", [wrong.id]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
};
const readAllProblems = async () => {
  let cursor;
  do cursor = (await problems.findAll(list({ limit: 1000, cursor }))).nextCursor;
  while (cursor);
};
const scenarios = [
  ['문제 목록 최신순(비로그인)', () => problems.findAll(list())],
  ['문제 목록 최신순(로그인)', () => problems.findAll(list(), heavy)],
  ['문제 목록 난이도순', () => problems.findAll(list({ sort: 'difficulty' }))],
  ['문제 목록 제목순', () => problems.findAll(list({ sort: 'title' }))],
  ['문제 목록 푼 사람순', () => problems.findAll(list({ sort: 'solvers' }))],
  ['문제 목록 정답률순', () => problems.findAll(list({ sort: 'rate' }))],
  ['문제 목록 정답률 역순 50쪽', () => problems.findAll(list({ sort: 'rate', reverse: 'true', page: 50 }))],
  ['문제 목록 무작위', () => problems.findAll(list({ sort: 'random', seed: 7 }))],
  ['난이도+태그 필터', () => problems.findAll(list({ difficulty: ['HARD'], tag: 'tag7' }))],
  ['내 풀이 상태=해결', () => problems.findAll(list({ solve: ['solved'] }), heavy)],
  ['검색 q=graph', () => problems.findAll(list({ q: 'graph' }))],
  ['검색 q=graph 푼 사람순', () => problems.findAll(list({ q: 'graph', sort: 'solvers' }))],
  ['검색 q=없는말', () => problems.findAll(list({ q: 'zzqx' }))],
  ['공개 문제 전체(useAllProblems)', readAllProblems],
  ['홈 추천 7개(안 푼 문제)', () => problems.findAll(list({ limit: 7, solve: ['none', 'attempted'] }), heavy)],
  ['프로필 난이도별 해결 수', () => problems.findAll(list({ limit: 1, solve: ['solved'] }), heavy)],
  ['문제 상세 통계(withStats)', () => problems.findPublishedBySlug(popular.slug)],
  ['랭킹 상위 100', () => users.rankings()],
  ['랭킹 500쪽', () => users.rankingPage(500, 20)],
  ['내 정보(users/me)', () => users.me(heavy.id)],
  ['공개 프로필', () => users.publicProfile(heavy.username)],
  ['내 제출 1쪽', () => submissions.findMine(heavy, list())],
  ['내 제출 문제별', () => submissions.findMine(heavy, list({ problemId: popular.id }))],
  ['내 제출 1,000개', () => submissions.findMine(heavy, list({ limit: 1000 }))],
  ['미션 대시보드', () => missions.list(heavy.id)],
  ['채점 결과 1건 저장(인기 문제)', judgeOne],
];

const label = (sql) => sql.replace(/\s+/g, ' ').trim().slice(0, 70);
const tree = (node, depth = 0) =>
  [
    `${'  '.repeat(depth)}${node['Node Type']}${node['Index Name'] ? ` ${node['Index Name']}` : node['Relation Name'] ? ` ${node['Relation Name']}` : ''} ` +
      `rows=${node['Actual Rows']} loops=${node['Actual Loops']} time=${node['Actual Total Time']} hit=${node['Shared Hit Blocks']} read=${node['Shared Read Blocks']}`,
    ...(node.Plans ?? []).flatMap((child) => tree(child, depth + 1)),
  ];
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

// 부하가 들쭉날쭉한 기계에서도 비교할 수 있게 여러 번 재어 중앙값을 쓴다.
console.log('| 화면 | 걸린 시간(ms, 중앙값) | DB 실행 합(ms, 중앙값) | 쿼리 수 | 가장 느린 쿼리(ms) |');
console.log('|---|---:|---:|---:|---:|');
for (const [name, run] of scenarios) {
  await run(); // 캐시를 데운다.
  const walls = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    await run();
    walls.push(performance.now() - started);
  }
  const explained = [];
  for (let i = 0; i < 3; i++) {
    recording = [];
    await run();
    explained.push(recording);
  }
  recording = null;
  const sum = (records) => records.reduce((total, r) => total + r.ms, 0);
  const records = explained.sort((a, b) => sum(a) - sum(b))[1];
  const slowest = records.reduce((a, b) => (b.ms > a.ms ? b : a), { ms: 0 });
  console.log(`| ${name} | ${median(walls).toFixed(1)} | ${sum(records).toFixed(1)} | ${records.length} | ${slowest.ms.toFixed(1)} |`);
  if (args.has('--plans') && slowest.plan) console.log(`  ${label(slowest.sql)}\n${tree(slowest.plan, 1).join('\n')}`);
}
await db.destroy();
