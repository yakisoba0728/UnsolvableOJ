import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { LearningGoals1796200000000 } from '../src/database/migrations/1796200000000-learning-goals.js';
import { closeApp, createApp } from './helpers.js';

describe('Learning-goal migration preservation (real PostgreSQL)', () => {
  let app: NestExpressApplication;
  let db: DataSource;
  const owner = randomUUID();
  const migration = new LearningGoals1796200000000();
  const insertGoal = (manager: Pick<DataSource, 'query'>) => manager.query(
    "INSERT INTO learning_goals(user_id,target_problems,days,start_date) VALUES($1,321,30,'2026-11-16')",
    [owner],
  );

  beforeAll(async () => {
    app = await createApp();
    db = app.get(DataSource);
    await db.query("INSERT INTO users(id,email,username,password_hash) VALUES($1,$2,$3,'synthetic-no-login')",
      [owner, `${owner}@example.invalid`, `restore_${owner.slice(0, 8)}`]);
  });
  beforeEach(() => db.query('DELETE FROM learning_goals WHERE user_id=$1', [owner]));
  afterAll(async () => {
    await db?.query('DELETE FROM users WHERE id=$1', [owner]);
    await closeApp(app, []);
  });

  it('requires a transaction before attempting destructive schema work', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await expect(migration.down(runner)).rejects.toThrow('Learning goals rollback requires a transaction');
      expect((await runner.query("SELECT to_regclass('learning_goals') AS name"))[0].name).toBe('learning_goals');
    } finally { await runner.release(); }
  });

  it('refuses populated goals and preserves their exact rows and migration ledger', async () => {
    await insertGoal(db);
    const before = await db.query('SELECT * FROM learning_goals ORDER BY user_id');
    const ledger = await db.query('SELECT * FROM migrations ORDER BY id');
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      let rejected: unknown;
      try { await migration.down(runner); } catch (error) { rejected = error; }
      if (!rejected) {
        // The baseline proof is safe: this transaction is always rolled back.
        const [{ name }] = await runner.query("SELECT to_regclass('learning_goals') AS name");
        console.log(JSON.stringify({ proof: 'populated-goal-rollback', rowsBefore: before.length, tableAfterDown: name }));
      }
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).message).toContain('Cannot roll back learning goals with saved goals');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    expect(await db.query('SELECT * FROM learning_goals ORDER BY user_id')).toEqual(before);
    expect(await db.query('SELECT * FROM migrations ORDER BY id')).toEqual(ledger);
  });

  it.each(['REPEATABLE READ', 'SERIALIZABLE'] as const)(
    'refuses an old %s snapshot before destructive schema work', async (isolation) => {
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction(isolation);
      const ledger = await db.query('SELECT * FROM migrations ORDER BY id');
      let before: unknown;
      try {
        await runner.query('SET LOCAL statement_timeout=5000; SET LOCAL lock_timeout=2000');
        // MigrationRunner reads its ledger before down(). Establish the same
        // old snapshot, then commit a goal through a different connection.
        await runner.query('SELECT count(*) FROM migrations');
        await insertGoal(db);
        before = await db.query('SELECT * FROM learning_goals ORDER BY user_id');
        expect((before as unknown[]).length).toBeGreaterThan(0);
        let rejected: unknown;
        try { await migration.down(runner); } catch (error) { rejected = error; }
        if (!rejected) {
          const [{ name }] = await runner.query("SELECT to_regclass('learning_goals') AS name");
          console.log(JSON.stringify({ proof: 'old-snapshot-goal-rollback', isolation,
            committedGoal: true, tableAfterDown: name }));
        }
        expect(rejected).toBeInstanceOf(Error);
        expect((rejected as Error).message).toContain('Learning goals rollback requires READ COMMITTED isolation');
        expect((await runner.query("SELECT to_regclass('learning_goals') AS name"))[0].name).toBe('learning_goals');
      } finally {
        // Also protects the committed goal when running the regression against
        // the known-bad baseline, whose DDL would otherwise remove the table.
        await runner.rollbackTransaction();
        await runner.release();
      }
      expect(await db.query('SELECT * FROM learning_goals ORDER BY user_id')).toEqual(before);
      expect(await db.query('SELECT * FROM migrations ORDER BY id')).toEqual(ledger);
    },
  );

  it('waits for an in-flight writer then refuses dropping its committed goal', async () => {
    const writer = db.createQueryRunner();
    const reverting = db.createQueryRunner();
    await writer.connect();
    await reverting.connect();
    await writer.startTransaction();
    await reverting.startTransaction();
    let result: Promise<unknown> | undefined;
    try {
      await writer.query('SET LOCAL statement_timeout=5000; SET LOCAL lock_timeout=2000');
      await reverting.query('SET LOCAL statement_timeout=5000; SET LOCAL lock_timeout=2000');
      await insertGoal(writer);
      const [{ pid }] = await reverting.query('SELECT pg_backend_pid() AS pid');
      result = migration.down(reverting).then(() => null, error => error);
      let blocked = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [{ waiting }] = await db.query('SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting', [pid]);
        if (waiting) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await writer.commitTransaction();
      const error = await result;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('Cannot roll back learning goals with saved goals');
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      await result;
      if (reverting.isTransactionActive) await reverting.rollbackTransaction();
      await reverting.release();
      await writer.release();
    }
    expect(await db.query('SELECT target_problems,days FROM learning_goals WHERE user_id=$1', [owner]))
      .toEqual([{ target_problems: 321, days: 30 }]);
  });
});
