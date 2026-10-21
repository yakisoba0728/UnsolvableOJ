import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SubmissionXpEvidence1790553000000 implements MigrationInterface {
  name = 'SubmissionXpEvidence1790553000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // shortcut: old non-anchor errors have no verdict history; backfill only if external acceptance evidence becomes available.
    await queryRunner.query(`
      ALTER TABLE submissions ADD COLUMN accepted_for_xp boolean NOT NULL DEFAULT false;
      UPDATE submissions s SET accepted_for_xp = true
      WHERE s.status = 'ACCEPTED' OR (
        s.status IN ('QUEUED', 'JUDGING', 'SYSTEM_ERROR', 'CANCELLED')
        AND EXISTS (
          SELECT 1 FROM user_problem_solves solves
          WHERE solves.accepted_submission_id = s.id
            AND solves.user_id = s.user_id AND solves.problem_id = s.problem_id
        )
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      LOCK TABLE submissions IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM submissions WHERE accepted_for_xp AND status <> 'ACCEPTED') THEN
          RAISE EXCEPTION 'Cannot roll back submission XP evidence with retained acceptance outside ACCEPTED; preserve XP eligibility.';
        END IF;
      END $$;
      ALTER TABLE submissions DROP COLUMN accepted_for_xp;
    `);
  }
}
