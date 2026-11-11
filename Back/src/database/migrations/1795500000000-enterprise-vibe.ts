import type { MigrationInterface, QueryRunner } from 'typeorm';
export class EnterpriseVibe1795500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "ALTER TABLE enterprise_tests ADD COLUMN vibe_challenge_ids text[] NOT NULL DEFAULT '{}'::text[]",
    );
    await q.query(
      'ALTER TABLE enterprise_tests DROP CONSTRAINT enterprise_tests_problem_ids_check',
    );
    await q.query(
      'ALTER TABLE enterprise_tests ADD CONSTRAINT enterprise_tests_task_count_check CHECK (cardinality(problem_ids)>=0 AND cardinality(problem_ids)+cardinality(vibe_challenge_ids) BETWEEN 1 AND 20)',
    );
    await q.query(
      'ALTER TABLE vibe_attempts ADD COLUMN enterprise_attempt_id uuid REFERENCES enterprise_attempts(id) ON DELETE CASCADE',
    );
    await q.query(
      'CREATE UNIQUE INDEX vibe_enterprise_challenge_idx ON vibe_attempts(enterprise_attempt_id,challenge_id) WHERE enterprise_attempt_id IS NOT NULL',
    );
    await q.query(`CREATE TABLE vibe_revisions (
      attempt_id uuid NOT NULL REFERENCES vibe_attempts(id) ON DELETE CASCADE,
      revision integer NOT NULL,
      action text NOT NULL,
      files jsonb NOT NULL,
      paths text[] NOT NULL DEFAULT '{}',
      message_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(attempt_id, revision)
    )`);
    await q.query(
      "INSERT INTO vibe_revisions(attempt_id,revision,action,files) SELECT id,revision,'baseline',state->'files' FROM vibe_attempts",
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(
      `DO $$ BEGIN IF EXISTS(SELECT 1 FROM vibe_attempts WHERE enterprise_attempt_id IS NOT NULL) OR EXISTS(SELECT 1 FROM enterprise_tests WHERE cardinality(vibe_challenge_ids)>0) THEN RAISE EXCEPTION 'Enterprise vibe records exist; preserve assessment history before reverting'; END IF; END $$`,
    );
    await q.query('DROP TABLE vibe_revisions');
    await q.query(
      'ALTER TABLE vibe_attempts DROP COLUMN enterprise_attempt_id',
    );
    await q.query(
      'ALTER TABLE enterprise_tests DROP CONSTRAINT enterprise_tests_task_count_check',
    );
    await q.query(
      'ALTER TABLE enterprise_tests DROP COLUMN vibe_challenge_ids',
    );
    await q.query(
      'ALTER TABLE enterprise_tests ADD CONSTRAINT enterprise_tests_problem_ids_check CHECK(cardinality(problem_ids) BETWEEN 1 AND 20)',
    );
  }
}
