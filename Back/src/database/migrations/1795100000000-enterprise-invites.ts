import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnterpriseInvites1795100000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 초대 전용 테스트: 사용자 이름은 저장할 때 id로 바꿔 두고(이름을 바꿔도 유지),
    // 이메일은 나중에 가입할 사람도 맞도록 소문자 글자로 둔다.
    await q.query(`
      ALTER TABLE enterprise_tests
        ADD COLUMN invite_only boolean NOT NULL DEFAULT false,
        ADD COLUMN invite_user_ids uuid[] NOT NULL DEFAULT '{}',
        ADD COLUMN invite_emails text[] NOT NULL DEFAULT '{}',
        ADD COLUMN show_score_to_candidates boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT enterprise_tests_invite_limit
          CHECK (cardinality(invite_user_ids) + cardinality(invite_emails) <= 200)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE enterprise_tests
        DROP CONSTRAINT enterprise_tests_invite_limit,
        DROP COLUMN show_score_to_candidates,
        DROP COLUMN invite_emails,
        DROP COLUMN invite_user_ids,
        DROP COLUMN invite_only`);
  }
}
