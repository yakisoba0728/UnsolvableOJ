import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { starterProblems } from './starter-problems.mjs';

test('all starter problem oracles agree with independent reference solutions', () => {
  assert.equal(starterProblems.length, 10);
  assert.equal(new Set(starterProblems.map((p) => p.dto.slug)).size, 10);
  for (const { dto, solve } of starterProblems) {
    assert.ok(dto.testCases.some((t) => t.isSample));
    assert.ok(dto.testCases.filter((t) => !t.isSample).length >= 8);
    assert.ok(dto.testCases.length <= 100);
    for (const [i, tc] of dto.testCases.entries()) {
      const actual = runInNewContext(`(${solve.toString()})(input)`, { input: tc.input }, { timeout: 2000 });
      assert.equal(String(actual).trimEnd(), tc.expectedOutput.trimEnd(), `${dto.slug} case ${i + 1}`);
      assert.ok(tc.input.length <= 1000000 && tc.expectedOutput.length <= 1000000);
    }
  }
});
