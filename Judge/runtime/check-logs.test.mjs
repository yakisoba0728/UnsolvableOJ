import assert from 'node:assert/strict';
import test from 'node:test';
import { checkSandboxStartupLogs } from './check-logs.mjs';

const token = 'non-secret-startup-regression-token';
const clean = 'go-judge | Config loaded {"config":"&{AuthToken:[redacted]}"}\n'
  + 'go-judge | Attach token auth\n';

test('authenticated startup logs contain redaction and no configured token', () => {
  assert.doesNotThrow(() => checkSandboxStartupLogs(clean, token));
});

for (const [name, logs] of [
  ['configuration dump', clean.replace('[redacted]', token)],
  ['auth attachment', `${clean}Attach token auth {"token":"${token}"}\n`],
]) {
  test(`pre-fix ${name} disclosure fails without repeating the token`, () => {
    assert.throws(() => checkSandboxStartupLogs(logs, token), (error) => {
      assert.match(error.message, /exposed/);
      assert.equal(error.message.includes(token), false);
      return true;
    });
  });
}

for (const [name, logs] of [
  ['empty logs', ''],
  ['silent startup', 'Listening on localhost\n'],
  ['missing auth attachment', clean.replace('Attach token auth', 'No authentication')],
  ['missing configuration dump', clean.replace('Config loaded', 'Other event')],
]) {
  test(`${name} cannot be mistaken for a redaction pass`, () => {
    assert.throws(() => checkSandboxStartupLogs(logs, token));
  });
}

test('an absent or empty expected token cannot make the check vacuous', () => {
  for (const value of [undefined, '', 'short']) {
    assert.throws(() => checkSandboxStartupLogs(clean, value));
  }
});

test('JSON escaping cannot hide a configured token from the assertion', () => {
  const escapedToken = `${token}\\\"`;
  const logs = `${clean}${JSON.stringify({ token: escapedToken })}\n`;
  assert.equal(logs.includes(escapedToken), false);
  assert.throws(() => checkSandboxStartupLogs(logs, escapedToken), /exposed/);
});
