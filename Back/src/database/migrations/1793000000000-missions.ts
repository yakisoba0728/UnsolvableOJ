import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Missions1793000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE mission_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mission_key varchar(20) NOT NULL CHECK (mission_key IN ('daily','analysis','night','weekly','community','streak','bonus')),
        period_key varchar(10) NOT NULL,
        progress integer NOT NULL DEFAULT 0 CHECK (progress >= 0),
        target integer NOT NULL CHECK (target > 0),
        reward_xp integer NOT NULL CHECK (reward_xp >= 0),
        badge varchar(40),
        problem_id uuid REFERENCES problems(id) ON DELETE SET NULL,
        completed_at timestamptz,
        claimed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (user_id, mission_key, period_key),
        CHECK (progress <= target),
        CHECK (claimed_at IS NULL OR completed_at IS NOT NULL)
      );
      CREATE TABLE user_badges (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        badge varchar(40) NOT NULL,
        awarded_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, badge)
      );
      CREATE TABLE analysis_attempts (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_id varchar(40) NOT NULL,
        day date NOT NULL,
        selected integer NOT NULL CHECK (selected BETWEEN 0 AND 3),
        correct boolean NOT NULL,
        solved boolean NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, question_id, day)
      );
      CREATE INDEX idx_mission_claimed ON mission_states(user_id, claimed_at) WHERE claimed_at IS NOT NULL;
      CREATE INDEX idx_analysis_user_updated ON analysis_attempts(user_id, updated_at DESC);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      LOCK TABLE mission_states, user_badges, analysis_attempts IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM mission_states) OR EXISTS (SELECT 1 FROM user_badges)
          OR EXISTS (SELECT 1 FROM analysis_attempts) THEN
          RAISE EXCEPTION 'Cannot roll back populated missions; preserve reward and learning records.';
        END IF;
      END $$;
      DROP TABLE analysis_attempts, user_badges, mission_states;
    `);
  }
}
