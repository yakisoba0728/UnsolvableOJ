import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Private study bookmarks. The user-first key also serves filtered problem lists. */
export class ProblemBookmarks1795900000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE problem_bookmarks (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (user_id, problem_id)
      );
      CREATE INDEX idx_problem_bookmarks_problem ON problem_bookmarks(problem_id);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE problem_bookmarks');
  }
}
