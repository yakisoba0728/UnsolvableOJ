import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DebugOutputs1790552000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE submissions ADD COLUMN debug_outputs jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE submissions DROP COLUMN debug_outputs',
    );
  }
}
