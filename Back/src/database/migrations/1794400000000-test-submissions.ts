import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TestSubmissions1794400000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 공개 전 문제를 작성자·관리자가 검증한 제출. XP·미션·통계에서 뺀다.
    await q.query(
      'ALTER TABLE submissions ADD COLUMN is_test boolean NOT NULL DEFAULT false',
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE submissions DROP COLUMN is_test');
  }
}
