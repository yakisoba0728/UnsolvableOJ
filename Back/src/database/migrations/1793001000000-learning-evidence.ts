import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LearningEvidence1793001000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // shortcut: erased legacy WA/CE verdicts are unknowable, backfill more only if trustworthy history is recovered.
    await q.query(`
      ALTER TABLE submissions ADD COLUMN completed_for_learning boolean NOT NULL DEFAULT false;
      UPDATE submissions s SET completed_for_learning=true
      WHERE status IN ('ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR',
        'TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED')
        OR accepted_for_xp OR EXISTS (
          SELECT 1 FROM user_problem_solves l WHERE l.accepted_submission_id=s.id
        );
    `);
  }

  async down(q: QueryRunner): Promise<void> {
    if (!q.isTransactionActive)
      throw new Error('Learning evidence rollback requires a transaction.');
    await q.query(`
      LOCK TABLE submissions IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM submissions WHERE completed_for_learning AND status NOT IN
          ('ACCEPTED','WRONG_ANSWER','COMPILE_ERROR','RUNTIME_ERROR',
           'TIME_LIMIT_EXCEEDED','MEMORY_LIMIT_EXCEEDED','OUTPUT_LIMIT_EXCEEDED')) THEN
          RAISE EXCEPTION 'Cannot roll back retained learning evidence outside completed verdicts; preserve learning days.';
        END IF;
      END $$;
      ALTER TABLE submissions DROP COLUMN completed_for_learning;
    `);
  }
}
