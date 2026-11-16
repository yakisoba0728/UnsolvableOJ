import { Queue } from 'bullmq';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import { cpus, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { JUDGE_QUEUE } from '../src/common/queue.constants.js';
import {
  disposableDatabaseUrl,
  startOwnedProcess, stopOwnedProcess, type OwnedProcess,
} from './process.pipeline-helpers.js';
import { DeadlineScope, multiApiBudgets, ownedPostgres, ownedRedis } from './phase5-multi-api.pipeline-helpers.js';

const base = '/api/v1';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const languages = ['C', 'CPP', 'JAVA', 'PYTHON', 'JAVASCRIPT', 'TYPESCRIPT', 'GO', 'RUST'] as const;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const scenarioLimitMs = multiApiBudgets.actionMs;
const childHeapMb = 256;

interface StoredSubmission {
  id: string; language: string; source: string; status: string; generation: number;
  attempt: string | null; recoveries: number; learned: boolean; isTest: boolean;
  runtimeMs: number; memoryKb: number; passedTestCases: number; totalTestCases: number;
  createdAt: Date; updatedAt: Date; notifications: number;
}
interface Measurement {
  event: 'judge_completed'; workerId: string; submissionId: string; generation: number;
  language: string; status: string; queueWaitMs: number; claimMs: number; judgeMs: number;
  reportMs: number; totalMs: number; processCpuUserUs: number; processCpuSystemUs: number;
  processRssBytes: number; processPeakRssKiB: number;
}
interface ApiProcess { owned: OwnedProcess; url: string; port: number }
interface Observers {
  scope: DeadlineScope; postgres: ReturnType<typeof ownedPostgres>; redis: ReturnType<typeof ownedRedis>;
  queue?: Queue; queueClosed?: Promise<void>; queueCloseFailed?: boolean;
}
interface JobObservation {
  index: number; language: string; sourceSha256: string; apiIndex: number;
  submittedAtEpochMs: number; acknowledgedAtEpochMs?: number; apiElapsedMs?: number;
  httpStatus?: number; rateLimit?: { limit: number; remaining: number; resetSeconds: number };
  submissionId?: string; jobId?: string; lastStatus?: string; lastQueueState?: string;
  queue?: { timestampEpochMs: number; processedOnEpochMs: number; finishedOnEpochMs: number;
    attemptsMade: number; attemptsStarted: number; generation: number; state: string };
  persisted?: Omit<StoredSubmission, 'source'> & { sourceSha256: string };
  readThroughApiIndex?: number; workerIndex?: number; replayThroughApiIndex?: number;
  finalClaimHttpStatus?: number; duplicateResultHttpStatus?: number;
}

// procfs is read only for PIDs created by this test. A namespace-wide socket
// entry alone is insufficient: match the listener inode to that child's fds.
async function listenerObservation(api: ApiProcess, scope: DeadlineScope) {
  const pid = api.owned.child.pid!;
  const fds = await scope.run(() => readdir(`/proc/${pid}/fd`));
  const links = await Promise.all(fds.map((fd) => scope.run(() => readlink(`/proc/${pid}/fd/${fd}`).catch(() => ''))));
  const inodes = new Set(links.map((link) => /^socket:\[(\d+)\]$/.exec(link)?.[1]).filter(Boolean));
  const listeners = [];
  for (const protocol of ['tcp', 'tcp6']) {
    const table = await scope.run((signal) => readFile(`/proc/${pid}/net/${protocol}`, { encoding: 'utf8', signal }));
    for (const line of table.trim().split('\n').slice(1)) {
      const fields = line.trim().split(/\s+/);
      if (fields[3] === '0A' && inodes.has(fields[9]))
        listeners.push({ protocol, rawLocalAddress: fields[1], inode: fields[9] });
    }
  }
  return { pid, requestedHost: '127.0.0.1', listeners };
}

async function processSample(owned: OwnedProcess, scope: DeadlineScope) {
  const pid = owned.child.pid!;
  const [status, stat] = await Promise.all([
    scope.run((signal) => readFile(`/proc/${pid}/status`, { encoding: 'utf8', signal })),
    scope.run((signal) => readFile(`/proc/${pid}/stat`, { encoding: 'utf8', signal })),
  ]);
  const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
  const sample = { pid, sampledAtEpochMs: Date.now(),
    rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),
    peakRssKiB: Number(status.match(/^VmHWM:\s+(\d+)/m)?.[1]),
    userCpuTicks: Number(fields[11]), systemCpuTicks: Number(fields[12]),
  };
  for (const value of Object.values(sample)) expect(Number.isFinite(value)).toBe(true);
  expect(sample.rssKiB).toBeGreaterThan(0);
  expect(sample.peakRssKiB).toBeGreaterThanOrEqual(sample.rssKiB);
  return sample;
}

