import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountWithdrawal1795600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users ADD COLUMN deleted_at timestamptz;
      CREATE INDEX idx_users_active ON users(xp DESC, created_at) WHERE deleted_at IS NULL;
      CREATE FUNCTION protect_withdrawn_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF OLD.deleted_at IS NOT NULL AND
          (NEW.email,NEW.username,NEW.password_hash,NEW.role,NEW.suspended_at,NEW.must_change_password,NEW.deleted_at)
          IS DISTINCT FROM
          (OLD.email,OLD.username,OLD.password_hash,OLD.role,OLD.suspended_at,OLD.must_change_password,OLD.deleted_at)
        THEN RAISE EXCEPTION 'Withdrawn account identity cannot be restored' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER protect_withdrawn_account BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION protect_withdrawn_account();`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`LOCK TABLE users IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM users WHERE deleted_at IS NOT NULL)
        THEN RAISE EXCEPTION 'Cannot roll back irreversible account withdrawals'; END IF; END $$;
      DROP TRIGGER protect_withdrawn_account ON users;
      DROP FUNCTION protect_withdrawn_account();
      DROP INDEX idx_users_active;
      ALTER TABLE users DROP COLUMN deleted_at;`);
  }
}
