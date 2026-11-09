import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TestResults1795300000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    // 테스트별 원래 번호·예제 여부·판정·시간·메모리. 비공개 테스트의 입력·출력은 담지 않는다.
    await q.query(
      `ALTER TABLE submissions ADD COLUMN test_results jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('ALTER TABLE submissions DROP COLUMN test_results');
  }
}
