import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const required = workflow.slice(workflow.indexOf('\n  required:'));

function runBlock(section) {
  const block = section.match(/        run: \|\n((?:          .*\n|\n)+)/);
  assert.ok(block, 'Expected a workflow shell block');
  return block[1].split('\n').map((line) => line.slice(10)).join('\n');
}

test('required gate depends on every validation job, including audit and images', () => {
  const jobs = [...workflow.matchAll(/^  ([a-z]+):\n/gm)]
    .map((match) => match[1]).filter((name) => !['push', 'pull_request', 'schedule', 'workflow_dispatch', 'run', 'required'].includes(name));
  const dependencies = required.match(/    needs: \[([^\]]+)\]/)[1].split(',').map((name) => name.trim());
  assert.deepEqual(dependencies.toSorted(), jobs.toSorted());
});

test('required gate fails for every failure/cancellation and accepts only success or skipped', () => {
  const script = runBlock(required);
  for (const result of ['failure', 'cancelled', 'timed_out', 'action_required', 'unknown']) {
    const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, RESULTS: `success skipped ${result} success` }, encoding: 'utf8',
    });
    assert.equal(run.status, 1, `${result} must block the gate`);
  }
  const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
    env: { ...process.env, RESULTS: 'success skipped success' }, encoding: 'utf8',
  });
  assert.equal(run.status, 0);
});

test('integration PRs trigger CI, and the final main PR requests full validation', () => {
  assert.match(workflow, /pull_request:\n    branches: \[main, 'overhaul\/integration'\]/);
  assert.match(workflow, /FULL:.*github\.head_ref == 'overhaul\/integration'.*github\.base_ref == 'main'/);
  assert.match(workflow, /FULL:.*inputs\.full.*github\.event_name == 'schedule'/);
});

test('large image diffs cannot be skipped by a pipefail/SIGPIPE race', () => {
  const directory = mkdtempSync(join(tmpdir(), 'oj-ci-policy-'));
  try {
    const script = runBlock(workflow.slice(workflow.indexOf('      - name: Detect changes')));
    const git = join(directory, 'git');
    writeFileSync(git, '#!/bin/sh\nif [ "$1" = fetch ]; then exit 0; fi\nif [ "$1" = diff ]; then exec cat "$CI_TEST_FILES"; fi\nexit 1\n', { mode: 0o700 });
    const files = join(directory, 'files');
    const output = join(directory, 'output');
    for (const [context, expected] of [['Back', 'true'], ['Front', 'false']]) {
      writeFileSync(files, 'Back/src/changed.ts\n' + Array.from({ length: 30_000 }, (_, index) => `docs/generated/path-${index}.md`).join('\n'));
      writeFileSync(output, '');
      const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, BASE: 'test-base', CONTEXT: context, GITHUB_OUTPUT: output, CI_TEST_FILES: files },
        encoding: 'utf8',
      });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(readFileSync(output, 'utf8').trim(), `build=${expected}`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


test('full validation selects all component suites even for a documentation-only PR', () => {
  const script = runBlock(workflow.slice(workflow.indexOf('      - id: diff')));
  const directory = mkdtempSync(join(tmpdir(), 'oj-ci-full-'));
  try {
    const output = join(directory, 'output');
    const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      env: { ...process.env, EVENT: 'pull_request', BASE: 'unused', FULL: 'true', GITHUB_OUTPUT: output }, encoding: 'utf8',
    });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(readFileSync(output, 'utf8').trim().split('\n'), ['full=true', 'back=true', 'front=true', 'judge=true']);
    assert.equal(run.stderr, '', 'Full validation must not depend on fetching a path-filter base');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('full browser validation adds the WebKit core flows on Firefox without weakening existing checks', () => {
  const front = workflow.slice(workflow.indexOf('\n  front:'), workflow.indexOf('\n  full:'));
  const firefox = front.match(/      - name: Firefox core-flow regression tests\n([\s\S]*?)(?=      - name:|$)/)?.[1];
  assert.ok(firefox, 'Full validation must include the Firefox core-flow step');
  assert.match(firefox, /if: \$\{\{ needs\.changes\.outputs\.full == 'true' \}\}/);
  assert.match(firefox, /working-directory: Front/);
  assert.match(front, /timeout-minutes: 20/);
  assert.match(front, /shard: \[1, 2\]/);
  const command = runBlock(firefox);
  assert.match(command, /--project=firefox --workers=4 --shard=\$\{\{ matrix\.shard \}\}\/2/);
  const config = readFileSync(new URL('../Front/playwright.config.ts', import.meta.url), 'utf8');
  const webkit = config.match(/const webkitSpecs = \[([\s\S]*?)\];/);
  assert.ok(webkit);
  const specs = (value) => [...value.matchAll(/[a-z-]+\.spec\.ts/g)].map((match) => match[0]).toSorted();
  assert.deepEqual(specs(command), specs(webkit[1]), 'Firefox must exercise the same bounded core-flow files as WebKit');
  assert.match(command, /--output=test-results\/firefox/);
  assert.match(firefox, /PLAYWRIGHT_HTML_OUTPUT_DIR: playwright-report\/firefox/);
  assert.match(firefox, /PLAYWRIGHT_JUNIT_OUTPUT_FILE: test-results\/firefox\.xml/);
  assert.doesNotMatch(firefox, /continue-on-error|--retries|--pass-with-no-tests/);
  assert.match(front, /PROJECTS: --project=unit --project=chromium --project=chromium-slow .*--project=webkit/);
  assert.ok(front.indexOf('name: Firefox core-flow regression tests') > front.indexOf('name: Browser regression tests'));
  assert.ok(front.indexOf('name: Failed browser test artifacts') > front.indexOf('name: Firefox core-flow regression tests'));
  const version = JSON.parse(readFileSync(new URL('../Front/package.json', import.meta.url), 'utf8')).devDependencies['@playwright/test'];
  assert.ok(front.includes(`image: mcr.microsoft.com/playwright:v${version}-noble`), 'Container browsers must match the installed Playwright version');
});

function selectJobs(paths, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'oj-ci-selection-'));
  try {
    writeFileSync(join(directory, 'git'), '#!/bin/sh\nif [ "$1" = fetch ]; then exit "$CI_TEST_FETCH_STATUS"; fi\nif [ "$1" = diff ]; then [ "$CI_TEST_DIFF_STATUS" = 0 ] || exit "$CI_TEST_DIFF_STATUS"; exec cat "$CI_TEST_FILES"; fi\nexit 1\n', { mode: 0o700 });
    const files = join(directory, 'files');
    const output = join(directory, 'output');
    writeFileSync(files, paths.join('\n') + '\n');
    writeFileSync(output, '');
    const run = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', runBlock(workflow.slice(workflow.indexOf('      - id: diff')))], {
      env: {
        ...process.env, PATH: `${directory}:${process.env.PATH}`, EVENT: 'pull_request', BASE: 'test-base',
        FULL: 'false', GITHUB_OUTPUT: output, CI_TEST_FILES: files,
        CI_TEST_FETCH_STATUS: '0', CI_TEST_DIFF_STATUS: '0', ...overrides,
      }, encoding: 'utf8',
    });
    return {
      ...run,
      selected: Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => line.split('='))),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('native execution and contract changes require full validation before integration', () => {
  for (const path of [
    'Judge/src/worker.ts', 'Judge/src/output.ts', 'Judge/runtime/Dockerfile',
    'Judge/runtime/mount.yaml', 'Judge/runtime/health.py', 'Judge/runtime/start.sh',
    'Judge/deploy/compose.yaml', 'Judge/package-lock.json', 'Judge/Dockerfile', 'Judge/.dockerignore',
    'Back/src/modules/submissions/judge.service.ts', 'Back/src/modules/submissions/dto/judge-result.dto.ts',
    'Back/src/modules/vibe/vibe.runner.ts', 'Back/src/modules/vibe/vibe.service.ts',
    'Back/src/modules/vibe/vibe.catalog.ts', 'Back/src/modules/vibe/vibe.types.ts',
    'Back/src/common/queue.constants.ts', 'Back/src/config/redis.config.ts', 'Back/src/config/env.validation.ts',
    'Back/package.json', 'Back/package-lock.json',
  ]) {
    const run = selectJobs([path]);
    assert.equal(run.status, 0, `${path}: ${run.stderr}`);
    assert.deepEqual(run.selected, { full: 'true', back: 'true', front: 'true', judge: 'true' }, path);
  }
});

