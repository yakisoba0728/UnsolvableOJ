import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillSolves1790551000000 implements MigrationInterface {
  name = 'BackfillSolves1790551000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH firsts AS (
        SELECT DISTINCT ON (s.user_id, s.problem_id)
          s.user_id, s.problem_id, s.id,
          CASE p.difficulty::text
            WHEN 'BEGINNER' THEN 10 WHEN 'EASY' THEN 20
            WHEN 'MEDIUM' THEN 40 WHEN 'HARD' THEN 80
            WHEN 'EXPERT' THEN 160
          END AS awarded_xp
        FROM submissions s
        JOIN problems p ON p.id = s.problem_id
        WHERE s.status = 'ACCEPTED'
        ORDER BY s.user_id, s.problem_id, s.created_at, s.id
      ), inserted AS (
        INSERT INTO user_problem_solves (user_id, problem_id, accepted_submission_id, awarded_xp)
        SELECT user_id, problem_id, id, awarded_xp FROM firsts
        ON CONFLICT DO NOTHING
        RETURNING user_id, awarded_xp
      ), totals AS (
        SELECT user_id, sum(awarded_xp)::integer AS amount
        FROM inserted GROUP BY user_id
      )
      UPDATE users u SET
        xp = u.xp + totals.amount,
        level = 1 + (u.xp + totals.amount) / 100,
        updated_at = now()
      FROM totals WHERE u.id = totals.user_id;

      UPDATE submissions SET judge_lease_expires_at = now() - interval '1 second'
      WHERE status = 'JUDGING' AND judge_lease_expires_at IS NULL;
    `);
  }

  async down(): Promise<void> {
    // Historical accepted results must not be removed by a schema rollback.
  }
}