function measurements(owned: OwnedProcess): Measurement[] {
  return owned.log.split('\n').filter((line) => line.startsWith('{')).flatMap((line) => {
    let raw: Measurement;
    try { raw = JSON.parse(line) as Measurement; } catch { return []; }
    if (raw.event !== 'judge_completed') return [];
    // Retain only the worker's numeric/identifier measurement contract, never
    // free-form stdout, request bodies, source text, environment or credentials.
    return [{ event: raw.event, workerId: raw.workerId, submissionId: raw.submissionId,
      generation: raw.generation, language: raw.language, status: raw.status, queueWaitMs: raw.queueWaitMs,
      claimMs: raw.claimMs, judgeMs: raw.judgeMs, reportMs: raw.reportMs, totalMs: raw.totalMs,
      processCpuUserUs: raw.processCpuUserUs, processCpuSystemUs: raw.processCpuSystemUs,
      processRssBytes: raw.processRssBytes, processPeakRssKiB: raw.processPeakRssKiB }];
  });
}

function maximumOverlap(jobs: JobObservation[]) {
  const events = jobs.flatMap((job) => [
    { time: job.queue!.processedOnEpochMs, delta: 1 },
    { time: job.queue!.finishedOnEpochMs, delta: -1 },
  ]).sort((a, b) => a.time - b.time || a.delta - b.delta);
  let active = 0;
  let maximum = 0;
  for (const event of events) { active += event.delta; maximum = Math.max(maximum, active); }
  expect(active).toBe(0);
  return maximum;
}

