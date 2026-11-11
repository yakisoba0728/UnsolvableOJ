import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityEmail1795600001000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`
      ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
      CREATE TABLE email_preferences (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        answer boolean NOT NULL DEFAULT false, accepted boolean NOT NULL DEFAULT false, answer_version bigint NOT NULL DEFAULT 1, accepted_version bigint NOT NULL DEFAULT 1
      );
      CREATE TABLE email_tokens (
        token_hash varchar(64) PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose varchar(12) NOT NULL CHECK (purpose IN ('VERIFY','UNSUBSCRIBE')),
        email text NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp()
      );
      CREATE INDEX idx_email_tokens_user ON email_tokens(user_id,purpose,created_at);
      CREATE TABLE email_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind varchar(12) NOT NULL CHECK (kind IN ('VERIFY','ANSWER','ACCEPTED')),
        notification_id uuid UNIQUE REFERENCES notifications(id) ON DELETE CASCADE,
        encrypted_payload text, consent_version bigint,
        state varchar(12) NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sent','cancelled','dead')),
        attempts integer NOT NULL DEFAULT 0,
        lease_id uuid, lease_until timestamptz,
        next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        first_attempt_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz,
        last_error varchar(40)
      );
      CREATE INDEX idx_email_outbox_pending ON email_outbox(next_attempt_at) WHERE state='pending';
      CREATE INDEX idx_email_outbox_user ON email_outbox(user_id,created_at);
      CREATE TABLE email_request_limits (recipient_key varchar(64) PRIMARY KEY,
        request_times timestamptz[] NOT NULL DEFAULT '{}', last_requested_at timestamptz,
        CHECK (cardinality(request_times) <= 5));
      CREATE TABLE email_delivery_clock (id boolean PRIMARY KEY DEFAULT true CHECK(id), last_attempt_at timestamptz);
      INSERT INTO email_delivery_clock(id) VALUES(true);
      CREATE FUNCTION enqueue_community_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        -- No user row lock here: the community transaction holds its post lock first.
        IF NEW.type IN ('ANSWER','ACCEPTED') AND pg_try_advisory_xact_lock(hashtextextended('email-enqueue:'||NEW.user_id::text,0)) THEN
          INSERT INTO email_outbox(user_id,kind,notification_id,consent_version)
          SELECT NEW.user_id,NEW.type,NEW.id,CASE NEW.type WHEN 'ANSWER' THEN e.answer_version ELSE e.accepted_version END FROM users u JOIN email_preferences e ON e.user_id=u.id
          WHERE u.id=NEW.user_id AND u.deleted_at IS NULL AND u.suspended_at IS NULL
            AND u.email_verified_at IS NOT NULL AND NEW.actor_id IS DISTINCT FROM u.id
            AND CASE NEW.type WHEN 'ANSWER' THEN e.answer ELSE e.accepted END
            AND (SELECT count(*) FROM email_outbox WHERE user_id=NEW.user_id AND state='pending') < 100
          ON CONFLICT DO NOTHING;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_community_email AFTER INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION enqueue_community_email();
      CREATE FUNCTION erase_withdrawn_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
          DELETE FROM email_outbox WHERE user_id=NEW.id;
          DELETE FROM email_tokens WHERE user_id=NEW.id;
          DELETE FROM email_preferences WHERE user_id=NEW.id;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_erase_withdrawn_email AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION erase_withdrawn_email();
    `);
  }
  async down(q: QueryRunner) {
    await q.query(`LOCK TABLE email_outbox,email_tokens,email_preferences,email_request_limits IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN IF EXISTS(SELECT 1 FROM email_outbox) OR EXISTS(SELECT 1 FROM email_tokens)
        OR EXISTS(SELECT 1 FROM email_preferences) OR EXISTS(SELECT 1 FROM email_request_limits WHERE last_requested_at>clock_timestamp()-interval '24 hours') OR EXISTS(SELECT 1 FROM users WHERE email_verified_at IS NOT NULL)
        THEN RAISE EXCEPTION 'Cannot discard email consent and delivery records'; END IF; END $$;
      DROP TRIGGER trg_erase_withdrawn_email ON users; DROP FUNCTION erase_withdrawn_email();
      DROP TRIGGER trg_community_email ON notifications; DROP FUNCTION enqueue_community_email();
      DROP TABLE email_request_limits,email_delivery_clock,email_outbox,email_tokens,email_preferences;
      ALTER TABLE users DROP COLUMN email_verified_at;`);
  }
}
