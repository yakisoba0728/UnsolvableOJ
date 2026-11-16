import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The existing post-first primary keys cannot efficiently filter one user's history. */
export class CommunityProfileIndexes1795700000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX idx_community_votes_user_post ON community_votes(user_id, post_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_community_saved_user_post ON community_saved(user_id, post_id)',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_community_saved_user_post');
    await queryRunner.query('DROP INDEX idx_community_votes_user_post');
  }
}
