import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const repository = resolve(process.argv[2]);
const { checkExecutorCompose } = await import(pathToFileURL(`${repository}/scripts/check-executor-compose.mjs`));
const source = readFileSync(`${repository}/scripts/check-executor-compose.test.mjs`, 'utf8');
const start = source.indexOf('function fixture()');
const end = source.indexOf('\ntest(', start);
assert.ok(start >= 0 && end > start);
// Reuse only the repository's synthetic, side-effect-free test fixture function.
const fixture = new Function(source.slice(start, end) + '\nreturn fixture;')();
const settings = { redis_tls_ca: 'REDIS_TLS_CA_FILE', redis_tls_cert: 'REDIS_TLS_CERT_FILE', redis_tls_key: 'REDIS_TLS_KEY_FILE' };
const results = [];
for (const key of ['constructor', 'toString', '__proto__']) {
  const plan = fixture();
  plan.services.judge.secrets = [{ source: key, target: `/run/secrets/${key}` }];
  plan.services.judge.environment[settings[key]] = `/run/secrets/${key}`;
  let rejected = false;
  try { checkExecutorCompose(plan); } catch { rejected = true; }
  results.push({ unapprovedSource: key, rejected });
}
console.log(JSON.stringify(results, null, 2));
assert.ok(results.every(result => result.rejected), 'Only the three own whitelist keys may be mounted as secrets');
