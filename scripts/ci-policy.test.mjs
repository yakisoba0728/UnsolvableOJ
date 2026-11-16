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
