import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserSuspension1794100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE users ADD COLUMN suspended_at timestamptz');
  }

  async down(q: QueryRunner): Promise<void> {
    if (!q.isTransactionActive)
      throw new Error('User suspension rollback requires a transaction.');
    await q.query(`
      LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM users WHERE suspended_at IS NOT NULL) THEN
          RAISE EXCEPTION 'Cannot roll back user suspension with suspended users; they would regain access.';
        END IF;
      END $$;
      ALTER TABLE users DROP COLUMN suspended_at;
    `);
  }
}
