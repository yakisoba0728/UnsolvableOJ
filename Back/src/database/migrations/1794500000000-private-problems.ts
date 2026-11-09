import type { MigrationInterface, QueryRunner } from 'typeorm';

export class PrivateProblems1794500000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 기업 테스트 전용 문제: 공개 목록·상세에 나오지 않고 공개(PUBLISHED)로 바꿀 수 없다.
    await q.query(
      'ALTER TABLE problems ADD COLUMN is_private boolean NOT NULL DEFAULT false',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE problems DROP COLUMN is_private');
  }
}
