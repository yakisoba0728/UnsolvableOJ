import type { MigrationInterface, QueryRunner } from 'typeorm';

export class VibeCoding1795400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE vibe_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      challenge_id text NOT NULL,
      revision integer NOT NULL DEFAULT 0,
      state jsonb NOT NULL,
      model text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      deadline_at timestamptz NOT NULL DEFAULT now() + interval '45 minutes',
      submitted_at timestamptz,
      operation_id uuid,
      busy_until timestamptz
    )`);
    await q.query(
      'CREATE INDEX idx_vibe_attempts_user_started ON vibe_attempts(user_id, started_at DESC)',
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE vibe_attempts');
  }
}
