import type { DataSource } from 'typeorm';
import { vi } from 'vitest';

// Keep real PostgreSQL parsing: old Date clocks truncate; text clocks retain microseconds.
export async function withMissionClock<T>(db: DataSource, at: string, run: () => Promise<T>) {
  const create = db.createQueryRunner.bind(db);
  const spy = vi.spyOn(db, 'createQueryRunner').mockImplementation((mode) => {
    const runner = create(mode);
    const query = runner.query.bind(runner) as typeof runner.query;
    vi.spyOn(runner, 'query').mockImplementation((sql: string, parameters?: unknown[], structured?: boolean) => {
      if (sql.includes('SELECT clock_timestamp()')) {
        sql = sql.replace('clock_timestamp()', '$1::timestamptz');
        parameters = [at];
      }
      return structured ? query(sql, parameters, true) : query(sql, parameters);
    });
    return runner;
  });
  try {
    return await run();
  } finally {
    spy.mockRestore();
  }
}
