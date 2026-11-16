import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { vi } from 'vitest';
import { VibeAi } from '../src/modules/vibe/vibe.ai.js';
import { VibeRunner } from '../src/modules/vibe/vibe.runner.js';
import {
  currentVibeSnapshot,
  snapshotEditableFiles,
  vibeVersion,
} from '../src/modules/vibe/vibe.snapshot.js';
import { base, bearer, createApp, register } from './helpers.js';

/** Real bounded go-judge executions. The CI owns this sandbox; no AI/provider calls. */
describe('Vibe project grading through the native sandbox', () => {
  const runner = new VibeRunner(
    new ConfigService({
      VIBE_SANDBOX_URL: process.env.GO_JUDGE_URL,
      VIBE_SANDBOX_TOKEN: process.env.GO_JUDGE_TOKEN,
    }),
  );
  const content = currentVibeSnapshot();
  const files = {
    ...snapshotEditableFiles(content),
    'src/search.ts': `export function searchPosts(posts: {id:number;title:string;slug:string;tags:string[]}[], query='', tag='') {
      const q=query.trim().toLowerCase();
      return posts.filter(p=>(p.title.toLowerCase().includes(q)||p.slug.toLowerCase().includes(q))&&(!tag||p.tags.includes(tag)));
    }`,
  };

  it('passes the public/own-test flow and the same saved solution against all selected hidden cases', async () => {
    const publicRun = await runner.run(files, false, content);
    expect(publicRun).toHaveLength(content.publicChecks.length + 1);
    expect(publicRun.every((check) => check.passed)).toBe(true);
    const finalRun = await runner.run(files, true, content);
    expect(finalRun).toHaveLength(
      content.publicChecks.length + content.hiddenChecks.length,
    );
    expect(finalRun.every((check) => check.passed)).toBe(true);
  });

  it('grades the supplied immutable hidden cohort and hides diagnostics regardless of its display label', async () => {
    const selected = structuredClone(content);
    selected.initialFiles['src/fixed.ts'] = 'export const pinned = 17;';
    selected.hiddenChecks = [
      {
        name: 'Private regression',
        input: {
          posts: [
            {
              id: 123456789,
              title: 'secret-fixture',
              slug: 'secret',
              tags: [],
            },
          ],
        },
        expected: [-999],
      },
    ];
    const checks = await runner.run(
      {
        ...files,
        'src/search.ts': `import { pinned } from './fixed';\nif (pinned !== 17) throw new Error('missing fixed template');\n${files['src/search.ts']}`,
      },
      true,
      selected,
    );
    expect(
      checks
        .slice(0, selected.publicChecks.length)
        .every((check) => check.passed),
    ).toBe(true);
    expect(checks.at(-1)).toEqual({
      name: 'Private regression',
      passed: false,
    });
    expect(JSON.stringify(checks)).not.toMatch(/123456789|secret-fixture|-999/);
  });

  it('returns a bounded compile failure without marking a malformed project accepted', async () => {
    const checks = await runner.run(
      { ...files, 'src/search.ts': 'export function {' },
      true,
      content,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ name: '프로젝트 빌드', passed: false });
    expect(checks[0].detail!.length).toBeLessThanOrEqual(2000);
  });

  it('does not convert runtime exceptions or forged output into passing functional checks', async () => {
    const checks = await runner.run(
      {
        ...files,
        'src/search.ts':
          "export function searchPosts(){ console.log('ALL TESTS PASSED'); throw new Error('controlled runtime failure'); }",
      },
      true,
      content,
    );
    expect(checks).toHaveLength(
      content.publicChecks.length + content.hiddenChecks.length,
    );
    expect(checks.every((check) => !check.passed)).toBe(true);
    expect(
      checks
        .slice(content.publicChecks.length)
        .every((check) => check.detail === undefined),
    ).toBe(true);
  });

  it('saves and grades one version through the real API, database and sandbox while AI is unavailable', async () => {
    const app = await createApp();
    await app.listen(0, '127.0.0.1');
    const config = app.get(ConfigService);
    config.set('VIBE_SANDBOX_URL', process.env.GO_JUDGE_URL);
    config.set('VIBE_SANDBOX_TOKEN', process.env.GO_JUDGE_TOKEN);
    // Only the paid provider boundary is replaced. The HTTP/API/DB/runner path is real.
    const evaluation = vi
      .spyOn(app.get(VibeAi), 'evaluate')
      .mockRejectedValue(new Error('Fixture provider unavailable'));
    try {
      const account = await register(
        app,
        'native_vibe',
        randomUUID().slice(0, 8),
      );
      const http = () => request(app.getHttpServer());
      const started = (
        await http()
          .post(`${base}/vibe/challenges/${content.challenge.id}/attempts`)
          .set(bearer(account.accessToken))
          .expect(201)
      ).body;
      expect(started.challengeVersion).toBe(vibeVersion(content));
      const path = `${base}/vibe/attempts/${started.id}`;
      const saved = (
        await http()
          .patch(`${path}/files`)
          .set(bearer(account.accessToken))
          .send({ revision: 0, files })
          .expect(200)
      ).body;
      const run = (
        await http()
          .post(`${path}/runs`)
          .set(bearer(account.accessToken))
          .send({ revision: saved.revision })
          .expect(201)
      ).body;
      expect(run.runs).toHaveLength(1);
      expect(run.runs[0].revision).toBe(saved.revision);
      expect(
        run.runs[0].checks.every((check: { passed: boolean }) => check.passed),
      ).toBe(true);
      const submitted = (
        await http()
          .post(`${path}/submit`)
          .set(bearer(account.accessToken))
          .send({ revision: saved.revision, reflection: '검증된 저장본' })
          .expect(201)
      ).body;
      expect(submitted.challengeVersion).toBe(started.challengeVersion);
      expect(submitted.report).toMatchObject({
        total: 11,
        passed: 11,
        outcome: 40,
        evaluationStatus: 'unavailable',
      });
      expect(submitted.files['src/search.ts']).toBe(files['src/search.ts']);
      expect(submitted.submittedAt).not.toBeNull();
      expect(evaluation).toHaveBeenCalledOnce();
      expect(evaluation.mock.calls[0][0].challenge_version).toBe(
        started.challengeVersion,
      );
      expect(JSON.stringify(submitted)).not.toMatch(
        /hiddenChecks|assistSystem|reviewSystem|VIBE_SANDBOX_TOKEN/,
      );
      const reloaded = (
        await http().get(path).set(bearer(account.accessToken)).expect(200)
      ).body;
      expect(reloaded.report).toEqual(submitted.report);
      expect(reloaded.challengeVersion).toBe(started.challengeVersion);
    } finally {
      evaluation.mockRestore();
      await app.close();
    }
  });
});
