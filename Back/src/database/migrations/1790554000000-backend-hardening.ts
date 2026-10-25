import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackendHardening1790554000000 implements MigrationInterface {
  name = 'BackendHardening1790554000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // 대소문자만 다른 기존 이름은 자동으로 바꾸지 않고 운영자가 정리하도록 목록과 함께 중단합니다.
    await queryRunner.query(`
      DO $$ DECLARE duplicates text; BEGIN
        SELECT string_agg(names, '; ') INTO duplicates FROM (
          SELECT string_agg(username, ', ' ORDER BY username COLLATE "C") AS names
          FROM users GROUP BY lower(username) HAVING count(*) > 1
        ) groups;
        IF duplicates IS NOT NULL THEN
          RAISE EXCEPTION 'Usernames differ only by case; rename them before migrating: %', duplicates;
        END IF;
      END $$;
      CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username));
      CREATE INDEX idx_users_xp_created ON users (xp DESC, created_at);
      ALTER TABLE submissions ADD COLUMN recovery_count integer NOT NULL DEFAULT 0;
      CREATE INDEX idx_submissions_problem_status_user
        ON submissions (problem_id, status, user_id);
      CREATE INDEX idx_submissions_queued_updated ON submissions (updated_at, id)
        WHERE status = 'QUEUED';
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX idx_submissions_queued_updated;
      DROP INDEX idx_submissions_problem_status_user;
      ALTER TABLE submissions DROP COLUMN recovery_count;
      DROP INDEX idx_users_xp_created;
      DROP INDEX uq_users_username_lower;
    `);
  }
}
