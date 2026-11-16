import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import request from 'supertest';
import { vi } from 'vitest';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { currentVibeSnapshot, snapshotEditableFiles, vibeVersion } from '../src/modules/vibe/vibe.snapshot.js';
import { createVibeTransport, loadVibeTransportSettings } from '../src/modules/vibe/vibe.transport.js';
import { base, bearer, createApp, register } from './helpers.js';
import { nativeVibeGateway } from './phase5-vibe-gateway.pipeline-helpers.js';

describe('dedicated Vibe through real mTLS forwarding and native execution', () => {
  it('persists the actual native assessment and preserves upstream auth and artifact cleanup', async () => {
    const startedAt = performance.now();
    const upstream = process.env.GO_JUDGE_URL!;
    const token = process.env.GO_JUDGE_TOKEN!;
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const checkoutSha = git('rev-parse', 'HEAD');
    const event = process.env.GITHUB_EVENT_PATH
      ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) as { pull_request?: { head?: { sha?: string }; base?: { sha?: string } } }
      : undefined;
    const report: Record<string, unknown> = {
      schemaVersion: 1, status: 'FAIL', timestamp: new Date().toISOString(),
      provenance: { checkoutSha, treeSha: git('rev-parse', 'HEAD^{tree}'),
        sourceHeadSha: event?.pull_request?.head?.sha ?? checkoutSha, baseSha: event?.pull_request?.base?.sha ?? null,
        runId: process.env.GITHUB_RUN_ID ?? null, runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
        trackedTreeClean: git('status', '--porcelain', '--untracked-files=no') === '' },
      limits: { testTimeoutMs: 90_000, gatewayRequests: 128, gatewayBytesPerDirection: 1_048_576,
        gatewayRequestTimeoutMs: 15_000, providerCalls: 0 },
      scope: 'Real HTTP API, PostgreSQL persistence, VibeRunner, ephemeral mTLS forwarding gateway and native go-judge. Only the paid evaluator is replaced by an unavailable-provider double.',
      limitations: [
        'The gateway is an owned Node HTTPS forwarding test fixture, not the production nginx configuration or a deployed dedicated host.',
        'The existing CI native sandbox is reused sequentially with unchanged upstream bearer forwarding; the application algorithm secret is an independent synthetic value.',
        'The browser is not part of this test. Existing Compose browser flows exercise embedded mode separately.',
        'Production network isolation, gateway software approval, certificate operations and provider quality remain UNVERIFIED.',
      ],
    };
    let gateway: Awaited<ReturnType<typeof nativeVibeGateway>> | undefined;
    let app: NestExpressApplication | undefined;
    let restoreEvaluation: (() => void) | undefined;
    let restoreConfiguration: (() => void) | undefined;
    try {
      gateway = await nativeVibeGateway(upstream, token);
      const listFiles = async () => {
        const response = await fetch(new URL('/file', upstream), { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
        expect(response.status).toBe(200);
        return Object.keys(await response.json()).sort();
      };
      const before = await listFiles();
      app = await createApp();
      await app.listen(0, '127.0.0.1');
      const config = app.get(ConfigService);
      // The test borrows the existing executor for a Vibe run. It does not
      // configure the API to share its algorithm and dedicated Vibe secret.
      // ConfigService.set also mutates process.env; a scoped configuration
      // fixture avoids leaking deleted certificate paths to another test app.
      const dedicatedSettings: Record<string, string> = { ...gateway.settings,
        GO_JUDGE_TOKEN: randomBytes(32).toString('hex') };
      const originalGet = config.get.bind(config);
      const routing = vi.spyOn(config, 'get').mockImplementation((...args: unknown[]) => {
        const name = args[0];
        return typeof name === 'string' && Object.hasOwn(dedicatedSettings, name)
          ? dedicatedSettings[name] : Reflect.apply(originalGet, undefined, args);
      });
      restoreConfiguration = () => { routing.mockRestore(); };
      const evaluation = vi.spyOn(app.get(VibeAi), 'evaluate').mockRejectedValue(new Error('Fixture provider unavailable'));
      restoreEvaluation = () => { evaluation.mockRestore(); };
      const content = currentVibeSnapshot();
      const files = { ...snapshotEditableFiles(content),
        'src/search.ts': `export function searchPosts(posts: {id:number;title:string;slug:string;tags:string[]}[], query='', tag='') {
          const q=query.trim().toLowerCase();
          return posts.filter(p=>(p.title.toLowerCase().includes(q)||p.slug.toLowerCase().includes(q))&&(!tag||p.tags.includes(tag)));
        }` };
      const account = await register(app, 'dedicated_vibe', randomUUID().slice(0, 8));
      const outsider = await register(app, 'dedicated_other', randomUUID().slice(0, 8));
      const http = () => request(app!.getHttpServer());
      const attempt = (await http().post(`${base}/vibe/challenges/${content.challenge.id}/attempts`)
        .set(bearer(account.accessToken)).expect(201)).body;
      const path = `${base}/vibe/attempts/${attempt.id}`;
      const saved = (await http().patch(`${path}/files`).set(bearer(account.accessToken))
        .send({ revision: 0, files }).expect(200)).body;
      const run = (await http().post(`${path}/runs`).set(bearer(account.accessToken))
        .send({ revision: saved.revision }).expect(201)).body;
      expect(run.runs).toHaveLength(1);
      expect(run.runs[0].checks.every((check: { passed: boolean }) => check.passed)).toBe(true);
      const submitted = (await http().post(`${path}/submit`).set(bearer(account.accessToken))
        .send({ revision: saved.revision, reflection: 'Dedicated native qualification' }).expect(201)).body;
      expect(submitted.report).toMatchObject({ total: 11, passed: 11, outcome: 40, evaluationStatus: 'unavailable' });
      expect(submitted.challengeVersion).toBe(vibeVersion(content));
      expect(submitted.files['src/search.ts']).toBe(files['src/search.ts']);
      expect(submitted.submittedAt).not.toBeNull();
      const reloaded = (await http().get(path).set(bearer(account.accessToken)).expect(200)).body;
      expect(reloaded.report).toEqual(submitted.report);
      expect(reloaded.challengeVersion).toBe(attempt.challengeVersion);
      await http().get(path).set(bearer(outsider.accessToken)).expect(404);
      expect(evaluation).toHaveBeenCalledOnce();
      expect(evaluation.mock.calls[0][0].challenge_version).toBe(attempt.challengeVersion);
      expect(JSON.stringify(reloaded)).not.toMatch(/hiddenChecks|assistSystem|reviewSystem|VIBE_SANDBOX_TOKEN/);
      const wrongBearer = createVibeTransport(loadVibeTransportSettings({ ...gateway.settings,
        VIBE_SANDBOX_TOKEN: randomBytes(32).toString('hex') }));
      try {
        const denied = await wrongBearer.request('/file', { signal: AbortSignal.timeout(5000) });
        expect([401, 403]).toContain(denied.status);
      } finally { wrongBearer.close(); }
      expect(await listFiles()).toEqual(before);
      expect(gateway.upstreamFailures).toBe(0);
      expect(gateway.observations.every((row) => row.mtls)).toBe(true);
      expect(gateway.observations.filter((row) => row.path === '/run' && row.status === 200).length).toBeGreaterThan(10);
      expect(gateway.observations.filter((row) => row.method === 'DELETE').length).toBe(4);
      const anonymous = gateway.observations.filter((row) => row.bearer === 'absent');
      expect(anonymous).toHaveLength(2);
      expect(anonymous.every((row) => [401, 403].includes(row.status))).toBe(true);
      expect(gateway.observations.some((row) => row.bearer === 'other' && [401, 403].includes(row.status))).toBe(true);
      report.assessment = { publicChecks: run.runs[0].checks.length, finalPassed: submitted.report.passed,
        finalTotal: submitted.report.total, evaluationStatus: submitted.report.evaluationStatus, persisted: true,
        ownershipDenied: true, artifactDelta: 0 };
      report.status = 'PASS';
    } finally {
      restoreEvaluation?.();
      restoreConfiguration?.();
      const cleanupFailures: unknown[] = [];
      await app?.close().catch((error: unknown) => { cleanupFailures.push(error); });
      await gateway?.close().catch((error: unknown) => { cleanupFailures.push(error); });
      if (cleanupFailures.length) report.status = 'FAIL';
      report.gateway = gateway ? { requests: gateway.observations, upstreamFailures: gateway.upstreamFailures,
        closed: gateway.closed } : null;
      report.cleanupFailures = cleanupFailures.length;
      report.elapsedMs = performance.now() - startedAt;
      await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
      await writeFile(new URL('../reports/phase5-vibe-dedicated.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
      expect(cleanupFailures.length).toBe(0);
    }
  });
});
