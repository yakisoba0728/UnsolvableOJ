// Reads Compose JSON on stdin without logging secrets or contacting services.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkSandboxBudget(plan) {
  const sandbox = plan.services['go-judge'];
  const concurrency = Number(plan.services.judge.environment.JUDGE_CONCURRENCY);
  assert.ok(Number.isSafeInteger(concurrency) && concurrency > 0, 'Invalid JUDGE_CONCURRENCY');
  assert.ok(sandbox.command.includes(`-parallelism=${concurrency}`), 'Worker/sandbox concurrency mismatch');
  // Match CreateProblemDto's supported maximum, not just the 1 GiB compile limit.
  // shortcut: 2 GiB is baseline headroom, increase it after measuring cache/runtime overhead at sustained load.
  const minimum = (4096 * concurrency + 2048) * 1024 * 1024;
  assert.ok(sandbox.mem_limit >= minimum, 'SANDBOX_MEMORY_LIMIT needs 4 GiB * concurrency + 2 GiB headroom');
  assert.equal(sandbox.memswap_limit, sandbox.mem_limit, 'Sandbox swap must be disabled');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkSandboxBudget(JSON.parse(readFileSync(0, 'utf8')));
  console.log('Sandbox memory/concurrency budget passed (host capacity still needs checking).');
}
