import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedDatabaseName, qualificationConfig } from './phase5-db-qualification.mjs';

const valid = { NODE_ENV: 'test', PHASE5_DB_QUALIFICATION: 'disposable',
  DATABASE_URL: 'postgresql://disposable:fixture@127.0.0.1:5432/postgres' };

test('qualification refuses production, missing opt-in, remote/DNS hosts and URL connection overrides before any database action', () => {
  for (const env of [
    { ...valid, NODE_ENV: 'production' }, { ...valid, PHASE5_DB_QUALIFICATION: '' },
    ...['https://127.0.0.1/db', 'postgresql://user@prod.example/db', 'postgresql://user@localhost/db',
      'postgresql://user@127.0.0.1/db?host=prod.example', 'postgresql://user@127.0.0.1/db#override',
      'postgresql://127.0.0.1/db', 'not-a-url'].map(DATABASE_URL => ({ ...valid, DATABASE_URL })),
  ]) assert.throws(() => qualificationConfig(env));
  assert.equal(qualificationConfig(valid).limits.candidates, 5000);
  assert.equal(qualificationConfig({ ...valid, DATABASE_URL: 'postgresql://user@[::1]/postgres' }).url.hostname, '[::1]');
});

test('cleanup SQL can identify only generated qualification databases, never configured or caller-injected identifiers', () => {
  for (const name of ['postgres', 'unsolvable_ci', 'oj5_db_', 'oj5_db_' + 'a'.repeat(31),
    'oj5_db_' + 'a'.repeat(33), 'oj5_db_' + 'A'.repeat(32), 'oj5_db_";DROP DATABASE production;--'])
    assert.throws(() => ownedDatabaseName(name));
  assert.equal(ownedDatabaseName('oj5_db_' + 'a'.repeat(32)), '"oj5_db_' + 'a'.repeat(32) + '"');
});
