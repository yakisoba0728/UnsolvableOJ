import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CommunityUi1791200001000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE community_posts DROP CONSTRAINT community_posts_category_check;
      ALTER TABLE community_posts ADD CONSTRAINT community_posts_category_check CHECK(category IN ('QUESTION','SOLUTION','REVIEW','FREE','NOTICE'));
      ALTER TABLE community_posts ADD COLUMN tags text[] NOT NULL DEFAULT '{}', ADD COLUMN views integer NOT NULL DEFAULT 0;
      CREATE TABLE community_comment_votes (
        comment_id uuid REFERENCES community_comments(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(comment_id,user_id)
      );
      CREATE TABLE community_saved (
        post_id uuid REFERENCES community_posts(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(post_id,user_id)
      );
      CREATE TABLE community_follows (
        author_id uuid REFERENCES users(id) ON DELETE CASCADE,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        PRIMARY KEY(author_id,user_id), CHECK(author_id <> user_id)
      );
      CREATE INDEX idx_community_author ON community_posts(author_id);
      CREATE INDEX idx_community_comment_author ON community_comments(author_id);
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE community_comment_votes,community_saved,community_follows;
      DROP INDEX idx_community_author; DROP INDEX idx_community_comment_author;
      ALTER TABLE community_posts DROP COLUMN tags, DROP COLUMN views;
      UPDATE community_posts SET category='FREE' WHERE category='NOTICE';
      ALTER TABLE community_posts DROP CONSTRAINT community_posts_category_check;
      ALTER TABLE community_posts ADD CONSTRAINT community_posts_category_check CHECK(category IN ('QUESTION','SOLUTION','REVIEW','FREE'));
    `);
  }
}
