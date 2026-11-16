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
    await queryRunner.query('DROP TABLE learning_goals');
  }
}
