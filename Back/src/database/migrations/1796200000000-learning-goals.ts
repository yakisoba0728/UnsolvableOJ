import type { MigrationInterface, QueryRunner } from 'typeorm';

/** One private calendar-window goal per account; progress uses submission evidence. */
export class LearningGoals1796200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE learning_goals (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        target_problems integer NOT NULL CHECK (target_problems BETWEEN 1 AND 1000),
        days integer NOT NULL CHECK (days IN (7, 30, 90)),
        start_date date NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT statement_timestamp()
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    if (!queryRunner.isTransactionActive)
      throw new Error('Learning goals rollback requires a transaction.');
    const [{ transaction_isolation: isolation }] = await queryRunner.query('SHOW transaction_isolation');
    if (isolation !== 'read committed')
      throw new Error('Learning goals rollback requires READ COMMITTED isolation.');
    // Stronger isolation can retain a snapshot established by the migration
    // ledger read. A table lock alone would not expose a later committed goal.
    // A rollback must not silently erase saved goals. Hold the same lock through
    // the emptiness check and DROP so an in-flight writer cannot be lost.
    await queryRunner.query(`
      LOCK TABLE learning_goals IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM learning_goals) THEN
          RAISE EXCEPTION 'Cannot roll back learning goals with saved goals; preserve goal history before reverting.';
        END IF;
      END $$;
      DROP TABLE learning_goals;
    `);
  }
}
