import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Existing assessments are bound at migration time; historical submissions stay immutable. */
export class EnterpriseProblemVersions1795800000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE enterprise_problem_versions (
      test_id uuid NOT NULL REFERENCES enterprise_tests(id) ON DELETE CASCADE,
      problem_id uuid NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      position integer NOT NULL CHECK (position BETWEEN 1 AND 20),
      PRIMARY KEY (test_id, problem_id),
      UNIQUE (test_id, position),
      FOREIGN KEY (problem_id, version) REFERENCES problem_versions(problem_id, version) ON DELETE RESTRICT
    )`);
    await q.query(`INSERT INTO enterprise_problem_versions(test_id, problem_id, version, position)
      SELECT t.id, p.id, p.current_version, o.position
      FROM enterprise_tests t CROSS JOIN LATERAL unnest(t.problem_ids) WITH ORDINALITY o(id, position)
      JOIN problems p ON p.id=o.id`);
    // Do not silently turn an existing assessment into a different question set.
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM enterprise_tests t WHERE cardinality(t.problem_ids) <>
        (SELECT count(*) FROM enterprise_problem_versions v WHERE v.test_id=t.id)) THEN
        RAISE EXCEPTION 'Assessment references missing problems; repair the assessment before version binding';
      END IF;
    END $$`);
    await q.query('CREATE INDEX enterprise_problem_versions_problem_idx ON enterprise_problem_versions(problem_id, version)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE enterprise_problem_versions');
  }
}
