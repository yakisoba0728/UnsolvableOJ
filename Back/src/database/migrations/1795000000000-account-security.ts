import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountSecurity1795000000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 관리자가 임시 비밀번호를 준 계정은 스스로 비밀번호를 바꿀 때까지 계정 API 밖의 요청을 거절한다.
    await q.query(
      'ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false',
    );
    // 로그인 기기 목록의 "로그인한 시각". 회전한 옛 행은 만료 후 지워지므로 계열의 시작 시각을 행마다 이어 둔다.
    await q.query(
      'ALTER TABLE refresh_tokens ADD COLUMN family_created_at timestamptz',
    );
    await q.query(`
      UPDATE refresh_tokens r SET family_created_at = f.created
      FROM (SELECT family_id, min(created_at) AS created FROM refresh_tokens GROUP BY family_id) f
      WHERE r.family_id = f.family_id`);
    await q.query(
      'ALTER TABLE refresh_tokens ALTER COLUMN family_created_at SET NOT NULL',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE refresh_tokens DROP COLUMN family_created_at');
    await q.query('ALTER TABLE users DROP COLUMN must_change_password');
  }
}
