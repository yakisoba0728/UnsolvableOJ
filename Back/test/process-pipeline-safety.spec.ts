import { DataSource } from 'typeorm';
import { disposableDatabaseObserver, disposableDatabaseUrl } from './process.pipeline-helpers.js';

const name = `unsolvable_integration_${'a'.repeat(32)}`;
const url = `postgresql://fixture:fixture@127.0.0.1/${name}`;
const environment = { NODE_ENV: 'test', DATABASE_URL: url, UNSOLVABLE_TEST_DATABASE: name };

describe('process-fault database boundary (no connections)', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: undefined },
    { DATABASE_URL: undefined },
    { DATABASE_URL: `https://fixture:fixture@127.0.0.1/${name}` },
    { DATABASE_URL: `postgresql://fixture:fixture@remote.invalid/${name}` },
    { DATABASE_URL: `${url}?host=remote.invalid` },
    { DATABASE_URL: `${url}?host=127.0.0.1&host=remote.invalid` },
    { DATABASE_URL: `${url}?host=%2Fvar%2Frun%2Fpostgresql` },
    { DATABASE_URL: `${url}?dbname=production` },
    { DATABASE_URL: `${url}?database=production` },
    { DATABASE_URL: `${url}?options=-csearch_path%3Dproduction` },
    { DATABASE_URL: `${url}#host=remote.invalid` },
    { DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1/production' },
    { UNSOLVABLE_TEST_DATABASE: 'production' },
    { UNSOLVABLE_TEST_DATABASE: undefined },
  ])('rejects unsafe environment before initializing a client: %j', async (overrides) => {
    const connect = vi.spyOn(DataSource.prototype, 'initialize').mockRejectedValue(new Error('A connection must never be attempted'));
    await expect(disposableDatabaseObserver({ ...environment, ...overrides })).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['postgresql://127.0.0.1', 'postgres://localhost:5432', 'postgresql://[::1]:5432'])('accepts a named disposable loopback database without connecting: %s', (authority) => {
    const connect = vi.spyOn(DataSource.prototype, 'initialize');
    const candidate = `${authority}/${name}`;
    expect(disposableDatabaseUrl({ ...environment, DATABASE_URL: candidate })).toBe(candidate);
    expect(connect).not.toHaveBeenCalled();
  });
});
