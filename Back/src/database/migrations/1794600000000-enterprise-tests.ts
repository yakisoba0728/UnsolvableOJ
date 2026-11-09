import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnterpriseTests1794600000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 기업 테스트: 담당자가 만든 시험과 응시 링크(invite_code).
    await q.query(`
      CREATE TABLE enterprise_tests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title varchar(60) NOT NULL,
        description varchar(300) NOT NULL DEFAULT '',
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        duration_min integer NOT NULL,
        problem_ids uuid[] NOT NULL,
        invite_code varchar(32) NOT NULL UNIQUE,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CHECK (ends_at > starts_at),
        CHECK (duration_min BETWEEN 10 AND 600),
        CHECK (cardinality(problem_ids) BETWEEN 1 AND 20)
      )`);
    await q.query('CREATE INDEX enterprise_tests_owner_idx ON enterprise_tests (owner_id, created_at DESC)');
    // 응시: 사람당 한 번. deadline_at = min(시작 + 제한 시간, 마감).
    await q.query(`
      CREATE TABLE enterprise_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        test_id uuid NOT NULL REFERENCES enterprise_tests(id) ON DELETE CASCADE,
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        started_at timestamptz NOT NULL DEFAULT now(),
        deadline_at timestamptz NOT NULL,
        finished_at timestamptz,
        UNIQUE (test_id, user_id)
      )`);
    await q.query('CREATE INDEX enterprise_attempts_user_idx ON enterprise_attempts (user_id)');
    // 시험 중 제출은 검증용(is_test)으로 저장해 XP·미션·통계에서 빠지고, 응시에 묶인다.
    await q.query(
      'ALTER TABLE submissions ADD COLUMN attempt_id uuid REFERENCES enterprise_attempts(id) ON DELETE SET NULL',
    );
    await q.query(
      'CREATE INDEX submissions_attempt_idx ON submissions (attempt_id, problem_id) WHERE attempt_id IS NOT NULL',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE submissions DROP COLUMN attempt_id');
    await q.query('DROP TABLE enterprise_attempts');
    await q.query('DROP TABLE enterprise_tests');
  }
}