test('Compose and live-test harness changes cannot skip their own execution', () => {
  for (const path of [
    'compose.yaml', 'deploy/compose.yaml', 'deploy/.env.example',
    'Back/Dockerfile', 'Back/.dockerignore', 'Back/docker-entrypoint.sh',
    'Front/Dockerfile', 'Front/.dockerignore', 'Front/nginx.conf', 'Front/trusted-proxy.conf.template',
    'scripts/check-compose.mjs', 'scripts/check-production-compose.mjs', 'scripts/check-sandbox-budget.mjs',
    'Back/scripts/run-integration.mjs', 'Back/test/judge.pipeline-spec.ts',
    'Back/test/judge-recovery.pipeline-spec.ts', 'Back/vitest.config.pipeline.ts',
    'Front/playwright.live.config.ts', 'Front/tests-live/judge-flow.spec.ts',
  ]) {
    const run = selectJobs([path]);
    assert.equal(run.status, 0, `${path}: ${run.stderr}`);
    assert.equal(run.selected.full, 'true', path);
  }
});

test('ordinary frontend, API, and documentation changes retain bounded checks', () => {
  for (const [path, expected] of [
    ['Front/src/components/NotificationBell.tsx', { full: 'false', back: 'false', front: 'true', judge: 'false' }],
    ['Back/src/modules/community/community.service.ts', { full: 'false', back: 'true', front: 'false', judge: 'false' }],
    ['Back/src/database/migrations/1796000000000-indexes.ts', { full: 'false', back: 'true', front: 'false', judge: 'false' }],
    ['docs/overhaul/PROGRESS.md', { full: 'false', back: 'false', front: 'false', judge: 'false' }],
    ['.github/workflows/ci.yml', { full: 'false', back: 'true', front: 'true', judge: 'true' }],
  ]) {
    const run = selectJobs([path]);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.selected, expected, path);
  }
  for (const path of ['Judge/README.md', 'Judge/runtime/README.md', 'Judge/deploy/README.md', 'Judge/benchmarks/output-comparison.json', 'deploy/README.md', 'Front/src/Dockerfile.example']) {
    assert.equal(selectJobs([path]).selected.full, 'false', path);
  }
});

test('unknown PR changes fail closed while ordinary pushes do not add native runs', () => {
  for (const overrides of [{ BASE: '' }, { CI_TEST_FETCH_STATUS: '1' }]) {
    const run = selectJobs([], overrides);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(run.selected, { full: 'true', back: 'true', front: 'true', judge: 'true' });
  }
  const push = selectJobs([], { EVENT: 'push' });
  assert.equal(push.status, 0, push.stderr);
  assert.deepEqual(push.selected, { full: 'false', back: 'true', front: 'true', judge: 'true' });
  assert.notEqual(selectJobs([], { CI_TEST_DIFF_STATUS: '2' }).status, 0, 'A failed diff must fail change detection');
});
