import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProblemTagsEditorial1794200000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE problems
        ADD COLUMN tags text[] NOT NULL DEFAULT '{}',
        ADD COLUMN editorial_md text NOT NULL DEFAULT '';
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    // problem_versions snapshots still hold tags/editorial written before the rollback.
    await q.query(
      'ALTER TABLE problems DROP COLUMN tags, DROP COLUMN editorial_md;',
    );
  }
}
