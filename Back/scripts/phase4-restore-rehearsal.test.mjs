import assert from 'node:assert/strict';
import test from 'node:test';
import { rehearsalConfig, ownedDatabaseName } from './phase4-restore-rehearsal.mjs';

const valid = { CI: 'true', NODE_ENV: 'test', PHASE4_REHEARSAL: 'disposable-ci',
  PHASE4_POSTGRES_CONTAINER: 'a'.repeat(64), DATABASE_URL: 'postgresql://ci:disposable@127.0.0.1:5432/ci' };

test('restore rehearsal fails closed outside an explicitly owned loopback CI database', () => {
  assert.equal(rehearsalConfig(valid).username, 'ci');
  for (const overrides of [
    { CI: undefined }, { NODE_ENV: 'production' }, { PHASE4_REHEARSAL: undefined },
    { PHASE4_POSTGRES_CONTAINER: '--privileged' }, { PHASE4_POSTGRES_CONTAINER: 'postgres' },
    { DATABASE_URL: 'postgresql://ci:secret@production.internal/main' },
    { DATABASE_URL: 'postgresql://ci:secret@127.0.0.1/ci?host=production.internal' },
    { DATABASE_URL: 'http://127.0.0.1' },
  ]) assert.throws(() => rehearsalConfig({ ...valid, ...overrides }));
});

test('cleanup accepts only exact generated source and restore database identifiers', () => {
  for (const kind of ['source', 'restore']) {
    const name = `oj4_${kind}_${'f'.repeat(32)}`;
    assert.equal(ownedDatabaseName(name), `"${name}"`);
  }
  for (const name of ['main', 'postgres', 'unsolvable_ci', 'oj4_source_', 'oj4_source_' + 'f'.repeat(31), 'oj4_restore_x; DROP DATABASE main']) {
    assert.throws(() => ownedDatabaseName(name));
  }
});
