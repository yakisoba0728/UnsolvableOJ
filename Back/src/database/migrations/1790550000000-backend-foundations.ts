import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackendFoundations1790550000000 implements MigrationInterface {
  name = 'BackendFoundations1790550000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN token_version integer NOT NULL DEFAULT 0;
      ALTER TABLE problems ADD COLUMN current_version integer NOT NULL DEFAULT 1;
      ALTER TABLE submissions
        ADD COLUMN problem_version integer NOT NULL DEFAULT 1,
        ADD COLUMN judge_generation integer NOT NULL DEFAULT 1,
        ADD COLUMN judge_attempt_id uuid,
        ADD COLUMN judge_lease_expires_at timestamptz;
      CREATE INDEX idx_submissions_lease ON submissions (judge_lease_expires_at)
        WHERE status = 'JUDGING';

      CREATE TABLE problem_versions (
        problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        version integer NOT NULL,
        snapshot jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (problem_id, version)
      );
      INSERT INTO problem_versions (problem_id, version, snapshot)
      SELECT p.id, 1, jsonb_build_object(
        'title', p.title,
        'statementMarkdown', p.statement_md,
        'inputDescriptionMarkdown', p.input_description_md,
        'outputDescriptionMarkdown', p.output_description_md,
        'difficulty', p.difficulty,
        'timeLimitMs', p.time_limit_ms,
        'memoryLimitMb', p.memory_limit_mb,
        'testCases', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', t.id, 'input', t.input, 'expectedOutput', t.expected_output,
            'isSample', t.is_sample, 'score', t.score, 'order', t."order"
          ) ORDER BY t."order")
          FROM test_cases t WHERE t.problem_id = p.id
        ), '[]'::jsonb)
      ) FROM problems p;

      CREATE TABLE user_problem_solves (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        problem_id uuid NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
        accepted_submission_id uuid NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
        awarded_xp integer NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, problem_id)
      );
      CREATE TABLE audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
        action varchar(80) NOT NULL,
        target_type varchar(40) NOT NULL,
        target_id uuid NOT NULL,
        details jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_audit_events_created ON audit_events (created_at DESC);

      UPDATE submissions s SET problem_version = p.current_version
      FROM problems p WHERE p.id = s.problem_id;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE audit_events;
      DROP TABLE user_problem_solves;
      DROP TABLE problem_versions;
      DROP INDEX idx_submissions_lease;
      ALTER TABLE submissions
        DROP COLUMN judge_lease_expires_at,
        DROP COLUMN judge_attempt_id,
        DROP COLUMN judge_generation,
        DROP COLUMN problem_version;
      ALTER TABLE problems DROP COLUMN current_version;
      ALTER TABLE users DROP COLUMN token_version;
    `);
  }
}