describe('bounded real multi-API native qualification', () => {
  it('finishes eight languages through two API processes and two workers with shared admission and fenced persistence', async ({ signal }) => {
    const started = performance.now();
    const actions = new DeadlineScope(scenarioLimitMs, 'Multi-API actions', signal);
    const processes: OwnedProcess[] = [];
    const apis: ApiProcess[] = [];
    const workers: OwnedProcess[] = [];
    const observations: JobObservation[] = [];
    const cleanupFailures: string[] = [];
    const removedJobIds: string[] = [];
    const observers: Observers[] = [];
    let db: ReturnType<typeof ownedPostgres> | undefined;
    let queue: Queue | undefined;
    let databaseUrl: string | undefined;
    let solverId: string | undefined;
    let solverToken = '';
    let problemId: string | undefined;
    let nativeFilesBefore: string[] | undefined;
    let phase = 'provenance';
    let failure: unknown;
    let bodyPassed = false;
    const report: Record<string, unknown> = {
      schemaVersion: 1, status: 'FAIL', timestamp: new Date().toISOString(),
      sourceFixture: 'Judge/runtime/smoke-sources.json',
      topology: 'Two actual dist/main.js child processes and two actual Judge/dist/worker.js child processes on one disposable CI host; one shared PostgreSQL database, Redis database and native executor.',
      limits: { submissions: 8, languages: 8, solverAccounts: 1, admissionLanes: 3,
        apiProcesses: 2, workerProcesses: 2, concurrencyPerWorker: 1, childV8HeapMb: childHeapMb,
        submissionRateLimit: 20, submissionWindowMs: 60_000, scenarioMs: scenarioLimitMs,
        existingTestTimeoutMs: multiApiBudgets.existingTestMs, cleanupProcessPhaseMs: multiApiBudgets.processStopPhaseMs,
        cleanupIoBudgetMs: multiApiBudgets.cleanupOperationsMs + multiApiBudgets.connectionDrainMs,
        reportBudgetMs: multiApiBudgets.reportMs, totalBudgetMs: 84_000,
        observerDatabaseConnectionsPerPhase: 1, observerQueryTimeoutMs: 2000, observerRedisCommandTimeoutMs: 2000,
        compileTimeMs: 30_000, compileMemoryMb: 1024, executionTimeMs: 2000, executionMemoryMb: 256,
        providerCalls: 0, processLogCharactersPerChild: 100_000 },
      observations,
      limitations: [
        'One finite eight-job protocol, not a saturation, capacity, p95/p99, long-term memory or production fault-domain measurement.',
        'A bounded observer resets test Redis throttle counters once before owned API setup; no counter resets, extra solver accounts, bypass headers or retries occur during the protocol.',
        'The API clients use loopback URLs; actual listeners are separately observed by PID and socket inode. This does not establish a firewall or production network policy.',
        'Queue timestamps and API/DB dates are host wall clocks; worker phase durations use performance.now. Queue start/finish bracket BullMQ work, not native instruction execution.',
        'One procfs resource sample per owned child and cumulative worker metrics describe Node processes, not native compilers, sandbox processes or total host resource use.',
        'Claim checks cover one observed active Go lease and terminal claims; no API, Redis or native outage is injected.',
      ],
    };

    const remaining = (maximum = 5000) => actions.remaining(maximum);
    async function until(check: () => Promise<boolean>, maximum: number = scenarioLimitMs, interval = 100) {
      const polling = new DeadlineScope(remaining(maximum), `Multi-API ${phase} observation`, actions.signal);
      try {
        while (true) {
          if (await polling.run(check)) return;
          await polling.run((signal) => delay(Math.min(interval, polling.remaining()), undefined, { signal }));
        }
      } finally { polling.close(); }
    }
    async function json(apiIndex: number, method: string, path: string, headers: Record<string, string>, body?: unknown, timeout = 5000) {
      const response = await actions.run((signal) => fetch(`${apis[apiIndex].url}${base}${path}`, {
        method, redirect: 'error', headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.any([signal, AbortSignal.timeout(remaining(timeout))]),
      }));
      return { status: response.status, headers: response.headers, body: await actions.run(() => response.json()) as Record<string, unknown> };
    }
    async function state(id: string) {
      remaining();
      const [row] = await db!.query<StoredSubmission>(`SELECT id, language, source_code AS source, status,
        judge_generation AS generation, judge_attempt_id AS attempt, recovery_count AS recoveries,
        completed_for_learning AS learned, is_test AS "isTest", runtime_ms AS "runtimeMs", memory_kb AS "memoryKb",
        passed_test_cases AS "passedTestCases", total_test_cases AS "totalTestCases", created_at AS "createdAt", updated_at AS "updatedAt",
        (SELECT count(*)::int FROM notifications n WHERE n.submission_id=s.id AND n.type='JUDGED') AS notifications
        FROM submissions s WHERE id=$1`, [id]);
      expect(row).toBeDefined();
      return row;
    }
    async function nativeFiles(scope: DeadlineScope) {
      const response = await scope.run((signal) => fetch(new URL('/file', process.env.GO_JUDGE_URL!), {
        headers: { Authorization: `Bearer ${process.env.GO_JUDGE_TOKEN!}` }, redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(scope.remaining(3000))]),
      }));
      expect(response.status).toBe(200);
      return Object.keys(await scope.run(() => response.json())).sort();
    }
    async function connectObservers(scope: DeadlineScope) {
      scope.remaining();
      const postgres = ownedPostgres(scope, databaseUrl!, process.env.DATABASE_SSL === 'true');
      const redis = ownedRedis(scope, { host: process.env.REDIS_HOST, port: Number(process.env.REDIS_PORT),
        username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined, db: Number(process.env.REDIS_DB) });
      const owned: Observers = { scope, postgres, redis };
      observers.push(owned); // Before either asynchronous connect starts.
      await Promise.all([postgres.connect(), redis.connect()]);
      scope.remaining();
      owned.queue = new Queue(JUDGE_QUEUE, { connection: redis.client });
      scope.own(() => { owned.queueClosed = owned.queue!.close().catch(() => { owned.queueCloseFailed = true; }); });
      await scope.run(() => owned.queue!.waitUntilReady());
      return owned;
    }
    const judgeHeaders = (attempt: string) => ({ 'X-Judge-Token': process.env.JUDGE_SERVICE_TOKEN!,
      'X-Judge-Generation': '1', 'X-Judge-Attempt': attempt });

    try {
      await actions.run(() => mkdir(new URL('../reports/', import.meta.url), { recursive: true }));
      const git = (...args: string[]) => {
        const value = execFileSync('git', args, { encoding: 'utf8', timeout: remaining(2000) }).trim();
        remaining();
        return value;
      };
      const checkoutSha = git('rev-parse', 'HEAD');
      const event = process.env.GITHUB_EVENT_PATH
        ? JSON.parse(await actions.run((signal) => readFile(process.env.GITHUB_EVENT_PATH!, { encoding: 'utf8', signal }))) as { pull_request?: { head?: { sha?: string }; base?: { sha?: string } } }
        : undefined;
      report.provenance = { checkoutSha, treeSha: git('rev-parse', 'HEAD^{tree}'),
        sourceHeadSha: event?.pull_request?.head?.sha ?? checkoutSha, baseSha: event?.pull_request?.base?.sha ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        trackedTreeClean: git('status', '--porcelain', '--untracked-files=no') === '' };
      report.environment = { node: process.version, platform: process.platform, release: release(),
        cpuModel: cpus()[0]?.model ?? null, logicalCpus: cpus().length,
        clockTicksPerSecond: Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: remaining(2000) }).trim()) };
      expect(process.platform).toBe('linux');
      databaseUrl = disposableDatabaseUrl();
      expect(['127.0.0.1', 'localhost', '::1']).toContain(process.env.REDIS_HOST);
      expect(Number(process.env.REDIS_DB)).toBe(Number(process.env.PIPELINE_REDIS_DB ?? 2));
      const nativeUrl = new URL(process.env.GO_JUDGE_URL!);
      expect(['http:', 'https:']).toContain(nativeUrl.protocol);
      expect(['127.0.0.1', 'localhost', '[::1]']).toContain(nativeUrl.hostname);
      expect(nativeUrl.username + nativeUrl.password + nativeUrl.search + nativeUrl.hash).toBe('');
      const sources = JSON.parse(await actions.run((signal) => readFile(new URL('../../Judge/runtime/smoke-sources.json', import.meta.url), { encoding: 'utf8', signal }))) as Record<string, string>;
      expect(Object.keys(sources).sort()).toEqual([...languages].sort());
      nativeFilesBefore = await nativeFiles(actions);

      phase = 'owned observer setup';
      const initialObservers = await connectObservers(actions);
      db = initialObservers.postgres;
      queue = initialObservers.queue!;
      expect((await db.query<{ name: string }>('SELECT current_database() AS name'))[0].name).toBe(process.env.UNSOLVABLE_TEST_DATABASE);
      report.sharedState = { databaseName: process.env.UNSOLVABLE_TEST_DATABASE, redisDb: Number(process.env.REDIS_DB) };
      const keys = await actions.run(() => initialObservers.redis.client.keys('throttle:*'));
      if (keys.length) await actions.run(() => initialObservers.redis.client.del(...keys));
      report.preSetupThrottleResets = 1;

      phase = 'owned process readiness';
      for (let index = 0; index < 2; index++) {
        remaining();
        const owned = startOwnedProcess(processes, 'dist/main.js', {
          NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '0', NODE_OPTIONS: `--max-old-space-size=${childHeapMb}`,
          EMAIL_ENABLED: 'false', EMAIL_WORKER_ENABLED: 'false', OPENAI_API_KEY: '',
          VIBE_EXECUTION_MODE: 'embedded', VIBE_SANDBOX_URL: '', VIBE_SANDBOX_TOKEN: '',
          VIBE_SANDBOX_TLS_CA_FILE: '', VIBE_SANDBOX_TLS_CERT_FILE: '', VIBE_SANDBOX_TLS_KEY_FILE: '', VIBE_SANDBOX_TLS_SERVERNAME: '',
        });
        // The child owns its kernel-assigned port. There is no parent listener
        // whose asynchronous reservation could complete after cancellation.
        apis.push({ owned, port: 0, url: '' });
      }
      const listeners: unknown[] = [];
      await Promise.all(apis.map((api, index) => until(async () => {
        expect(api.owned.child.exitCode).toBeNull();
        expect(api.owned.child.signalCode).toBeNull();
        const observed = await listenerObservation(api, actions);
        if (observed.listeners.length === 0) return false;
        expect(observed.listeners).toHaveLength(1);
        expect(observed.listeners[0].protocol).toBe('tcp');
        const [address, portHex] = observed.listeners[0].rawLocalAddress.split(':');
        expect(address).toBe('0100007F');
        api.port = Number.parseInt(portHex, 16);
        expect(api.port).toBeGreaterThan(0);
        api.url = `http://127.0.0.1:${api.port}`;
        listeners[index] = { ...observed, requestedPort: 0, observedPort: api.port, clientUrl: api.url };
        try { return (await json(index, 'GET', '/health', {}, undefined, 500)).status === 200; }
        catch { return false; }
      }, 15_000, 500)));
      report.apiListeners = listeners;
      expect(new Set(apis.map((api) => api.port)).size).toBe(2);

      phase = 'fixture setup through owned API';
      const suffix = randomUUID().slice(0, 8);
      const password = 'test-password-123';
      async function registerAccount(name: string) {
        const registered = await json(0, 'POST', '/auth/register', {}, {
          email: `${name}-${suffix}@example.com`, username: `${name}_${suffix}`, password,
        });
        expect(registered.status).toBe(201);
        return registered.body as { user: { id: string; email: string; role: string }; accessToken: string };
      }
      const admin = await registerAccount('multiapi_admin');
      const solver = await registerAccount('multiapi_solver');
      solverId = solver.user.id;
      solverToken = solver.accessToken;
      await db.query("UPDATE users SET role='ADMIN' WHERE id=$1", [admin.user.id]);
      const loggedIn = await json(0, 'POST', '/auth/login', {}, { email: admin.user.email, password });
      expect(loggedIn.status).toBe(200);
      const created = await json(0, 'POST', '/problems', bearer(loggedIn.body.accessToken as string), {
        slug: `multiapi-${suffix}`, title: 'Bounded multi-API sum', statementMarkdown: 'Add two integers.',
        inputDescriptionMarkdown: 'Two integers', outputDescriptionMarkdown: 'Sum', difficulty: 'BEGINNER',
        status: 'PUBLISHED', timeLimitMs: 2000, memoryLimitMb: 256,
        testCases: [{ input: '1 2\n', expectedOutput: '3\n', isSample: true }],
      });
      expect(created.status).toBe(201);
      problemId = created.body.id as string;
      report.fixtureApiIndex = 0;
      report.inProcessNestContexts = 0;
      for (let index = 0; index < 2; index++) {
        remaining();
        workers.push(startOwnedProcess(processes, '../Judge/dist/worker.js', {
          API_BASE_URL: `${apis[index].url}${base}`, JUDGE_CONCURRENCY: '1', JUDGE_METRICS: 'json',
          NODE_OPTIONS: `--max-old-space-size=${childHeapMb}`, JUDGE_HEARTBEAT_FILE: '',
        }));
      }
      await Promise.all(workers.map((worker) => until(async () => {
        expect(worker.child.exitCode).toBeNull();
        expect(worker.child.signalCode).toBeNull();
        return worker.log.includes('Judge worker ready');
      }, 15_000)));
      expect(new Set(processes.map((owned) => owned.child.pid)).size).toBe(4);

      phase = 'eight-job admission and native completion';
      let next = 0;
      let activeLanes = 0;
      let maximumActiveLanes = 0;
      let activeClaimObserved = false;
      const batchStarted = performance.now();
      async function lane() {
        try {
          while (next < languages.length) {
            remaining();
            const index = next++;
            const language = languages[index];
            const apiIndex = index % 2;
            activeLanes++;
            maximumActiveLanes = Math.max(maximumActiveLanes, activeLanes);
            const observation: JobObservation = { index, language, sourceSha256: sha256(sources[language]),
              apiIndex, submittedAtEpochMs: Date.now() };
            observations.push(observation);
            try {
              const sent = performance.now();
              const accepted = await json(apiIndex, 'POST', `/problems/${problemId}/submissions`, bearer(solverToken),
                { language, sourceCode: sources[language] });
              Object.assign(observation, { acknowledgedAtEpochMs: Date.now(), apiElapsedMs: performance.now() - sent,
                httpStatus: accepted.status, rateLimit: { limit: Number(accepted.headers.get('x-ratelimit-limit')),
                  remaining: Number(accepted.headers.get('x-ratelimit-remaining')), resetSeconds: Number(accepted.headers.get('x-ratelimit-reset')) } });
              expect(accepted.status).toBe(202);
              const id = accepted.body.id as string;
              expect(id).toMatch(/^[a-f0-9-]{36}$/);
              observation.submissionId = id;
              observation.jobId = `${id}-1`;
              expect(observation.rateLimit!.limit).toBe(20);
              expect(Number.isInteger(observation.rateLimit!.remaining)).toBe(true);
              expect(accepted.headers.has('x-ratelimit-reset')).toBe(true);
              expect(Number.isInteger(observation.rateLimit!.resetSeconds)).toBe(true);
              expect(observation.rateLimit!.resetSeconds).toBeGreaterThanOrEqual(0);
              expect(observation.rateLimit!.resetSeconds).toBeLessThanOrEqual(60);
              await until(async () => {
                const row = await state(id);
                observation.lastStatus = row.status;
                const job = await actions.run(() => queue!.getJob(observation.jobId!));
                observation.lastQueueState = job ? await actions.run(() => job.getState()) : undefined;
                expect(['QUEUED', 'JUDGING', 'ACCEPTED']).toContain(row.status);
                expect(observation.lastQueueState).not.toBe('failed');
                if (language === 'GO' && row.status === 'JUDGING' && row.attempt && !activeClaimObserved) {
                  const competingAttempt = randomUUID();
                  const beforeAtEpochMs = Date.now();
                  const conflicts = await Promise.all(apis.map(async (_, claimApiIndex) => ({ apiIndex: claimApiIndex,
                    httpStatus: (await json(claimApiIndex, 'GET', `/internal/judge/submissions/${id}`, judgeHeaders(competingAttempt))).status })));
                  const after = await state(id);
                  report.activeClaimConflict = { submissionId: id, language, originalAttempt: row.attempt,
                    competingAttempt, beforeAtEpochMs, afterAtEpochMs: Date.now(),
                    beforeStatus: row.status, afterStatus: after.status, afterAttempt: after.attempt, conflicts };
                  expect(conflicts.map((item) => item.httpStatus)).toEqual([409, 409]);
                  expect(after).toMatchObject({ status: 'JUDGING', attempt: row.attempt, generation: 1, recoveries: 0 });
                  activeClaimObserved = true;
                }
                return row.status === 'ACCEPTED' && observation.lastQueueState === 'completed';
              });
              const final = await state(id);
              const job = (await actions.run(() => queue!.getJob(observation.jobId!)))!;
              observation.queue = { timestampEpochMs: job.timestamp, processedOnEpochMs: job.processedOn!, finishedOnEpochMs: job.finishedOn!,
                attemptsMade: job.attemptsMade, attemptsStarted: job.attemptsStarted, generation: job.data.generation as number, state: await actions.run(() => job.getState()) };
              const { source, ...persisted } = final;
              observation.persisted = { ...persisted, sourceSha256: sha256(source) };
              expect(final).toMatchObject({ language, status: 'ACCEPTED', generation: 1, recoveries: 0, learned: true,
                isTest: false, passedTestCases: 1, totalTestCases: 1, notifications: 1 });
              expect(final.attempt).toMatch(/^[a-f0-9-]{36}$/);
              expect(sha256(source)).toBe(observation.sourceSha256);
              expect(job.data).toEqual({ submissionId: id, generation: 1 });
              expect(observation.queue).toMatchObject({ attemptsMade: 1, attemptsStarted: 1, generation: 1, state: 'completed' });
              expect(job.timestamp).toBeGreaterThanOrEqual(observation.submittedAtEpochMs);
              expect(job.processedOn!).toBeGreaterThanOrEqual(job.timestamp);
              expect(job.finishedOn!).toBeGreaterThan(job.processedOn!);
              observation.readThroughApiIndex = 1 - apiIndex;
              const read = await json(1 - apiIndex, 'GET', `/submissions/${id}`, bearer(solverToken));
              expect(read.status).toBe(200);
              expect(read.body).toMatchObject({ id, status: 'ACCEPTED', language, judgeGeneration: 1, runtimeMs: final.runtimeMs,
                memoryKb: final.memoryKb, passedTestCases: 1, totalTestCases: 1, completedForLearning: true });
              expect(sha256(read.body.sourceCode as string)).toBe(observation.sourceSha256);
            } finally { activeLanes--; }
          }
        } catch (error) { actions.close(error); throw error; }
      }
      const lanes = await Promise.allSettled([lane(), lane(), lane()]);
      const rejectedLane = lanes.find((result) => result.status === 'rejected');
      if (rejectedLane?.status === 'rejected') throw rejectedLane.reason;
      report.admission = { requests: next, maximumActiveLanes, activeBatchMs: performance.now() - batchStarted,
        counterResetsDuringProtocol: 0, submissionRetries: 0, solverRole: solver.user.role };
      expect(maximumActiveLanes).toBe(3);
      expect(solver.user.role).toBe('USER');
      expect(activeClaimObserved).toBe(true);
      expect(observations).toHaveLength(8);
      expect(observations.filter((row) => row.apiIndex === 0)).toHaveLength(4);
      expect(observations.filter((row) => row.apiIndex === 1)).toHaveLength(4);
      expect(observations.map((row) => row.rateLimit!.remaining).sort((a, b) => a - b)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
      expect(new Set(observations.map((row) => row.submissionId)).size).toBe(8);
      expect(new Set(observations.map((row) => row.persisted!.attempt)).size).toBe(8);

      phase = 'worker participation and cross-API result replay';
      await until(async () => workers.reduce((count, worker) => count + measurements(worker).length, 0) >= 8, 2000);
      const measured = workers.map(measurements);
      report.workerMeasurements = measured.map((rows, index) => ({ workerIndex: index, pid: workers[index].child.pid, apiIndex: index, rows }));
      const allMeasured = measured.flat();
      expect(allMeasured).toHaveLength(8);
      expect(new Set(allMeasured.map((row) => row.submissionId)).size).toBe(8);
      expect(new Set(allMeasured.map((row) => row.workerId)).size).toBe(2);
      for (let index = 0; index < workers.length; index++) {
        expect(measured[index].length).toBeGreaterThan(0);
        expect(new Set(measured[index].map((row) => row.workerId)).size).toBe(1);
        for (const metric of measured[index]) {
          expect(metric).toMatchObject({ status: 'ACCEPTED', generation: 1 });
          for (const key of ['queueWaitMs', 'claimMs', 'judgeMs', 'reportMs', 'totalMs', 'processCpuUserUs',
            'processCpuSystemUs', 'processRssBytes', 'processPeakRssKiB'] as const) {
            expect(Number.isFinite(metric[key])).toBe(true);
            expect(metric[key]).toBeGreaterThanOrEqual(0);
          }
          const observed = observations.find((row) => row.submissionId === metric.submissionId)!;
          expect(observed.language).toBe(metric.language);
          observed.workerIndex = index;
        }
        expect(maximumOverlap(observations.filter((row) => row.workerIndex === index))).toBe(1);
      }
      const maximumActiveJobs = maximumOverlap(observations);
      report.workerBound = { configuredTotal: 2, maximumObservedQueueOverlap: maximumActiveJobs,
        perWorkerMaximumObservedQueueOverlap: workers.map((_, index) => maximumOverlap(observations.filter((row) => row.workerIndex === index))) };
      expect(maximumActiveJobs).toBeLessThanOrEqual(2);
      for (const observed of observations) {
        const id = observed.submissionId!;
        const before = await state(id);
        const otherApi = 1 - observed.workerIndex!;
        observed.replayThroughApiIndex = otherApi;
        const claim = await json(otherApi, 'GET', `/internal/judge/submissions/${id}`, judgeHeaders(randomUUID()));
        observed.finalClaimHttpStatus = claim.status;
        expect(claim.status).toBe(409);
        const duplicate = await json(otherApi, 'PATCH', `/internal/judge/submissions/${id}/result`, judgeHeaders(before.attempt!), {
          status: before.status, runtimeMs: before.runtimeMs, memoryKb: before.memoryKb,
          passedTestCases: before.passedTestCases, totalTestCases: before.totalTestCases,
        });
        observed.duplicateResultHttpStatus = duplicate.status;
        expect(duplicate.status).toBe(200);
        expect(await state(id)).toEqual(before);
      }
      const [{ submissions, learned, notifications }] = await db.query<{ submissions: number; learned: number; notifications: number }>(`SELECT count(*)::int AS submissions,
        count(*) FILTER (WHERE completed_for_learning)::int AS learned,
        (SELECT count(*)::int FROM notifications WHERE user_id=$1 AND type='JUDGED') AS notifications
        FROM submissions WHERE user_id=$1 AND problem_id=$2`, [solverId, problemId]);
      const solves = await db.query<{ awarded_xp: number; accepted_submission_id: string }>('SELECT awarded_xp, accepted_submission_id FROM user_problem_solves WHERE user_id=$1 AND problem_id=$2', [solverId, problemId]);
      const [{ xp }] = await db.query<{ xp: number }>('SELECT xp FROM users WHERE id=$1', [solverId]);
      report.persistence = { submissions, learned, notifications, solves, xp, resultReplays: observations.length };
      expect({ submissions, learned, notifications, xp }).toEqual({ submissions: 8, learned: 8, notifications: 8, xp: 10 });
      expect(solves).toEqual([{ awarded_xp: 10, accepted_submission_id: expect.any(String) }]);
      expect(observations.some((row) => row.submissionId === solves[0].accepted_submission_id)).toBe(true);
      report.processSamples = await Promise.all(processes.map((owned) => processSample(owned, actions)));
      for (const owned of processes) { expect(owned.child.exitCode).toBeNull(); expect(owned.child.signalCode).toBeNull(); }
      remaining();
      report.scenarioElapsedMs = performance.now() - started;
      bodyPassed = true;
    } catch (error) {
      failure = error;
      report.failure = { phase, name: error instanceof Error ? error.name : 'UnknownError' };
    } finally {
      report.scenarioElapsedMs ??= performance.now() - started;
      actions.close(); // Force-close action observers, including pending connect.
      report.workerMeasurements ??= workers.map((worker, index) => ({ workerIndex: index, pid: worker.child.pid, apiIndex: index, rows: measurements(worker) }));
      const cleanupStarted = performance.now();
      // Await both parallel stop phases: at most 15 seconds for workers, then
      // at most 15 for APIs. The shared integration runner is the outer fallback.
      for (const [kind, group] of [['worker', workers], ['api', apis.map((api) => api.owned)]] as const) {
        const stopped = await Promise.allSettled(group.map((owned) => stopOwnedProcess(owned)));
        stopped.forEach((result, index) => { if (result.status === 'rejected') cleanupFailures.push(`${kind}-${index}-stop`); });
      }
      // Action observers are already closed. Fresh cleanup observers have their
      // own short lifetime; expiry destroys transports instead of abandoning I/O.
      const cleanup = new DeadlineScope(multiApiBudgets.cleanupOperationsMs, 'Multi-API cleanup');
      try {
        if (databaseUrl && solverId && problemId) {
          try {
            const owned = await connectObservers(cleanup);
            const cleanupQueue = owned.queue!;
            // Recover IDs from a lost POST response, scoped to this fresh
            // solver/problem. Never drain or reset the shared queue.
            const ownedRows = await owned.postgres.query<{ id: string; generation: number }>('SELECT id, judge_generation AS generation FROM submissions WHERE user_id=$1 AND problem_id=$2', [solverId, problemId]);
            expect(ownedRows.length).toBeLessThanOrEqual(8);
            for (const row of ownedRows) {
              expect(row.generation).toBeGreaterThanOrEqual(1);
              expect(row.generation).toBeLessThanOrEqual(6);
              for (let generation = 1; generation <= row.generation; generation++) {
                const id = `${row.id}-${generation}`;
                const job = await cleanup.run(() => cleanupQueue.getJob(id));
                if (job) await cleanup.run(() => job.remove());
                expect(await cleanup.run(() => cleanupQueue.getJob(id))).toBeUndefined();
                removedJobIds.push(id);
              }
            }
          } catch { cleanupFailures.push('owned-queue-jobs'); }
        }
        if (nativeFilesBefore) {
          try {
            const after = await nativeFiles(cleanup);
            report.nativeArtifacts = { before: nativeFilesBefore, after };
            expect(after).toEqual(nativeFilesBefore);
          } catch { cleanupFailures.push('native-artifacts'); }
        }
      } finally { cleanup.close(); }
      const drain = new DeadlineScope(multiApiBudgets.connectionDrainMs, 'Multi-API connection drain');
      try {
        await drain.run(() => Promise.all([actions.settled(), cleanup.settled(),
          ...observers.flatMap((owned) => [owned.postgres.closed, owned.redis.closed, owned.queueClosed ?? Promise.resolve()]) ]));
        for (const owned of observers) {
          expect(owned.postgres.socket.destroyed).toBe(true);
          expect(owned.redis.client.status).toBe('end');
          expect(owned.queueCloseFailed).not.toBe(true);
          expect(owned.scope.closeFailures).toEqual([]);
        }
      } catch { cleanupFailures.push('observer-connections'); }
      finally { drain.close(); }
      report.cleanup = { failures: cleanupFailures, removedJobIds, elapsedMs: performance.now() - cleanupStarted,
        processes: processes.map((owned) => ({ pid: owned.child.pid, exitCode: owned.child.exitCode, signal: owned.child.signalCode })),
        observers: observers.map((owned) => ({ postgresSocketDestroyed: owned.postgres.socket.destroyed,
          redisStatus: owned.redis.client.status, queueCloseFailed: owned.queueCloseFailed === true,
          pendingOperations: owned.scope.pendingCount, forceCloseFailures: owned.scope.closeFailures })) };
      report.elapsedMs = performance.now() - started;
      report.status = bodyPassed && cleanupFailures.length === 0 ? 'PASS' : 'FAIL';
      const reporting = new DeadlineScope(multiApiBudgets.reportMs, 'Multi-API report');
      try {
        await reporting.run(() => mkdir(new URL('../reports/', import.meta.url), { recursive: true }));
        await reporting.run((signal) => writeFile(new URL('../reports/phase5-multi-api.json', import.meta.url),
          JSON.stringify(report, null, 2) + '\n', { signal }));
      } finally { reporting.close(); }
    }
    if (failure) throw failure;
    expect(bodyPassed).toBe(true);
    expect(cleanupFailures).toEqual([]);
  });
});
