import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshTokens1794700000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 로그인 유지용 refresh token. 원문은 저장하지 않고 SHA-256 해시만 둔다.
    // family_id: 한 번의 로그인에서 회전으로 이어진 토큰 묶음. 재사용이 보이면 묶음 전체를 폐기한다.
    // token_version: 발급 당시 users.token_version. 달라지면(역할 변경·정지·비밀번호 변경) 거절한다.
    await q.query(`
      CREATE TABLE refresh_tokens (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        family_id uuid NOT NULL,
        token_hash char(64) NOT NULL UNIQUE,
        token_version integer NOT NULL,
        remember boolean NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query('CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id)');
    await q.query('CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id)');
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE refresh_tokens');
  }
}
